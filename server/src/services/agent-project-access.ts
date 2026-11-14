import { notifyAttentionRetentionWork } from "./retention-work-notifications.js";
import { and, eq, inArray } from "drizzle-orm";
import { agents, projects, type Db } from "@outpost/db";
import { trustAuthorizationPolicySchema, type AgentProjectAccess } from "@outpost/shared";
import { conflict, forbidden, notFound } from "../errors.js";
import { normalizeAgentPermissions } from "../lib/agent-permissions.js";
import { accessService } from "./access.js";
import type { AuthorizationActor } from "./authorization.js";
import { logActivity, publishActivity, type ActivityPublication } from "./activity-log.js";

export async function readAgentProjectAccess(db: Db, actor: AuthorizationActor, spaceId: string, agentId: string): Promise<AgentProjectAccess> {
  const [agent] = await db.select({ permissions: agents.permissions, status: agents.status }).from(agents)
    .where(and(eq(agents.spaceId, spaceId), eq(agents.id, agentId)));
  if (!agent) throw notFound("Agent not found");
  const decision = await accessService(db).decide({ actor, action: "agents:create", resource: { type: "space", spaceId } });
  const permissions = normalizeAgentPermissions(agent.permissions);
  const policy = trustAuthorizationPolicySchema.safeParse(permissions.authorizationPolicy ?? {});
  const boundary = policy.success ? policy.data.trustBoundary : undefined;
  return { projectIds: policy.success ? policy.data.trustBoundary?.projectIds ?? [] : [],
    canManage: actor.type === "operator" && decision.allowed && agent.status !== "pending_approval"
      && policy.success && permissions.trustPreset === "low_trust_review"
      && (!boundary || (boundary.mode === "low_trust_review" && (!boundary.spaceId || boundary.spaceId === spaceId))) };
}

/** An additive operation under the agent row lock, never a stale policy replacement. */
export async function addAgentProjectAccess(db: Db, actor: AuthorizationActor, spaceId: string, agentId: string, projectIds: string[]) {
  if (actor.type !== "operator") throw forbidden("Operator access required");
  const publications: ActivityPublication[] = [];
  const result = await db.transaction(async tx => {
    const [agent] = await tx.select().from(agents)
      .where(and(eq(agents.spaceId, spaceId), eq(agents.id, agentId))).for("update");
    if (!agent) throw notFound("Agent not found");
    const transactionDb = tx as unknown as Db;
    const access = accessService(transactionDb);
    const decision = await access.decide({ actor, action: "agents:create", resource: { type: "space", spaceId } });
    if (!decision.allowed) throw forbidden(decision.explanation);
    if (agent.status === "pending_approval") throw conflict("Pending approval agent permissions cannot be changed before operator approval");
    const permissions = normalizeAgentPermissions(agent.permissions);
    const parsedPolicy = trustAuthorizationPolicySchema.safeParse(permissions.authorizationPolicy ?? {});
    if (!parsedPolicy.success) throw conflict("The agent’s trust settings need review before adding project access.");
    const policy = parsedPolicy.data;
    const boundary = policy?.trustBoundary;
    if (permissions.trustPreset !== "low_trust_review" || (boundary && (boundary.mode !== "low_trust_review"
      || (boundary.spaceId && boundary.spaceId !== spaceId)))) {
      throw conflict("The agent’s trust settings changed. Refresh before adding project access.");
    }
    const requested = [...new Set(projectIds)];
    const rows = await tx.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.spaceId, spaceId), inArray(projects.id, requested)));
    if (rows.length !== requested.length) throw notFound("A selected project is unavailable");
    for (const project of rows) {
      const projectDecision = await access.decide({ actor, action: "project:read", resource: { type: "project", spaceId, projectId: project.id } });
      if (!projectDecision.allowed) throw forbidden("A selected project is unavailable");
    }
    const previous = boundary?.projectIds ?? [];
    const added = requested.filter(id => !previous.includes(id));
    const next = [...previous, ...added];
    if (added.length) {
      await notifyAttentionRetentionWork(tx, { spaceId, sourceKind: "agent_error_alert" });
      await tx.update(agents).set({ permissions: { ...agent.permissions, authorizationPolicy: {
        ...policy, trustBoundary: { ...boundary, mode: "low_trust_review", spaceId, projectIds: next },
      } }, updatedAt: new Date() }).where(and(eq(agents.id, agentId), eq(agents.spaceId, spaceId)));
      await logActivity(transactionDb, { spaceId, actorType: "user", actorId: actor.userId ?? "local-operator",
        action: "agent.project_access_added", entityType: "agent", entityId: agentId,
        details: { addedProjectIds: added, trustPreset: "low_trust_review" } }, publications);
    }
    return { projectIds: next, canManage: true } satisfies AgentProjectAccess;
  });
  for (const publication of publications) publishActivity(publication);
  return result;
}
