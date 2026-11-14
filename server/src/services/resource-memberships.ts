import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@outpost/db";
import {
  agentMemberships,
  agents,
  documentMemberships,
  documents,
  projectMemberships,
  projects,
} from "@outpost/db";
import type {
  ResourceMembershipResourceType,
  ResourceMembershipState,
  ResourceMemberships,
  ResourceMembershipUpdateResult,
} from "@outpost/shared";
import { forbidden, notFound } from "../errors.js";
import { logger } from "../middleware/logger.js";

type OperatorActor = {
  type: "operator" | "agent" | "none";
  userId?: string;
  spaceIds?: string[];
  memberships?: Array<{
    spaceId: string;
    membershipRole?: string | null;
    status?: string;
  }>;
  isInstanceAdmin?: boolean;
  source?: string;
};

type PolicyDecision = {
  allowed: boolean;
  reason?: string | null;
  source?: string | null;
};

export type ResourceMembershipPolicyHook = (input: {
  actor: OperatorActor;
  spaceId: string;
  userId: string;
  resourceType: ResourceMembershipResourceType;
  resourceId: string;
  state: ResourceMembershipState;
  starred?: boolean;
}) => Promise<PolicyDecision> | PolicyDecision;

type ResourceMembershipServiceOptions = {
  inTransaction?: boolean;
  policyHook?: ResourceMembershipPolicyHook | null;
};

type MembershipChangeKind = ResourceMembershipState | "starred" | "unstarred";

type MembershipUpdateResult = ResourceMembershipUpdateResult & {
  changed: boolean;
  changeKind: MembershipChangeKind | null;
  policySource: string;
};

function defaultJoinedMap<T extends { projectId?: string; agentId?: string; state: string }>(
  rows: T[],
  key: "projectId" | "agentId",
): Record<string, ResourceMembershipState> {
  const result: Record<string, ResourceMembershipState> = {};
  for (const row of rows) {
    const id = row[key];
    if (typeof id !== "string") continue;
    result[id] = row.state === "left" ? "left" : "joined";
  }
  return result;
}

function starredAtMap<T extends { projectId?: string; agentId?: string; starredAt: Date | null }>(
  rows: T[],
  key: "projectId" | "agentId",
): Record<string, Date> {
  const result: Record<string, Date> = {};
  for (const row of rows) {
    const id = row[key];
    if (typeof id !== "string" || !row.starredAt) continue;
    result[id] = row.starredAt;
  }
  return result;
}

function starredIds<T extends { projectId?: string; agentId?: string; starredAt: Date | null }>(
  rows: T[],
  key: "projectId" | "agentId",
): string[] {
  return rows
    .filter((row) => row.starredAt)
    .sort((a, b) => b.starredAt!.getTime() - a.starredAt!.getTime())
    .map((row) => row[key])
    .filter((id): id is string => typeof id === "string");
}

function latestDate(...dates: Array<Date | null | undefined>): Date | null {
  let latest: Date | null = null;
  for (const date of dates) {
    if (!date) continue;
    if (!latest || date.getTime() > latest.getTime()) latest = date;
  }
  return latest;
}

function assertOperatorSelfMembershipAccess(actor: OperatorActor, spaceId: string, userId: string) {
  if (actor.type !== "operator" || !actor.userId) {
    throw forbidden("Operator user access required");
  }
  if (actor.userId !== userId) {
    throw forbidden("Users may only update their own resource memberships");
  }
  if (actor.source === "local_implicit" || actor.isInstanceAdmin) {
    return;
  }
  const membership = actor.memberships?.find((item) => item.spaceId === spaceId);
  if (!membership || membership.status !== "active") {
    throw forbidden("User does not have active space access");
  }
}

async function evaluatePolicy(
  hook: ResourceMembershipPolicyHook | null | undefined,
  input: Parameters<ResourceMembershipPolicyHook>[0],
): Promise<PolicyDecision> {
  if (!hook) return { allowed: true, source: "oss_default" };
  try {
    const decision = await hook(input);
    return {
      allowed: decision.allowed === true,
      reason: decision.reason ?? null,
      source: decision.source ?? "policy_hook",
    };
  } catch (err) {
    logger.warn(
      { err, spaceId: input.spaceId, resourceType: input.resourceType, resourceId: input.resourceId },
      "resource membership policy hook failed closed",
    );
    return { allowed: false, reason: "policy_hook_failed", source: "policy_hook" };
  }
}

export function resourceMembershipService(db: Db, options: ResourceMembershipServiceOptions = {}) {
  const policyHook = options.policyHook ?? null;

  async function assertMutationAllowed(input: {
    actor: OperatorActor;
    spaceId: string;
    userId: string;
    resourceType: ResourceMembershipResourceType;
    resourceId: string;
    state: ResourceMembershipState;
    starred?: boolean;
  }): Promise<PolicyDecision> {
    assertOperatorSelfMembershipAccess(input.actor, input.spaceId, input.userId);
    const decision = await evaluatePolicy(policyHook, input);
    if (!decision.allowed) {
      logger.warn(
        {
          spaceId: input.spaceId,
          userId: input.userId,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          reason: decision.reason ?? "denied",
          source: decision.source ?? "policy_hook",
        },
        "resource membership mutation denied",
      );
      throw forbidden("Resource membership policy denied this request");
    }
    return decision;
  }

  return {
    async listForUser(spaceId: string, userId: string, actor: OperatorActor): Promise<ResourceMemberships> {
      assertOperatorSelfMembershipAccess(actor, spaceId, userId);
      const [projectRows, agentRows, documentRows] = await Promise.all([
        db
          .select({
            projectId: projectMemberships.projectId,
            state: projectMemberships.state,
            starredAt: projectMemberships.starredAt,
            updatedAt: projectMemberships.updatedAt,
            projectArchivedAt: projects.archivedAt,
          })
          .from(projectMemberships)
          .innerJoin(projects, and(
            eq(projects.id, projectMemberships.projectId),
            eq(projects.spaceId, projectMemberships.spaceId),
          ))
          .where(and(
            eq(projectMemberships.spaceId, spaceId),
            eq(projectMemberships.userId, userId),
          )),
        db
          .select({
            agentId: agentMemberships.agentId,
            state: agentMemberships.state,
            starredAt: agentMemberships.starredAt,
            updatedAt: agentMemberships.updatedAt,
            agentStatus: agents.status,
          })
          .from(agentMemberships)
          .innerJoin(agents, and(
            eq(agents.id, agentMemberships.agentId),
            eq(agents.spaceId, agentMemberships.spaceId),
          ))
          .where(and(
            eq(agentMemberships.spaceId, spaceId),
            eq(agentMemberships.userId, userId),
          )),
        db
          .select({
            documentId: documentMemberships.documentId,
            starredAt: documentMemberships.starredAt,
            updatedAt: documentMemberships.updatedAt,
          })
          .from(documentMemberships)
          .innerJoin(documents, and(
            eq(documents.id, documentMemberships.documentId),
            eq(documents.spaceId, documentMemberships.spaceId),
          ))
          .where(and(
            eq(documentMemberships.spaceId, spaceId),
            eq(documentMemberships.userId, userId),
          )),
      ]);
      const starEligibleProjectRows = projectRows.filter((row) => row.starredAt && !row.projectArchivedAt);
      const starEligibleAgentRows = agentRows.filter((row) => row.starredAt && row.agentStatus !== "terminated");
      const starredDocumentRows = documentRows
        .filter((row): row is typeof row & { starredAt: Date } => row.starredAt !== null)
        .sort((a, b) => b.starredAt.getTime() - a.starredAt.getTime());
      return {
        projectMemberships: defaultJoinedMap(projectRows, "projectId"),
        agentMemberships: defaultJoinedMap(agentRows, "agentId"),
        starredProjectIds: starredIds(starEligibleProjectRows, "projectId"),
        starredAgentIds: starredIds(starEligibleAgentRows, "agentId"),
        starredDocumentIds: starredDocumentRows.map((row) => row.documentId),
        projectStarredAt: starredAtMap(starEligibleProjectRows, "projectId"),
        agentStarredAt: starredAtMap(starEligibleAgentRows, "agentId"),
        documentStarredAt: Object.fromEntries(
          starredDocumentRows.map((row) => [row.documentId, row.starredAt.toISOString()]),
        ),
        updatedAt: latestDate(
          ...projectRows.map((row) => row.updatedAt),
          ...agentRows.map((row) => row.updatedAt),
          ...documentRows.map((row) => row.updatedAt),
        ),
      };
    },

    async updateProject(input: {
      spaceId: string;
      userId: string;
      projectId: string;
      state?: ResourceMembershipState;
      starred?: boolean;
      actor: OperatorActor;
    }): Promise<MembershipUpdateResult> {
      const project = await db.query.projects.findFirst({
        where: and(
          eq(projects.id, input.projectId),
          eq(projects.spaceId, input.spaceId),
        ),
      });
      if (!project || project.archivedAt) throw notFound("Project not found");

      const existing = await db.query.projectMemberships.findFirst({
        where: and(
          eq(projectMemberships.spaceId, input.spaceId),
          eq(projectMemberships.userId, input.userId),
          eq(projectMemberships.projectId, input.projectId),
        ),
      });
      const previousState: ResourceMembershipState = existing?.state === "left" ? "left" : "joined";
      const previousStarredAt = existing?.starredAt ?? null;
      const nextState: ResourceMembershipState = input.starred === true ? "joined" : input.state ?? previousState;
      const nextStarredAt = nextState === "left"
        ? null
        : input.starred === true
          ? previousStarredAt ?? new Date()
          : input.starred === false
            ? null
            : previousStarredAt;
      const stateChanged = previousState !== nextState;
      const starredChanged = (previousStarredAt?.getTime() ?? null) !== (nextStarredAt?.getTime() ?? null);
      const decision = await assertMutationAllowed({
        actor: input.actor,
        spaceId: input.spaceId,
        userId: input.userId,
        resourceType: "project",
        resourceId: input.projectId,
        state: nextState,
        starred: input.starred,
      });

      if (!stateChanged && !starredChanged) {
        return {
          resourceType: "project",
          resourceId: input.projectId,
          state: nextState,
          starredAt: previousStarredAt,
          updatedAt: existing?.updatedAt ?? new Date(),
          changed: false,
          changeKind: null,
          policySource: decision.source ?? "oss_default",
        };
      }

      const now = new Date();
      const [row] = await db
        .insert(projectMemberships)
        .values({
          spaceId: input.spaceId,
          projectId: input.projectId,
          userId: input.userId,
          state: nextState,
          starredAt: nextStarredAt,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [projectMemberships.spaceId, projectMemberships.userId, projectMemberships.projectId],
          set: {
            state: nextState,
            starredAt: nextStarredAt,
            updatedAt: now,
          },
        })
        .returning();

      return {
        resourceType: "project",
        resourceId: input.projectId,
        state: row?.state === "left" ? "left" : "joined",
        starredAt: row?.starredAt ?? null,
        updatedAt: row?.updatedAt ?? now,
        changed: true,
        changeKind: input.starred !== undefined && starredChanged
          ? input.starred ? "starred" : "unstarred"
          : stateChanged ? nextState : nextStarredAt ? "starred" : "unstarred",
        policySource: decision.source ?? "oss_default",
      };
    },

    async updateAgent(input: {
      spaceId: string;
      userId: string;
      agentId: string;
      state?: ResourceMembershipState;
      starred?: boolean;
      actor: OperatorActor;
    }): Promise<MembershipUpdateResult> {
      if (!options.inTransaction) {
        return db.transaction(async tx => resourceMembershipService(tx as unknown as Db, { ...options, inTransaction: true }).updateAgent(input));
      }
      await db.select({ id: agents.id }).from(agents)
        .where(and(eq(agents.spaceId, input.spaceId), eq(agents.id, input.agentId))).for("update");
      const agent = await db.query.agents.findFirst({
        where: and(
          eq(agents.id, input.agentId),
          eq(agents.spaceId, input.spaceId),
        ),
      });
      if (!agent || agent.status === "terminated") throw notFound("Agent not found");

      const existing = await db.query.agentMemberships.findFirst({
        where: and(
          eq(agentMemberships.spaceId, input.spaceId),
          eq(agentMemberships.userId, input.userId),
          eq(agentMemberships.agentId, input.agentId),
        ),
      });
      const previousState: ResourceMembershipState = existing?.state === "left" ? "left" : "joined";
      const previousStarredAt = existing?.starredAt ?? null;
      const nextState: ResourceMembershipState = input.starred === true ? "joined" : input.state ?? previousState;
      const nextStarredAt = nextState === "left"
        ? null
        : input.starred === true
          ? previousStarredAt ?? new Date()
          : input.starred === false
            ? null
            : previousStarredAt;
      const stateChanged = previousState !== nextState;
      const starredChanged = (previousStarredAt?.getTime() ?? null) !== (nextStarredAt?.getTime() ?? null);
      const decision = await assertMutationAllowed({
        actor: input.actor,
        spaceId: input.spaceId,
        userId: input.userId,
        resourceType: "agent",
        resourceId: input.agentId,
        state: nextState,
        starred: input.starred,
      });

      if (!stateChanged && !starredChanged) {
        return {
          resourceType: "agent",
          resourceId: input.agentId,
          state: nextState,
          starredAt: previousStarredAt,
          updatedAt: existing?.updatedAt ?? new Date(),
          changed: false,
          changeKind: null,
          policySource: decision.source ?? "oss_default",
        };
      }

      const now = new Date();
      const [row] = await db
        .insert(agentMemberships)
        .values({
          spaceId: input.spaceId,
          agentId: input.agentId,
          userId: input.userId,
          state: nextState,
          starredAt: nextStarredAt,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [agentMemberships.spaceId, agentMemberships.userId, agentMemberships.agentId],
          set: {
            state: nextState,
            starredAt: nextStarredAt,
            updatedAt: now,
          },
        })
        .returning();

      return {
        resourceType: "agent",
        resourceId: input.agentId,
        state: row?.state === "left" ? "left" : "joined",
        starredAt: row?.starredAt ?? null,
        updatedAt: row?.updatedAt ?? now,
        changed: true,
        changeKind: input.starred !== undefined && starredChanged
          ? input.starred ? "starred" : "unstarred"
          : stateChanged ? nextState : nextStarredAt ? "starred" : "unstarred",
        policySource: decision.source ?? "oss_default",
      };
    },

    async updateDocument(input: {
      spaceId: string;
      userId: string;
      documentId: string;
      starred: boolean;
      actor: OperatorActor;
    }): Promise<MembershipUpdateResult> {
      const document = await db.query.documents.findFirst({
        where: eq(documents.id, input.documentId),
      });
      if (!document || document.spaceId !== input.spaceId) throw notFound("Document not found");

      const decision = await assertMutationAllowed({
        actor: input.actor,
        spaceId: input.spaceId,
        userId: input.userId,
        resourceType: "document",
        resourceId: input.documentId,
        state: "joined",
        starred: input.starred,
      });
      const existing = await db.query.documentMemberships.findFirst({
        where: and(
          eq(documentMemberships.spaceId, input.spaceId),
          eq(documentMemberships.userId, input.userId),
          eq(documentMemberships.documentId, input.documentId),
        ),
      });

      if (input.starred) {
        if (existing?.starredAt) {
          return {
            resourceType: "document",
            resourceId: input.documentId,
            state: "joined",
            starredAt: existing.starredAt,
            updatedAt: existing.updatedAt,
            changed: false,
            changeKind: null,
            policySource: decision.source ?? "oss_default",
          };
        }
        const now = new Date();
        const [row] = await db
          .insert(documentMemberships)
          .values({
            spaceId: input.spaceId,
            documentId: input.documentId,
            userId: input.userId,
            starredAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [documentMemberships.spaceId, documentMemberships.userId, documentMemberships.documentId],
            set: {
              starredAt: sql`${documentMemberships.starredAt}`,
              updatedAt: sql`${documentMemberships.updatedAt}`,
            },
          })
          .returning({
            starredAt: documentMemberships.starredAt,
            updatedAt: documentMemberships.updatedAt,
            inserted: sql<boolean>`xmax = 0`,
          });
        return {
          resourceType: "document",
          resourceId: input.documentId,
          state: "joined",
          starredAt: row?.starredAt ?? now,
          updatedAt: row?.updatedAt ?? now,
          changed: row?.inserted === true,
          changeKind: row?.inserted === true ? "starred" : null,
          policySource: decision.source ?? "oss_default",
        };
      }

      if (!existing) {
        return {
          resourceType: "document",
          resourceId: input.documentId,
          state: "joined",
          starredAt: null,
          updatedAt: new Date(),
          changed: false,
          changeKind: null,
          policySource: decision.source ?? "oss_default",
        };
      }
      const [deleted] = await db
        .delete(documentMemberships)
        .where(eq(documentMemberships.id, existing.id))
        .returning({ id: documentMemberships.id });
      const changed = deleted !== undefined;
      return {
        resourceType: "document",
        resourceId: input.documentId,
        state: "joined",
        starredAt: null,
        updatedAt: new Date(),
        changed,
        changeKind: changed ? "unstarred" : null,
        policySource: decision.source ?? "oss_default",
      };
    },
  };
}
