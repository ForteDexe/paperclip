import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  agents,
  authUsers,
  spaces,
  spaceMemberships,
  createDb,
  instanceUserRoles,
  issueAccessGrants,
  issueComments,
  issues,
  principalPermissionGrants,
  projectAccessMembers,
  projects,
  userInboxAgentPolicies,
} from "@outpost/db";
import { LOW_TRUST_REVIEW_PRESET, type PermissionKey } from "@outpost/shared";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import {
  authorizationService,
  canActorReadIssuePrivacy,
  issuePrivacyMode,
  type AuthorizationActor,
} from "../services/authorization.js";
import { logger } from "../middleware/logger.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

async function createSpace(db: ReturnType<typeof createDb>, label: string) {
  return db
    .insert(spaces)
    .values({
      name: `Authorization ${label} ${randomUUID()}`,
      issuePrefix: `AZ${randomUUID().slice(0, 6).toUpperCase()}`,
    })
    .returning()
    .then((rows) => rows[0]!);
}

async function createAgent(
  db: ReturnType<typeof createDb>,
  spaceId: string,
  input: { role?: string; reportsTo?: string | null; permissions?: Record<string, unknown> } = {},
) {
  return db
    .insert(agents)
    .values({
      spaceId,
      name: `Agent ${randomUUID()}`,
      role: input.role ?? "engineer",
      reportsTo: input.reportsTo ?? null,
      permissions: input.permissions ?? {},
      adapterType: "process",
      adapterConfig: {},
      runtimeConfig: {},
    })
    .returning()
    .then((rows) => rows[0]!);
}

async function createProject(
  db: ReturnType<typeof createDb>,
  spaceId: string,
  label: string,
  visibility: "open" | "private" = "open",
) {
  return db
    .insert(projects)
    .values({
      spaceId,
      name: `Project ${label} ${randomUUID()}`,
      visibility,
    })
    .returning()
    .then((rows) => rows[0]!);
}

async function createIssue(
  db: ReturnType<typeof createDb>,
  spaceId: string,
  input: {
    id?: string;
    title?: string;
    projectId?: string | null;
    parentId?: string | null;
    assigneeAgentId?: string | null;
    assigneeUserId?: string | null;
    createdByUserId?: string | null;
    responsibleUserId?: string | null;
    visibility?: "open" | "private";
    privacyRootIssueId?: string | null;
    privacyParentIssueId?: string | null;
    originKind?: string | null;
    originId?: string | null;
  } = {},
) {
  return db
    .insert(issues)
    .values({
      id: input.id ?? randomUUID(),
      spaceId,
      title: input.title ?? `Issue ${randomUUID()}`,
      status: "todo",
      priority: "medium",
      projectId: input.projectId ?? null,
      parentId: input.parentId ?? null,
      assigneeAgentId: input.assigneeAgentId ?? null,
      assigneeUserId: input.assigneeUserId ?? null,
      createdByUserId: input.createdByUserId ?? null,
      responsibleUserId: input.responsibleUserId ?? null,
      visibility: input.visibility ?? "open",
      privacyRootIssueId: input.privacyRootIssueId ?? null,
      privacyParentIssueId: input.privacyParentIssueId ?? null,
      originKind: input.originKind ?? "manual",
      originId: input.originId ?? null,
    })
    .returning()
    .then((rows) => rows[0]!);
}

async function grantAgentPermission(
  db: ReturnType<typeof createDb>,
  spaceId: string,
  agentId: string,
  permissionKey: PermissionKey,
  scope: Record<string, unknown> | null = null,
) {
  await db.insert(spaceMemberships).values({
    spaceId,
    principalType: "agent",
    principalId: agentId,
    status: "active",
    membershipRole: "member",
  });
  await db.insert(principalPermissionGrants).values({
    spaceId,
    principalType: "agent",
    principalId: agentId,
    permissionKey,
    scope,
    grantedByUserId: null,
  });
}

async function createUser(
  db: ReturnType<typeof createDb>,
  input: { id?: string; email?: string } = {},
) {
  const id = input.id ?? `user-${randomUUID()}`;
  await db.insert(authUsers).values({
    id,
    name: `User ${id}`,
    email: input.email ?? `${id}@example.com`,
    emailVerified: true,
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return id;
}

async function grantUserPermission(
  db: ReturnType<typeof createDb>,
  spaceId: string,
  userId: string,
  permissionKey: PermissionKey,
  scope: Record<string, unknown> | null = null,
) {
  await db.insert(spaceMemberships).values({
    spaceId,
    principalType: "user",
    principalId: userId,
    status: "active",
    membershipRole: "operator",
  });
  await db.insert(principalPermissionGrants).values({
    spaceId,
    principalType: "user",
    principalId: userId,
    permissionKey,
    scope,
    grantedByUserId: "owner",
  });
}

describeEmbeddedPostgres("authorization service", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  it("defaults issue privacy to enforce while retaining explicit rollout overrides", () => {
    const previousMode = process.env.OUTPOST_ISSUE_PRIVACY_MODE;
    try {
      delete process.env.OUTPOST_ISSUE_PRIVACY_MODE;
      expect(issuePrivacyMode()).toBe("enforce");
      process.env.OUTPOST_ISSUE_PRIVACY_MODE = "shadow";
      expect(issuePrivacyMode()).toBe("shadow");
      process.env.OUTPOST_ISSUE_PRIVACY_MODE = "off";
      expect(issuePrivacyMode()).toBe("off");
    } finally {
      if (previousMode === undefined) delete process.env.OUTPOST_ISSUE_PRIVACY_MODE;
      else process.env.OUTPOST_ISSUE_PRIVACY_MODE = previousMode;
    }
  });

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("outpost-authorization-service-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueComments);
    await db.delete(userInboxAgentPolicies);
    await db.delete(principalPermissionGrants);
    await db.delete(spaceMemberships);
    await db.delete(instanceUserRoles);
    await db.delete(issueAccessGrants);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(projects);
    await db.delete(spaces);
    await db.delete(authUsers);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("allows active user role grants and explains the grant source", async () => {
    const space = await createSpace(db, "UserGrant");
    const userId = `user-${randomUUID()}`;
    await db.insert(spaceMemberships).values({
      spaceId: space.id,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "operator",
    });
    await db.insert(principalPermissionGrants).values({
      spaceId: space.id,
      principalType: "user",
      principalId: userId,
      permissionKey: "tasks:assign",
      grantedByUserId: "owner",
    });

    const decision = await authorizationService(db).decidePrincipalGrant({
      spaceId: space.id,
      principalType: "user",
      principalId: userId,
      action: "tasks:assign",
      permissionKey: "tasks:assign",
    });

    expect(decision).toMatchObject({
      allowed: true,
      reason: "allow_explicit_grant",
      grant: {
        principalType: "user",
        principalId: userId,
        permissionKey: "tasks:assign",
      },
    });
    expect(decision.explanation).toContain("Allowed by explicit grant tasks:assign");
  });

  it.each(["agent", "user"] as const)("allows %s read-only grants without configuration write authority", async (principalType) => {
    const space = await createSpace(db, "ReadOnlyConfig");
    const actorAgent = await createAgent(db, space.id);
    const targetAgent = await createAgent(db, space.id);
    const userId = await createUser(db);
    const actor: AuthorizationActor = principalType === "agent"
      ? { type: "agent", agentId: actorAgent.id, spaceId: space.id, source: "agent_key" }
      : { type: "operator", userId, source: "session" };
    if (principalType === "agent") await grantAgentPermission(db, space.id, actorAgent.id, "agents:read");
    else await grantUserPermission(db, space.id, userId, "agents:read");
    const authz = authorizationService(db);
    const resource = { type: "agent" as const, spaceId: space.id, agentId: targetAgent.id };

    await expect(authz.decide({ actor, action: "agent_config:read", resource })).resolves.toMatchObject({
      allowed: true, grant: { permissionKey: "agents:read" },
    });
    for (const action of ["agent_config:update", "agent_instructions:update"] as const) {
      await expect(authz.decide({ actor, action, resource, scope: { requiresChangeGrant: true } }))
        .resolves.toMatchObject({ allowed: false });
    }
  });

  it("restricts configuration reads to the read grant's target scope", async () => {
    const space = await createSpace(db, "ScopedReadOnlyConfig");
    const actor = await createAgent(db, space.id);
    const target = await createAgent(db, space.id);
    const other = await createAgent(db, space.id);
    await grantAgentPermission(db, space.id, actor.id, "agents:read", { agentIds: [target.id] });
    const authz = authorizationService(db);
    const read = (targetAgentId: string) => authz.decide({
      actor: { type: "agent", spaceId: space.id, agentId: actor.id, source: "agent_key" },
      action: "agent_config:read",
      resource: { type: "agent", spaceId: space.id, agentId: targetAgentId },
      scope: { targetAgentId },
    });
    await expect(read(target.id)).resolves.toMatchObject({ allowed: true });
    await expect(read(other.id)).resolves.toMatchObject({ allowed: false, reason: "deny_scope" });
    await db.delete(principalPermissionGrants).where(eq(principalPermissionGrants.principalId, actor.id));
    await expect(read(target.id)).resolves.toMatchObject({ allowed: false, reason: "deny_missing_grant" });
  });

  it("allows suggest grants to read peer agent configuration", async () => {
    const space = await createSpace(db, "AgentReadGrant");
    const actorAgent = await createAgent(db, space.id);
    const targetAgent = await createAgent(db, space.id);
    await grantAgentPermission(db, space.id, actorAgent.id, "agents:suggest-changes");

    const decision = await authorizationService(db).decide({
      actor: { type: "agent", agentId: actorAgent.id, spaceId: space.id, source: "agent_key" },
      action: "agent_config:read",
      resource: { type: "agent", spaceId: space.id, agentId: targetAgent.id },
    });

    expect(decision).toMatchObject({
      allowed: true,
      reason: "allow_explicit_grant",
      grant: {
        principalType: "agent",
        principalId: actorAgent.id,
        permissionKey: "agents:suggest-changes",
      },
    });
  });

  it("reports a scoped legacy read grant denial when no read grant applies", async () => {
    const space = await createSpace(db, "AgentReadScopedSuggestGrant");
    const actorAgent = await createAgent(db, space.id);
    const targetAgent = await createAgent(db, space.id);
    await grantAgentPermission(db, space.id, actorAgent.id, "agents:suggest-changes", {
      projectId: randomUUID(),
    });

    const decision = await authorizationService(db).decide({
      actor: { type: "agent", agentId: actorAgent.id, spaceId: space.id, source: "agent_key" },
      action: "agent_config:read",
      resource: { type: "agent", spaceId: space.id, agentId: targetAgent.id },
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: "deny_scope",
      explanation: "Permission agents:suggest-changes does not cover the requested scope.",
    });
  });

  it("enforces direct or consented suggest grants for agent configuration changes", async () => {
    const space = await createSpace(db, "AgentChangeGrant");
    const directAgent = await createAgent(db, space.id);
    const suggestAgent = await createAgent(db, space.id);
    const noGrantAgent = await createAgent(db, space.id);
    const targetAgent = await createAgent(db, space.id);
    await grantAgentPermission(db, space.id, directAgent.id, "agents:configure");
    await grantAgentPermission(db, space.id, suggestAgent.id, "agents:suggest-changes");
    await db.insert(spaceMemberships).values({
      spaceId: space.id,
      principalType: "agent",
      principalId: noGrantAgent.id,
      status: "active",
      membershipRole: "member",
    });

    const authz = authorizationService(db);
    await expect(authz.decide({
      actor: { type: "agent", agentId: directAgent.id, spaceId: space.id, source: "agent_key" },
      action: "agent_config:update",
      resource: { type: "agent", spaceId: space.id, agentId: targetAgent.id },
      scope: { requiresChangeGrant: true },
    })).resolves.toMatchObject({
      allowed: true,
      reason: "allow_direct_change",
      grant: { permissionKey: "agents:configure" },
    });

    await expect(authz.decide({
      actor: { type: "agent", agentId: suggestAgent.id, spaceId: space.id, source: "agent_key" },
      action: "agent_config:update",
      resource: { type: "agent", spaceId: space.id, agentId: targetAgent.id },
      scope: { requiresChangeGrant: true },
    })).resolves.toMatchObject({
      allowed: false,
      reason: "deny_missing_consent",
      grant: { permissionKey: "agents:suggest-changes" },
    });

    await expect(authz.decide({
      actor: { type: "agent", agentId: suggestAgent.id, spaceId: space.id, source: "agent_key" },
      action: "agent_config:update",
      resource: { type: "agent", spaceId: space.id, agentId: targetAgent.id },
      scope: { requiresChangeGrant: true, consentedChange: true },
    })).resolves.toMatchObject({
      allowed: true,
      reason: "allow_consented_change",
      grant: { permissionKey: "agents:suggest-changes" },
    });

    await expect(authz.decide({
      actor: { type: "agent", agentId: noGrantAgent.id, spaceId: space.id, source: "agent_key" },
      action: "agent_config:update",
      resource: { type: "agent", spaceId: space.id, agentId: targetAgent.id },
      scope: { requiresChangeGrant: true },
    })).resolves.toMatchObject({
      allowed: false,
      reason: "deny_no_grant",
    });
  });

  it("enforces direct or consented suggest grants for skill configuration changes", async () => {
    const space = await createSpace(db, "SkillChangeGrant");
    const directAgent = await createAgent(db, space.id);
    const suggestAgent = await createAgent(db, space.id);
    const noGrantAgent = await createAgent(db, space.id);
    await grantAgentPermission(db, space.id, directAgent.id, "skills:create");
    await grantAgentPermission(db, space.id, suggestAgent.id, "skills:suggest-changes");
    await db.insert(spaceMemberships).values({
      spaceId: space.id,
      principalType: "agent",
      principalId: noGrantAgent.id,
      status: "active",
      membershipRole: "member",
    });

    const authz = authorizationService(db);
    await expect(authz.decide({
      actor: { type: "agent", agentId: directAgent.id, spaceId: space.id, source: "agent_key" },
      action: "skill_config:update",
      resource: { type: "space", spaceId: space.id },
    })).resolves.toMatchObject({
      allowed: true,
      reason: "allow_direct_change",
      grant: { permissionKey: "skills:create" },
    });

    await expect(authz.decide({
      actor: { type: "agent", agentId: suggestAgent.id, spaceId: space.id, source: "agent_key" },
      action: "skill_config:update",
      resource: { type: "space", spaceId: space.id },
    })).resolves.toMatchObject({
      allowed: false,
      reason: "deny_missing_consent",
      grant: { permissionKey: "skills:suggest-changes" },
    });

    await expect(authz.decide({
      actor: { type: "agent", agentId: suggestAgent.id, spaceId: space.id, source: "agent_key" },
      action: "skill_config:update",
      resource: { type: "space", spaceId: space.id },
      scope: { consentedChange: true },
    })).resolves.toMatchObject({
      allowed: true,
      reason: "allow_consented_change",
      grant: { permissionKey: "skills:suggest-changes" },
    });

    await expect(authz.decide({
      actor: { type: "agent", agentId: noGrantAgent.id, spaceId: space.id, source: "agent_key" },
      action: "skill_config:update",
      resource: { type: "space", spaceId: space.id },
    })).resolves.toMatchObject({
      allowed: false,
      reason: "deny_no_grant",
    });
  });

  it("allows operator users with direct skills:create grants to mutate space skills", async () => {
    const space = await createSpace(db, "OperatorUserSkillGrant");
    const userId = await createUser(db);
    await grantUserPermission(db, space.id, userId, "skills:create");

    const decision = await authorizationService(db).decide({
      actor: {
        type: "operator",
        userId,
        spaceIds: [space.id],
        source: "session",
      },
      action: "skill_config:update",
      resource: { type: "space", spaceId: space.id },
    });

    expect(decision).toMatchObject({
      allowed: true,
      reason: "allow_direct_change",
      grant: {
        principalType: "user",
        principalId: userId,
        permissionKey: "skills:create",
      },
    });
  });

  it("allows responsible-user JWT agents with direct skills:create grants to mutate space skills", async () => {
    const space = await createSpace(db, "ResponsibleUserSkillGrant");
    const actorAgent = await createAgent(db, space.id);
    const responsibleUserId = await createUser(db);
    await grantAgentPermission(db, space.id, actorAgent.id, "skills:create");
    await db.insert(spaceMemberships).values({
      spaceId: space.id,
      principalType: "user",
      principalId: responsibleUserId,
      status: "active",
      membershipRole: "operator",
    });

    const decision = await authorizationService(db).decide({
      actor: {
        type: "agent",
        agentId: actorAgent.id,
        spaceId: space.id,
        onBehalfOfUserId: responsibleUserId,
        source: "agent_jwt",
      },
      action: "skill_config:update",
      resource: { type: "space", spaceId: space.id },
    });

    expect(decision).toMatchObject({
      allowed: true,
      reason: "allow_direct_change",
      grant: {
        principalType: "agent",
        principalId: actorAgent.id,
        permissionKey: "skills:create",
      },
    });
  });

  it("keeps responsible-user skill mutations denied for viewer memberships", async () => {
    const space = await createSpace(db, "ResponsibleUserSkillViewerDenied");
    const actorAgent = await createAgent(db, space.id);
    const responsibleUserId = await createUser(db);
    await grantAgentPermission(db, space.id, actorAgent.id, "skills:create");
    await db.insert(spaceMemberships).values({
      spaceId: space.id,
      principalType: "user",
      principalId: responsibleUserId,
      status: "active",
      membershipRole: "viewer",
    });

    const decision = await authorizationService(db).decide({
      actor: {
        type: "agent",
        agentId: actorAgent.id,
        spaceId: space.id,
        onBehalfOfUserId: responsibleUserId,
        source: "agent_jwt",
      },
      action: "skill_config:update",
      resource: { type: "space", spaceId: space.id },
    });

    expect(decision).toMatchObject({
      allowed: false,
      code: "RESPONSIBLE_USER_UNAUTHORIZED",
    });
    expect(decision.explanation).toContain(`Responsible user ${responsibleUserId} is not authorized`);
  });

  it("denies cross-space agent decisions before grant evaluation", async () => {
    const sourceSpace = await createSpace(db, "Source");
    const targetSpace = await createSpace(db, "Target");
    const actorAgent = await createAgent(db, sourceSpace.id);

    const decision = await authorizationService(db).decide({
      actor: { type: "agent", agentId: actorAgent.id, spaceId: sourceSpace.id, source: "agent_jwt" },
      action: "tasks:assign",
      resource: { type: "space", spaceId: targetSpace.id },
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: "deny_space_boundary",
    });
    expect(decision.explanation).toContain("Agent key cannot access another space");
  });

  it("denies cross-space default-open issue writes", async () => {
    const sourceSpace = await createSpace(db, "WriteSource");
    const targetSpace = await createSpace(db, "WriteTarget");
    const actorAgent = await createAgent(db, sourceSpace.id);
    const targetIssue = await createIssue(db, targetSpace.id);
    const authorization = authorizationService(db);

    for (const action of ["issue:comment", "issue:mutate"] as const) {
      await expect(authorization.decide({
        actor: {
          type: "agent",
          agentId: actorAgent.id,
          spaceId: sourceSpace.id,
          source: "agent_jwt",
        },
        action,
        resource: {
          type: "issue",
          spaceId: targetSpace.id,
          issueId: targetIssue.id,
        },
      })).resolves.toMatchObject({
        allowed: false,
        reason: "deny_space_boundary",
      });
    }
  });

  it("allows simple-mode task assignment between same-space agents without explicit grants", async () => {
    const space = await createSpace(db, "AssignmentDefault");
    const actorAgent = await createAgent(db, space.id, { role: "engineer" });
    const targetAgent = await createAgent(db, space.id, { role: "engineer" });
    await db.insert(spaceMemberships).values({
      spaceId: space.id,
      principalType: "agent",
      principalId: actorAgent.id,
      status: "active",
      membershipRole: "member",
    });

    const decision = await authorizationService(db).decide({
      actor: { type: "agent", agentId: actorAgent.id, spaceId: space.id, source: "agent_key" },
      action: "tasks:assign",
      resource: { type: "issue", spaceId: space.id, assigneeAgentId: targetAgent.id },
      scope: { assigneeAgentId: targetAgent.id },
    });

    expect(decision).toMatchObject({
      allowed: true,
      reason: "allow_visible_issue_write",
    });
    expect(decision.explanation).toContain("shared default-open");
  });

  it("allows standard-trust agents to comment on and update visible peer-owned issues", async () => {
    const space = await createSpace(db, "DefaultOpenPeerWrites");
    const actorAgent = await createAgent(db, space.id);
    const ownerAgent = await createAgent(db, space.id);
    const issue = await createIssue(db, space.id, { assigneeAgentId: ownerAgent.id });
    const actor = {
      type: "agent" as const,
      agentId: actorAgent.id,
      spaceId: space.id,
      source: "agent_jwt" as const,
    };
    const resource = {
      type: "issue" as const,
      spaceId: space.id,
      issueId: issue.id,
      assigneeAgentId: ownerAgent.id,
      status: issue.status,
    };
    const authorization = authorizationService(db);

    for (const action of ["issue:comment", "issue:mutate"] as const) {
      await expect(authorization.decide({ actor, action, resource })).resolves.toMatchObject({
        allowed: true,
        reason: "allow_visible_issue_write",
      });
    }
  });

  it("keeps the responsible-user ceiling on every default-open peer write", async () => {
    const space = await createSpace(db, "DefaultOpenPeerWriteCeiling");
    const actorAgent = await createAgent(db, space.id);
    const ownerAgent = await createAgent(db, space.id);
    const issue = await createIssue(db, space.id, { assigneeAgentId: ownerAgent.id });
    const unavailableUserId = await createUser(db);
    const actor = {
      type: "agent" as const,
      agentId: actorAgent.id,
      spaceId: space.id,
      onBehalfOfUserId: unavailableUserId,
      source: "agent_jwt" as const,
    };
    const resource = {
      type: "issue" as const,
      spaceId: space.id,
      issueId: issue.id,
      assigneeAgentId: ownerAgent.id,
      status: issue.status,
    };
    const authorization = authorizationService(db);

    for (const action of ["issue:comment", "issue:mutate"] as const) {
      await expect(authorization.decide({ actor, action, resource })).resolves.toMatchObject({
        allowed: false,
        code: "RESPONSIBLE_USER_UNAVAILABLE",
        reason: "deny_missing_membership",
      });
    }
  });

  it("structurally keeps default-open comments inside issue visibility", async () => {
    const space = await createSpace(db, "CommentReadSubset");
    const project = await createProject(db, space.id, "Visible");
    const outsideProject = await createProject(db, space.id, "Outside");
    const rootIssueId = randomUUID();
    const actorAgent = await createAgent(db, space.id, {
      permissions: {
        trustPreset: LOW_TRUST_REVIEW_PRESET,
        authorizationPolicy: {
          trustBoundary: {
            mode: LOW_TRUST_REVIEW_PRESET,
            projectIds: [project.id],
            rootIssueId,
          },
        },
      },
    });
    const ownerAgent = await createAgent(db, space.id);
    const visibleIssue = await createIssue(db, space.id, {
      id: rootIssueId,
      projectId: project.id,
      assigneeAgentId: ownerAgent.id,
    });
    const hiddenIssue = await createIssue(db, space.id, {
      projectId: outsideProject.id,
      assigneeAgentId: ownerAgent.id,
    });
    const actor = {
      type: "agent" as const,
      agentId: actorAgent.id,
      spaceId: space.id,
      source: "agent_key" as const,
    };
    const authorization = authorizationService(db);

    for (const issue of [visibleIssue, hiddenIssue]) {
      const resource = {
        type: "issue" as const,
        spaceId: space.id,
        issueId: issue.id,
        projectId: issue.projectId,
        parentIssueId: issue.parentId,
        assigneeAgentId: issue.assigneeAgentId,
        status: issue.status,
      };
      const read = await authorization.decide({ actor, action: "issue:read", resource });
      const comment = await authorization.decide({ actor, action: "issue:comment", resource });
      expect(comment.allowed && !read.allowed).toBe(false);
    }
  });

  it("does not let default-open non-assignee comments mint mention grants", async () => {
    const space = await createSpace(db, "DefaultOpenMentionNonTransitive");
    const ownerAgent = await createAgent(db, space.id);
    const commentingAgent = await createAgent(db, space.id);
    const mentionedAgent = await createAgent(db, space.id);
    const issue = await createIssue(db, space.id, { assigneeAgentId: ownerAgent.id });
    await db.insert(issueComments).values({
      spaceId: space.id,
      issueId: issue.id,
      authorAgentId: commentingAgent.id,
      body: `[@Mentioned](agent://${mentionedAgent.id}) please take a look`,
    });

    await expect(authorizationService(db).decide({
      actor: {
        type: "agent",
        agentId: mentionedAgent.id,
        spaceId: space.id,
        source: "agent_jwt",
      },
      action: "issue:comment",
      resource: {
        type: "issue",
        spaceId: space.id,
        issueId: issue.id,
        assigneeAgentId: ownerAgent.id,
        status: issue.status,
      },
    })).resolves.toMatchObject({
      allowed: true,
      reason: "allow_visible_issue_write",
    });
  });

  it("denies delegated protected assignment when the responsible user lacks matching authority", async () => {
    const space = await createSpace(db, "ResponsibleUserDenied");
    const actorAgent = await createAgent(db, space.id, { role: "engineer" });
    const leadAgent = await createAgent(db, space.id, {
      role: "lead",
      permissions: {
        authorizationPolicy: {
          assignmentPolicy: { mode: "protected" },
        },
      },
    });
    const responsibleUserId = await createUser(db);
    await grantAgentPermission(db, space.id, actorAgent.id, "tasks:assign");
    await db.insert(spaceMemberships).values({
      spaceId: space.id,
      principalType: "user",
      principalId: responsibleUserId,
      status: "active",
      membershipRole: "operator",
    });

    const decision = await authorizationService(db).decide({
      actor: {
        type: "agent",
        agentId: actorAgent.id,
        spaceId: space.id,
        onBehalfOfUserId: responsibleUserId,
        source: "agent_jwt",
      },
      action: "tasks:assign",
      resource: { type: "issue", spaceId: space.id, assigneeAgentId: leadAgent.id },
      scope: { assigneeAgentId: leadAgent.id },
    });

    expect(decision).toMatchObject({
      allowed: false,
      code: "RESPONSIBLE_USER_UNAUTHORIZED",
    });
  });

  it("allows active non-viewer responsible users to authorize assigned agent issue mutations", async () => {
    const space = await createSpace(db, "ResponsibleUserIssueMutation");
    const actorAgent = await createAgent(db, space.id, { role: "engineer" });
    const issue = await createIssue(db, space.id, {
      title: "Assigned issue mutation",
      assigneeAgentId: actorAgent.id,
    });
    const responsibleUserId = await createUser(db);
    await db.insert(spaceMemberships).values({
      spaceId: space.id,
      principalType: "user",
      principalId: responsibleUserId,
      status: "active",
      membershipRole: "operator",
    });

    await expect(authorizationService(db).decide({
      actor: {
        type: "agent",
        agentId: actorAgent.id,
        spaceId: space.id,
        onBehalfOfUserId: responsibleUserId,
        source: "agent_jwt",
      },
      action: "issue:mutate",
      resource: {
        type: "issue",
        spaceId: space.id,
        issueId: issue.id,
        assigneeAgentId: actorAgent.id,
      },
    })).resolves.toMatchObject({
      allowed: true,
      reason: "allow_self",
    });
  });

  it("rechecks responsible-user membership on a new request actor after revocation", async () => {
    const space = await createSpace(db, "ResponsibleUserRevocation");
    const actorAgent = await createAgent(db, space.id, { role: "engineer" });
    const issue = await createIssue(db, space.id, {
      title: "Assigned issue mutation after revocation",
      assigneeAgentId: actorAgent.id,
    });
    const responsibleUserId = await createUser(db);
    await db.insert(spaceMemberships).values({
      spaceId: space.id,
      principalType: "user",
      principalId: responsibleUserId,
      status: "active",
      membershipRole: "operator",
    });
    const authz = authorizationService(db);
    const resource = {
      type: "issue" as const,
      spaceId: space.id,
      issueId: issue.id,
      assigneeAgentId: actorAgent.id,
    };

    await expect(authz.decide({
      actor: {
        type: "agent",
        agentId: actorAgent.id,
        spaceId: space.id,
        onBehalfOfUserId: responsibleUserId,
        source: "agent_jwt",
      },
      action: "issue:mutate",
      resource,
    })).resolves.toMatchObject({ allowed: true });

    await db
      .update(spaceMemberships)
      .set({ status: "suspended" })
      .where(and(
        eq(spaceMemberships.spaceId, space.id),
        eq(spaceMemberships.principalType, "user"),
        eq(spaceMemberships.principalId, responsibleUserId),
      ));

    await expect(authz.decide({
      actor: {
        type: "agent",
        agentId: actorAgent.id,
        spaceId: space.id,
        onBehalfOfUserId: responsibleUserId,
        source: "agent_jwt",
      },
      action: "issue:mutate",
      resource,
    })).resolves.toMatchObject({
      allowed: false,
      code: "RESPONSIBLE_USER_UNAVAILABLE",
    });
  });

  it("keeps responsible-user issue mutations denied for viewer memberships", async () => {
    const space = await createSpace(db, "ResponsibleUserIssueViewerDenied");
    const actorAgent = await createAgent(db, space.id, { role: "engineer" });
    const issue = await createIssue(db, space.id, {
      title: "Assigned viewer-denied mutation",
      assigneeAgentId: actorAgent.id,
    });
    const responsibleUserId = await createUser(db);
    await db.insert(spaceMemberships).values({
      spaceId: space.id,
      principalType: "user",
      principalId: responsibleUserId,
      status: "active",
      membershipRole: "viewer",
    });

    await expect(authorizationService(db).decide({
      actor: {
        type: "agent",
        agentId: actorAgent.id,
        spaceId: space.id,
        onBehalfOfUserId: responsibleUserId,
        source: "agent_jwt",
      },
      action: "issue:mutate",
      resource: {
        type: "issue",
        spaceId: space.id,
        issueId: issue.id,
        assigneeAgentId: actorAgent.id,
      },
    })).resolves.toMatchObject({
      allowed: false,
      code: "RESPONSIBLE_USER_UNAUTHORIZED",
      reason: "deny_unsupported_action",
    });
  });

  it("fails closed when the responsible user is unavailable", async () => {
    const space = await createSpace(db, "ResponsibleUserUnavailable");
    const actorAgent = await createAgent(db, space.id, { role: "engineer" });
    const targetAgent = await createAgent(db, space.id, { role: "engineer" });

    const decision = await authorizationService(db).decide({
      actor: {
        type: "agent",
        agentId: actorAgent.id,
        spaceId: space.id,
        onBehalfOfUserId: `missing-${randomUUID()}`,
        source: "agent_jwt",
      },
      action: "tasks:assign",
      resource: { type: "issue", spaceId: space.id, assigneeAgentId: targetAgent.id },
      scope: { assigneeAgentId: targetAgent.id },
    });

    expect(decision).toMatchObject({
      allowed: false,
      code: "RESPONSIBLE_USER_UNAVAILABLE",
    });
  });

  it("allows delegated protected assignment when both agent and responsible user are authorized", async () => {
    const space = await createSpace(db, "ResponsibleUserAllowed");
    const actorAgent = await createAgent(db, space.id, { role: "engineer" });
    const leadAgent = await createAgent(db, space.id, {
      role: "lead",
      permissions: {
        authorizationPolicy: {
          assignmentPolicy: { mode: "protected" },
        },
      },
    });
    const responsibleUserId = await createUser(db);
    await grantAgentPermission(db, space.id, actorAgent.id, "tasks:assign");
    await grantUserPermission(db, space.id, responsibleUserId, "tasks:assign");

    const decision = await authorizationService(db).decide({
      actor: {
        type: "agent",
        agentId: actorAgent.id,
        spaceId: space.id,
        onBehalfOfUserId: responsibleUserId,
        source: "agent_jwt",
      },
      action: "tasks:assign",
      resource: { type: "issue", spaceId: space.id, assigneeAgentId: leadAgent.id },
      scope: { assigneeAgentId: leadAgent.id },
    });

    expect(decision).toMatchObject({
      allowed: true,
      reason: "allow_explicit_grant",
    });
  });

  it("limits low-trust issue reads to the configured project and root issue boundary", async () => {
    const space = await createSpace(db, "LowTrustIssueReads");
    const project = await createProject(db, space.id, "Allowed");
    const otherProject = await createProject(db, space.id, "Denied");
    const rootIssueId = randomUUID();
    const actorAgent = await createAgent(db, space.id, {
      permissions: {
        trustPreset: LOW_TRUST_REVIEW_PRESET,
        authorizationPolicy: {
          trustBoundary: {
            mode: LOW_TRUST_REVIEW_PRESET,
            projectIds: [project.id],
            rootIssueId,
          },
        },
      },
    });
    const rootIssue = await createIssue(db, space.id, {
      id: rootIssueId,
      projectId: project.id,
      assigneeAgentId: actorAgent.id,
    });
    const childIssue = await createIssue(db, space.id, {
      projectId: project.id,
      parentId: rootIssue.id,
    });
    const unrelatedIssue = await createIssue(db, space.id, {
      projectId: otherProject.id,
    });

    const authorization = authorizationService(db);
    const actor = { type: "agent" as const, agentId: actorAgent.id, spaceId: space.id, source: "agent_key" as const };
    const rootDecision = await authorization.decide({
      actor,
      action: "issue:read",
      resource: {
        type: "issue",
        spaceId: space.id,
        issueId: rootIssue.id,
        projectId: rootIssue.projectId,
        parentIssueId: rootIssue.parentId,
        assigneeAgentId: rootIssue.assigneeAgentId,
        status: rootIssue.status,
      },
    });
    const childDecision = await authorization.decide({
      actor,
      action: "issue:read",
      resource: {
        type: "issue",
        spaceId: space.id,
        issueId: childIssue.id,
        projectId: childIssue.projectId,
        parentIssueId: childIssue.parentId,
        status: childIssue.status,
      },
    });
    const unrelatedDecision = await authorization.decide({
      actor,
      action: "issue:read",
      resource: {
        type: "issue",
        spaceId: space.id,
        issueId: unrelatedIssue.id,
        projectId: unrelatedIssue.projectId,
        parentIssueId: unrelatedIssue.parentId,
        status: unrelatedIssue.status,
      },
    });

    expect(rootDecision).toMatchObject({ allowed: true, reason: "allow_low_trust_boundary" });
    expect(childDecision).toMatchObject({ allowed: true, reason: "allow_low_trust_boundary" });
    expect(unrelatedDecision).toMatchObject({ allowed: false, reason: "deny_low_trust_boundary" });
  });

  it("blocks low-trust project, agent, space-wide, and outside-boundary assignment access", async () => {
    const space = await createSpace(db, "LowTrustOtherResources");
    const project = await createProject(db, space.id, "Allowed");
    const otherProject = await createProject(db, space.id, "Denied");
    const collaborator = await createAgent(db, space.id);
    const higherTrustAgent = await createAgent(db, space.id, { role: "engineering_lead" });
    const actorAgent = await createAgent(db, space.id, {
      permissions: {
        trustPreset: LOW_TRUST_REVIEW_PRESET,
        authorizationPolicy: {
          trustBoundary: {
            mode: LOW_TRUST_REVIEW_PRESET,
            projectIds: [project.id],
            allowedAgentIds: [collaborator.id],
          },
        },
      },
    });

    const authorization = authorizationService(db);
    const actor = { type: "agent" as const, agentId: actorAgent.id, spaceId: space.id, source: "agent_key" as const };

    await expect(authorization.decide({
      actor,
      action: "project:read",
      resource: { type: "project", spaceId: space.id, projectId: project.id },
    })).resolves.toMatchObject({ allowed: true, reason: "allow_low_trust_boundary" });
    await expect(authorization.decide({
      actor,
      action: "project:read",
      resource: { type: "project", spaceId: space.id, projectId: otherProject.id },
    })).resolves.toMatchObject({ allowed: false, reason: "deny_low_trust_boundary" });
    await expect(authorization.decide({
      actor,
      action: "agent:read",
      resource: { type: "agent", spaceId: space.id, agentId: collaborator.id },
    })).resolves.toMatchObject({ allowed: true, reason: "allow_low_trust_boundary" });
    await expect(authorization.decide({
      actor,
      action: "agent:read",
      resource: { type: "agent", spaceId: space.id, agentId: higherTrustAgent.id },
    })).resolves.toMatchObject({ allowed: false, reason: "deny_low_trust_boundary" });
    await expect(authorization.decide({
      actor,
      action: "space_scope:read",
      resource: { type: "space", spaceId: space.id },
    })).resolves.toMatchObject({ allowed: false, reason: "deny_low_trust_boundary" });
    await expect(authorization.decide({
      actor,
      action: "tasks:assign",
      resource: {
        type: "issue",
        spaceId: space.id,
        projectId: project.id,
        assigneeAgentId: collaborator.id,
      },
      scope: { projectId: project.id, assigneeAgentId: collaborator.id },
    })).resolves.toMatchObject({ allowed: true, reason: "allow_simple_space_member" });
    await expect(authorization.decide({
      actor,
      action: "tasks:assign",
      resource: {
        type: "issue",
        spaceId: space.id,
        projectId: project.id,
        assigneeAgentId: higherTrustAgent.id,
      },
      scope: { projectId: project.id, assigneeAgentId: higherTrustAgent.id },
    })).resolves.toMatchObject({ allowed: false, reason: "deny_low_trust_boundary" });
  });

  it("blocks low-trust configuration actions before evaluating explicit change grants", async () => {
    const space = await createSpace(db, "LowTrustConfigGrants");
    const project = await createProject(db, space.id, "Allowed");
    const targetAgent = await createAgent(db, space.id);
    const actorAgent = await createAgent(db, space.id, {
      role: "lead",
      permissions: {
        trustPreset: LOW_TRUST_REVIEW_PRESET,
        authorizationPolicy: {
          trustBoundary: {
            mode: LOW_TRUST_REVIEW_PRESET,
            spaceId: space.id,
            projectIds: [project.id],
            allowedAgentIds: [targetAgent.id],
          },
        },
      },
    });
    await grantAgentPermission(db, space.id, actorAgent.id, "agents:configure");
    await db.insert(principalPermissionGrants).values({
      spaceId: space.id,
      principalType: "agent",
      principalId: actorAgent.id,
      permissionKey: "skills:create",
      grantedByUserId: null,
    });

    const authz = authorizationService(db);
    const actor = { type: "agent" as const, agentId: actorAgent.id, spaceId: space.id, source: "agent_key" as const };

    await expect(authz.decide({
      actor,
      action: "agent:read",
      resource: { type: "agent", spaceId: space.id, agentId: targetAgent.id },
    })).resolves.toMatchObject({ allowed: true, reason: "allow_low_trust_boundary" });

    await expect(authz.decide({
      actor,
      action: "agent_config:read",
      resource: { type: "agent", spaceId: space.id, agentId: targetAgent.id },
    })).resolves.toMatchObject({ allowed: false, reason: "deny_low_trust_boundary" });

    await expect(authz.decide({
      actor,
      action: "agent_config:read",
      resource: { type: "agent", spaceId: space.id, agentId: actorAgent.id },
    })).resolves.toMatchObject({ allowed: false, reason: "deny_low_trust_boundary" });

    await expect(authz.decide({
      actor,
      action: "agent_config:update",
      resource: { type: "agent", spaceId: space.id, agentId: targetAgent.id },
      scope: { requiresChangeGrant: true, consentedChange: true },
    })).resolves.toMatchObject({ allowed: false, reason: "deny_low_trust_boundary" });

    await expect(authz.decide({
      actor,
      action: "skill_config:update",
      resource: { type: "space", spaceId: space.id },
      scope: { consentedChange: true },
    })).resolves.toMatchObject({ allowed: false, reason: "deny_low_trust_boundary" });
  });

  it("hard-blocks assignment when the target agent blocks protected assignment", async () => {
    const space = await createSpace(db, "ProtectedAssignment");
    const actorAgent = await createAgent(db, space.id, { role: "engineer" });
    const targetAgent = await createAgent(db, space.id, {
      role: "engineer",
      permissions: {
        authorizationPolicy: {
          assignmentPolicy: {
            mode: "protected",
          },
          protectedAgent: {
            blockAssignment: true,
            blockReason: "Production deployment authority",
          },
          managedBy: "permissions-extension",
        },
      },
    });

    await grantAgentPermission(db, space.id, actorAgent.id, "tasks:assign");

    const decision = await authorizationService(db).decide({
      actor: { type: "agent", agentId: actorAgent.id, spaceId: space.id, source: "agent_key" },
      action: "tasks:assign",
      resource: { type: "issue", spaceId: space.id, assigneeAgentId: targetAgent.id },
      scope: { assigneeAgentId: targetAgent.id },
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: "deny_policy_restricted",
    });
    expect(decision.explanation).toBe(
      "Target agent assignment is blocked by protected-agent policy. " +
      "A space administrator can remove the assignment block, then retry.",
    );
    expect(decision.explanation).not.toContain("approval");
  });

  it("keeps legacy protected-assignment approval flags as hard blocks without approval copy", async () => {
    const space = await createSpace(db, "LegacyProtectedAssignment");
    const actorAgent = await createAgent(db, space.id, { role: "engineer" });
    const targetAgent = await createAgent(db, space.id, {
      role: "engineer",
      permissions: {
        authorizationPolicy: {
          assignmentPolicy: {
            mode: "protected",
            protectedAgentRequiresApproval: true,
          },
          protectedAgent: {
            requiresApproval: true,
          },
        },
      },
    });

    await grantAgentPermission(db, space.id, actorAgent.id, "tasks:assign");

    const decision = await authorizationService(db).decide({
      actor: { type: "agent", agentId: actorAgent.id, spaceId: space.id, source: "agent_key" },
      action: "tasks:assign",
      resource: { type: "issue", spaceId: space.id, assigneeAgentId: targetAgent.id },
      scope: { assigneeAgentId: targetAgent.id },
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: "deny_policy_restricted",
    });
    expect(decision.explanation).toContain("assignment is blocked");
    expect(decision.explanation).toContain("space administrator");
    expect(decision.explanation).not.toContain("approval");
  });

  it("requires an explicit grant before assigning to a private target agent", async () => {
    const space = await createSpace(db, "PrivateAssignment");
    const actorAgent = await createAgent(db, space.id, { role: "engineer" });
    const targetAgent = await createAgent(db, space.id, {
      role: "engineer",
      permissions: {
        authorizationPolicy: {
          agentVisibility: {
            mode: "private",
            hiddenFromDefaultDirectory: true,
          },
          assignmentPolicy: {
            mode: "space_default",
            protectedAgentRequiresApproval: false,
          },
          protectedAgent: {
            requiresApproval: false,
          },
          managedBy: "permissions-extension",
        },
      },
    });

    const denied = await authorizationService(db).decide({
      actor: { type: "agent", agentId: actorAgent.id, spaceId: space.id, source: "agent_key" },
      action: "tasks:assign",
      resource: { type: "issue", spaceId: space.id, assigneeAgentId: targetAgent.id },
      scope: { assigneeAgentId: targetAgent.id },
    });

    await grantAgentPermission(db, space.id, actorAgent.id, "tasks:assign_scope", {
      assigneeAgentId: targetAgent.id,
    });

    const allowed = await authorizationService(db).decide({
      actor: { type: "agent", agentId: actorAgent.id, spaceId: space.id, source: "agent_key" },
      action: "tasks:assign",
      resource: { type: "issue", spaceId: space.id, assigneeAgentId: targetAgent.id },
      scope: { assigneeAgentId: targetAgent.id },
    });

    expect(denied).toMatchObject({
      allowed: false,
      reason: "deny_policy_restricted",
    });
    expect(denied.explanation).toContain("private");
    expect(allowed).toMatchObject({
      allowed: true,
      reason: "allow_explicit_grant",
      grant: { permissionKey: "tasks:assign_scope" },
    });
  });

  it("allows simple-mode task assignment for active same-space operator operators without explicit grants", async () => {
    const space = await createSpace(db, "OperatorAssignmentDefault");
    const userId = `user-${randomUUID()}`;
    const targetAgent = await createAgent(db, space.id, { role: "engineer" });
    await db.insert(spaceMemberships).values({
      spaceId: space.id,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "operator",
    });

    const decision = await authorizationService(db).decide({
      actor: { type: "operator", userId, source: "session" },
      action: "tasks:assign",
      resource: { type: "issue", spaceId: space.id, assigneeAgentId: targetAgent.id },
      scope: { assigneeAgentId: targetAgent.id },
    });

    expect(decision).toMatchObject({
      allowed: true,
      reason: "allow_simple_space_member",
    });
  });

  it("allows null-mapped visibility actions for active same-space operator members", async () => {
    const space = await createSpace(db, "OperatorVisibility");
    const userId = `user-${randomUUID()}`;
    const project = await createProject(db, space.id, "Visible");
    const targetAgent = await createAgent(db, space.id, { role: "engineer" });
    const issue = await createIssue(db, space.id, { projectId: project.id });
    await db.insert(spaceMemberships).values({
      spaceId: space.id,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "member",
    });

    const authorization = authorizationService(db);
    const actor = { type: "operator" as const, userId, source: "session" as const };

    await expect(authorization.decide({
      actor,
      action: "agent:read",
      resource: { type: "agent", spaceId: space.id, agentId: targetAgent.id },
    })).resolves.toMatchObject({ allowed: true, reason: "allow_simple_space_member" });
    await expect(authorization.decide({
      actor,
      action: "space_scope:read",
      resource: { type: "space", spaceId: space.id },
    })).resolves.toMatchObject({ allowed: true, reason: "allow_simple_space_member" });
    await expect(authorization.decide({
      actor,
      action: "project:read",
      resource: { type: "project", spaceId: space.id, projectId: project.id },
    })).resolves.toMatchObject({ allowed: true, reason: "allow_simple_space_member" });
    await expect(authorization.decide({
      actor,
      action: "issue:read",
      resource: {
        type: "issue",
        spaceId: space.id,
        issueId: issue.id,
        projectId: issue.projectId,
        parentIssueId: issue.parentId,
        status: issue.status,
      },
    })).resolves.toMatchObject({ allowed: true, reason: "allow_simple_space_member" });
    await expect(authorization.decide({
      actor,
      action: "runtime:manage",
      resource: { type: "space", spaceId: space.id },
    })).resolves.toMatchObject({ allowed: true, reason: "allow_simple_space_member" });
    await expect(authorization.decide({
      actor,
      action: "secrets:read",
      resource: { type: "space", spaceId: space.id },
    })).resolves.toMatchObject({ allowed: true, reason: "allow_simple_space_member" });
  });

  it("allows same-space non-viewer operator members to comment and mutate issues assigned to another agent", async () => {
    const space = await createSpace(db, "OperatorIssueMutation");
    const userId = `user-${randomUUID()}`;
    const assignee = await createAgent(db, space.id, { role: "engineer" });
    const issue = await createIssue(db, space.id, { assigneeAgentId: assignee.id });
    await db.insert(spaceMemberships).values({
      spaceId: space.id,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "operator",
    });

    const authorization = authorizationService(db);
    const actor = { type: "operator" as const, userId, source: "operator_key" as const };
    const resource = {
      type: "issue" as const,
      spaceId: space.id,
      issueId: issue.id,
      projectId: issue.projectId,
      parentIssueId: issue.parentId,
      assigneeAgentId: issue.assigneeAgentId,
      assigneeUserId: issue.assigneeUserId,
      status: issue.status,
    };

    await expect(authorization.decide({
      actor,
      action: "issue:comment",
      resource,
    })).resolves.toMatchObject({ allowed: true, reason: "allow_simple_space_member" });
    await expect(authorization.decide({
      actor,
      action: "issue:mutate",
      resource,
    })).resolves.toMatchObject({ allowed: true, reason: "allow_simple_space_member" });
  });

  it("denies same-space viewer operator members issue comment and mutation", async () => {
    const space = await createSpace(db, "OperatorViewerIssueMutation");
    const userId = `user-${randomUUID()}`;
    const assignee = await createAgent(db, space.id, { role: "engineer" });
    const issue = await createIssue(db, space.id, { assigneeAgentId: assignee.id });
    await db.insert(spaceMemberships).values({
      spaceId: space.id,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "viewer",
    });

    const authorization = authorizationService(db);
    const actor = { type: "operator" as const, userId, source: "operator_key" as const };
    const resource = {
      type: "issue" as const,
      spaceId: space.id,
      issueId: issue.id,
      projectId: issue.projectId,
      parentIssueId: issue.parentId,
      assigneeAgentId: issue.assigneeAgentId,
      assigneeUserId: issue.assigneeUserId,
      status: issue.status,
    };

    await expect(authorization.decide({
      actor,
      action: "issue:comment",
      resource,
    })).resolves.toMatchObject({ allowed: false, reason: "deny_missing_grant" });
    await expect(authorization.decide({
      actor,
      action: "issue:mutate",
      resource,
    })).resolves.toMatchObject({ allowed: false, reason: "deny_missing_grant" });
  });

  it("denies null-mapped visibility actions for operator users without an active membership", async () => {
    const memberSpace = await createSpace(db, "OperatorVisibilityMember");
    const otherSpace = await createSpace(db, "OperatorVisibilityOther");
    const userId = `user-${randomUUID()}`;
    const targetAgent = await createAgent(db, otherSpace.id, { role: "engineer" });
    const inactiveUserId = `user-${randomUUID()}`;
    await db.insert(spaceMemberships).values({
      spaceId: memberSpace.id,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "member",
    });
    await db.insert(spaceMemberships).values({
      spaceId: otherSpace.id,
      principalType: "user",
      principalId: inactiveUserId,
      status: "removed",
      membershipRole: "member",
    });

    const authorization = authorizationService(db);

    await expect(authorization.decide({
      actor: { type: "operator", userId, source: "session" },
      action: "agent:read",
      resource: { type: "agent", spaceId: otherSpace.id, agentId: targetAgent.id },
    })).resolves.toMatchObject({ allowed: false, reason: "deny_missing_membership" });
    await expect(authorization.decide({
      actor: { type: "operator", userId: inactiveUserId, source: "session" },
      action: "space_scope:read",
      resource: { type: "space", spaceId: otherSpace.id },
    })).resolves.toMatchObject({ allowed: false, reason: "deny_missing_membership" });
  });

  it("allows legacy member roles to wake agents while rejecting incomplete task mutation scope", async () => {
    const space = await createSpace(db, "OperatorWake");
    const userId = `user-${randomUUID()}`;
    const targetAgent = await createAgent(db, space.id, { role: "engineer" });
    await db.insert(spaceMemberships).values({
      spaceId: space.id,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "member",
    });

    const authorization = authorizationService(db);

    await expect(authorization.decide({
      actor: { type: "operator", userId, source: "session" },
      action: "agent:wake",
      resource: { type: "agent", spaceId: space.id, agentId: targetAgent.id },
    })).resolves.toMatchObject({
      allowed: true,
      reason: "allow_simple_space_member",
    });
    const issue = await createIssue(db, space.id, { title: "Wake denied issue" });
    await expect(authorization.decide({
      actor: { type: "operator", userId, source: "session" },
      action: "issue:mutate",
      resource: { type: "issue", spaceId: space.id, issueId: issue.id },
    })).resolves.toMatchObject({
      allowed: false,
      reason: "deny_unsupported_action",
    });
  });

  it("allows mentioned agents to read and comment on assigned issues without granting issue mutation", async () => {
    const space = await createSpace(db, "MentionCommentAuth");
    const allowedProject = await createProject(db, space.id, "MentionAllowed");
    const targetProject = await createProject(db, space.id, "MentionTarget");
    const ownerAgent = await createAgent(db, space.id, { role: "engineer" });
    const mentionedAgent = await createAgent(db, space.id, {
      role: "engineer",
      permissions: {
        trustPreset: LOW_TRUST_REVIEW_PRESET,
        authorizationPolicy: {
          trustBoundary: {
            mode: LOW_TRUST_REVIEW_PRESET,
            spaceId: space.id,
            projectIds: [allowedProject.id],
          },
        },
      },
    });
    const issue = await createIssue(db, space.id, {
      title: "Mention-scoped comment target",
      projectId: targetProject.id,
      assigneeAgentId: ownerAgent.id,
    });

    const authorization = authorizationService(db);
    const actor = { type: "agent", agentId: mentionedAgent.id, spaceId: space.id, source: "agent_key" } as const;
    const resource = {
      type: "issue",
      spaceId: space.id,
      issueId: issue.id,
      projectId: issue.projectId,
      assigneeAgentId: ownerAgent.id,
      status: issue.status,
    } as const;

    await expect(authorization.decide({
      actor,
      action: "issue:comment",
      resource,
    })).resolves.toMatchObject({ allowed: false, reason: "deny_low_trust_boundary" });

    const deletedMention = await db.insert(issueComments).values({
      spaceId: space.id,
      issueId: issue.id,
      body: `[@Mentioned Agent](agent://${mentionedAgent.id}) this deleted comment should not count`,
      deletedAt: new Date(),
    }).returning().then((rows) => rows[0]!);
    expect(deletedMention.id).toBeTruthy();

    await expect(authorization.decide({
      actor,
      action: "issue:comment",
      resource,
    })).resolves.toMatchObject({ allowed: false, reason: "deny_low_trust_boundary" });

    await db.insert(issueComments).values({
      spaceId: space.id,
      issueId: issue.id,
      body: `[@Mentioned Agent](agent://${mentionedAgent.id}) please respond here`,
      authorAgentId: ownerAgent.id,
    });

    await expect(authorization.decide({
      actor,
      action: "issue:read",
      resource,
    })).resolves.toMatchObject({
      allowed: true,
      reason: "allow_issue_mention_grant",
    });
    await expect(authorization.decide({
      actor,
      action: "issue:comment",
      resource,
    })).resolves.toMatchObject({
      allowed: true,
      reason: "allow_issue_mention_grant",
    });
    await expect(authorization.decide({
      actor,
      action: "issue:mutate",
      resource,
    })).resolves.toMatchObject({ allowed: false, reason: "deny_low_trust_boundary" });
  });

  it("allows a mentioned non-assignee to comment when the mention author is the issue assignee", async () => {
    const space = await createSpace(db, "MentionCommentAssigneeGrant");
    const allowedProject = await createProject(db, space.id, "MentionAssigneeAllowed");
    const targetProject = await createProject(db, space.id, "MentionAssigneeTarget");
    const assigneeAgent = await createAgent(db, space.id, { role: "coach" });
    const mentionedAgent = await createAgent(db, space.id, {
      role: "qa",
      permissions: {
        trustPreset: LOW_TRUST_REVIEW_PRESET,
        authorizationPolicy: {
          trustBoundary: {
            mode: LOW_TRUST_REVIEW_PRESET,
            spaceId: space.id,
            projectIds: [allowedProject.id],
          },
        },
      },
    });
    const issue = await createIssue(db, space.id, {
      title: "Assignee-authored mention reply target",
      projectId: targetProject.id,
      assigneeAgentId: assigneeAgent.id,
    });
    await db.insert(issueComments).values({
      spaceId: space.id,
      issueId: issue.id,
      authorAgentId: assigneeAgent.id,
      authorType: "agent",
      body: `[@QA](agent://${mentionedAgent.id}) please reply on this issue.`,
    });

    await expect(authorizationService(db).decide({
      actor: { type: "agent", agentId: mentionedAgent.id, spaceId: space.id, source: "agent_key" },
      action: "issue:comment",
      resource: {
        type: "issue",
        spaceId: space.id,
        issueId: issue.id,
        projectId: issue.projectId,
        assigneeAgentId: assigneeAgent.id,
        status: issue.status,
      },
    })).resolves.toMatchObject({
      allowed: true,
      reason: "allow_issue_mention_grant",
    });
  });

  it("does not grant mention-scoped issue access from self-authored or unauthorized-author comments", async () => {
    const space = await createSpace(db, "MentionCommentDenied");
    const allowedProject = await createProject(db, space.id, "MentionDeniedAllowed");
    const targetProject = await createProject(db, space.id, "MentionDeniedTarget");
    const ownerAgent = await createAgent(db, space.id, { role: "engineer" });
    const mentionedAgent = await createAgent(db, space.id, {
      role: "engineer",
      permissions: {
        trustPreset: LOW_TRUST_REVIEW_PRESET,
        authorizationPolicy: {
          trustBoundary: {
            mode: LOW_TRUST_REVIEW_PRESET,
            spaceId: space.id,
            projectIds: [allowedProject.id],
          },
        },
      },
    });
    const unrelatedAgent = await createAgent(db, space.id, { role: "engineer" });
    const issue = await createIssue(db, space.id, {
      title: "Mention-scoped comment denial target",
      projectId: targetProject.id,
      assigneeAgentId: ownerAgent.id,
    });

    const authorization = authorizationService(db);
    const actor = { type: "agent", agentId: mentionedAgent.id, spaceId: space.id, source: "agent_key" } as const;
    const resource = {
      type: "issue",
      spaceId: space.id,
      issueId: issue.id,
      projectId: issue.projectId,
      assigneeAgentId: ownerAgent.id,
      status: issue.status,
    } as const;

    await db.insert(issueComments).values([
      {
        spaceId: space.id,
        issueId: issue.id,
        body: `Self mention [@Mentioned Agent](agent://${mentionedAgent.id})`,
        authorAgentId: mentionedAgent.id,
      },
      {
        spaceId: space.id,
        issueId: issue.id,
        body: `Unauthorized mention [@Mentioned Agent](agent://${mentionedAgent.id})`,
        authorAgentId: unrelatedAgent.id,
      },
    ]);

    await expect(authorization.decide({
      actor,
      action: "issue:read",
      resource,
    })).resolves.toMatchObject({ allowed: false, reason: "deny_low_trust_boundary" });
    await expect(authorization.decide({
      actor,
      action: "issue:comment",
      resource,
    })).resolves.toMatchObject({ allowed: false, reason: "deny_low_trust_boundary" });
  });

  it("allows active operator-user comments to create mention-scoped issue grants", async () => {
    const space = await createSpace(db, "MentionCommentBoardGrant");
    const allowedProject = await createProject(db, space.id, "MentionBoardAllowed");
    const targetProject = await createProject(db, space.id, "MentionBoardTarget");
    const ownerAgent = await createAgent(db, space.id, { role: "engineer" });
    const mentionedAgent = await createAgent(db, space.id, {
      role: "engineer",
      permissions: {
        trustPreset: LOW_TRUST_REVIEW_PRESET,
        authorizationPolicy: {
          trustBoundary: {
            mode: LOW_TRUST_REVIEW_PRESET,
            spaceId: space.id,
            projectIds: [allowedProject.id],
          },
        },
      },
    });
    const issue = await createIssue(db, space.id, {
      title: "Mention-scoped operator grant target",
      projectId: targetProject.id,
      assigneeAgentId: ownerAgent.id,
    });
    const operatorUserId = `user-${randomUUID()}`;
    await db.insert(spaceMemberships).values({
      spaceId: space.id,
      principalType: "user",
      principalId: operatorUserId,
      status: "active",
      membershipRole: "member",
    });
    await db.insert(issueComments).values({
      spaceId: space.id,
      issueId: issue.id,
      body: `Operator mention [@Mentioned Agent](agent://${mentionedAgent.id})`,
      authorUserId: operatorUserId,
    });

    const actor = { type: "agent", agentId: mentionedAgent.id, spaceId: space.id, source: "agent_key" } as const;
    const resource = {
      type: "issue",
      spaceId: space.id,
      issueId: issue.id,
      projectId: issue.projectId,
      assigneeAgentId: ownerAgent.id,
      status: issue.status,
    } as const;

    await expect(authorizationService(db).decide({
      actor,
      action: "issue:comment",
      resource,
    })).resolves.toMatchObject({
      allowed: true,
      reason: "allow_issue_mention_grant",
    });
  });

  it.each(["session", "cloud_tenant"] as const)("allows %s operators to start agents, without granting creation rights", async (source) => {
    const space = await createSpace(db, "wake");
    const agent = await createAgent(db, space.id);
    const userId = await createUser(db);
    await db.insert(spaceMemberships).values({ spaceId: space.id,
      principalType: "user", principalId: userId, status: "active", membershipRole: "operator" });
    const auth = authorizationService(db);
    const actor = { type: "operator" as const, source, userId, spaceIds: [space.id] };
    const resource = { type: "agent" as const, spaceId: space.id, agentId: agent.id };
    expect(await auth.decide({ actor, action: "agent:wake", resource })).toMatchObject({ allowed: true });
    expect(await auth.decide({ actor, action: "agents:create", resource: { type: "space", spaceId: space.id } })).toMatchObject({ allowed: false });
    await db.update(spaceMemberships).set({ membershipRole: "viewer" }).where(eq(spaceMemberships.principalId, userId));
    expect(await auth.decide({ actor, action: "agent:wake", resource })).toMatchObject({ allowed: false });
    await db.update(spaceMemberships).set({ membershipRole: "operator", status: "suspended" }).where(eq(spaceMemberships.principalId, userId));
    expect(await auth.decide({ actor, action: "agent:wake", resource })).toMatchObject({ allowed: false });
    const otherSpace = await createSpace(db, "other-wake");
    expect(await auth.decide({ actor, action: "agent:wake", resource: { ...resource, spaceId: otherSpace.id } })).toMatchObject({ allowed: false });
  });

  it.each(["session", "cloud_tenant"] as const)("restricts %s workspace-owner stop confirmation to administrators", async source => {
    const space = await createSpace(db, "OwnerStop");
    const otherSpace = await createSpace(db, "OtherOwnerStop");
    const userId = await createUser(db);
    await db.insert(spaceMemberships).values({ spaceId: space.id,
      principalType: "user", principalId: userId, status: "active", membershipRole: "owner" });
    const actor = { type: "operator" as const, source, userId, spaceIds: [space.id] };
    const auth = authorizationService(db);
    const request = { actor, action: "runtime:confirm_owner_stop" as const,
      resource: { type: "space" as const, spaceId: space.id } };
    for (const membershipRole of ["owner", "admin", "operator", "member", "viewer", null]) {
      await db.update(spaceMemberships).set({ membershipRole }).where(eq(spaceMemberships.principalId, userId));
      expect((await auth.decide(request)).allowed, `role ${membershipRole}`).toBe(membershipRole === "owner" || membershipRole === "admin");
    }
    await db.update(spaceMemberships).set({ membershipRole: "admin", status: "suspended" }).where(eq(spaceMemberships.principalId, userId));
    expect((await auth.decide(request)).allowed).toBe(false);
    await db.update(spaceMemberships).set({ status: "active" }).where(eq(spaceMemberships.principalId, userId));
    expect((await auth.decide({ ...request, resource: { type: "space", spaceId: otherSpace.id } })).allowed).toBe(false);
  });

  it("does not allow agent delegation or stale cloud admin rows to confirm an owner stop", async () => {
    const space = await createSpace(db, "OwnerStopDelegation");
    const userId = await createUser(db);
    const agent = await createAgent(db, space.id, { role: "lead" });
    await db.insert(spaceMemberships).values({ spaceId: space.id,
      principalType: "user", principalId: userId, status: "active", membershipRole: "operator" });
    await db.insert(instanceUserRoles).values({ userId, role: "instance_admin" });
    const auth = authorizationService(db);
    const request = { action: "runtime:confirm_owner_stop" as const, resource: { type: "space" as const, spaceId: space.id } };
    expect((await auth.decide({ ...request, actor: { type: "operator", userId, source: "cloud_tenant", isInstanceAdmin: false } })).allowed).toBe(false);
    expect((await auth.decide({ ...request, actor: { type: "agent", agentId: agent.id, spaceId: space.id, onBehalfOfUserId: userId } })).allowed).toBe(false);
    expect((await auth.decide({ ...request, actor: { type: "operator", userId, source: "cloud_tenant", isInstanceAdmin: true } })).allowed).toBe(true);
    expect((await auth.decide({ ...request, actor: { type: "operator", source: "local_implicit" } })).allowed).toBe(true);
  });

  it("limits viewer members to read-only visibility actions", async () => {
    const space = await createSpace(db, "OperatorViewerVisibility");
    const userId = `user-${randomUUID()}`;
    const targetAgent = await createAgent(db, space.id, { role: "engineer" });
    await db.insert(spaceMemberships).values({
      spaceId: space.id,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "viewer",
    });

    const authorization = authorizationService(db);
    const actor = { type: "operator", userId, source: "session" } as const;

    await expect(authorization.decide({
      actor,
      action: "agent:read",
      resource: { type: "agent", spaceId: space.id, agentId: targetAgent.id },
    })).resolves.toMatchObject({ allowed: true, reason: "allow_simple_space_member" });
    await expect(authorization.decide({
      actor,
      action: "space_scope:read",
      resource: { type: "space", spaceId: space.id },
    })).resolves.toMatchObject({ allowed: true, reason: "allow_simple_space_member" });
    await expect(authorization.decide({
      actor,
      action: "runtime:manage",
      resource: { type: "space", spaceId: space.id },
    })).resolves.toMatchObject({ allowed: false, reason: "deny_missing_grant" });
    await expect(authorization.decide({
      actor,
      action: "secrets:read",
      resource: { type: "space", spaceId: space.id },
    })).resolves.toMatchObject({ allowed: false, reason: "deny_missing_grant" });
  });

  it("denies legacy operator assignment context for viewers", async () => {
    const space = await createSpace(db, "OperatorViewerAssignment");
    const userId = `user-${randomUUID()}`;
    const targetAgent = await createAgent(db, space.id, { role: "engineer" });
    await db.insert(spaceMemberships).values({
      spaceId: space.id,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "viewer",
    });

    const decision = await authorizationService(db).decide({
      actor: { type: "operator", userId, spaceIds: [space.id], source: "session" },
      action: "tasks:assign",
      resource: { type: "issue", spaceId: space.id, assigneeAgentId: targetAgent.id },
      scope: { assigneeAgentId: targetAgent.id },
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: "deny_missing_grant",
    });
  });

  it("never elevates cloud_tenant actors through stale instance_admin rows", async () => {
    const tenantSpace = await createSpace(db, "CloudTenantStale");
    const otherSpace = await createSpace(db, "CloudTenantOther");
    const userId = `user-${randomUUID()}`;
    const targetAgent = await createAgent(db, otherSpace.id, { role: "engineer" });
    await db.insert(spaceMemberships).values({
      spaceId: tenantSpace.id,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "owner",
    });
    // Stale grant left behind by a pre-hardening cloud_tenant deployment.
    await db.insert(instanceUserRoles).values({ userId, role: "instance_admin" });

    const decision = await authorizationService(db).decide({
      actor: {
        type: "operator",
        userId,
        spaceIds: [tenantSpace.id],
        isInstanceAdmin: false,
        source: "cloud_tenant",
      },
      action: "tasks:assign",
      resource: { type: "issue", spaceId: otherSpace.id, assigneeAgentId: targetAgent.id },
      scope: { assigneeAgentId: targetAgent.id },
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).not.toBe("allow_instance_admin");

    // Control: the instanceUserRoles lookup still elevates non-cloud_tenant
    // operator actors, so the carve-out is scoped to the tenant contract only.
    const sessionDecision = await authorizationService(db).decide({
      actor: { type: "operator", userId, spaceIds: [tenantSpace.id], source: "session" },
      action: "tasks:assign",
      resource: { type: "issue", spaceId: otherSpace.id, assigneeAgentId: targetAgent.id },
      scope: { assigneeAgentId: targetAgent.id },
    });
    expect(sessionDecision).toMatchObject({ allowed: true, reason: "allow_instance_admin" });
  });

  it("trusts the computed isInstanceAdmin flag on cloud_tenant actors", async () => {
    // The trusted-header resolver is the only code path that can set
    // isInstanceAdmin on a cloud_tenant actor (stack owner +
    // enableOwnerInstanceAdmin). The authorization service must honor the
    // computed flag without consulting instance_user_roles.
    const tenantSpace = await createSpace(db, "CloudTenantOwnerAdmin");
    const otherSpace = await createSpace(db, "CloudTenantOwnerAdminOther");
    const userId = `user-${randomUUID()}`;
    const targetAgent = await createAgent(db, otherSpace.id, { role: "engineer" });
    await db.insert(spaceMemberships).values({
      spaceId: tenantSpace.id,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "owner",
    });
    // Deliberately NO instanceUserRoles row: elevation is computed, not stored.

    const decision = await authorizationService(db).decide({
      actor: {
        type: "operator",
        userId,
        spaceIds: [tenantSpace.id],
        isInstanceAdmin: true,
        source: "cloud_tenant",
      },
      action: "tasks:assign",
      resource: { type: "issue", spaceId: otherSpace.id, assigneeAgentId: targetAgent.id },
      scope: { assigneeAgentId: targetAgent.id },
    });
    expect(decision).toMatchObject({ allowed: true, reason: "allow_instance_admin" });
  });

  it("denies simple-mode assignment to a target agent from another space", async () => {
    const sourceSpace = await createSpace(db, "AssignmentSource");
    const targetSpace = await createSpace(db, "AssignmentTarget");
    const actorAgent = await createAgent(db, sourceSpace.id, { role: "engineer" });
    const targetAgent = await createAgent(db, targetSpace.id, { role: "engineer" });
    await db.insert(spaceMemberships).values({
      spaceId: sourceSpace.id,
      principalType: "agent",
      principalId: actorAgent.id,
      status: "active",
      membershipRole: "member",
    });

    const decision = await authorizationService(db).decide({
      actor: { type: "agent", agentId: actorAgent.id, spaceId: sourceSpace.id, source: "agent_key" },
      action: "tasks:assign",
      resource: { type: "issue", spaceId: sourceSpace.id, assigneeAgentId: targetAgent.id },
      scope: { assigneeAgentId: targetAgent.id },
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: "deny_space_boundary",
    });
  });

  it("does not derive agent creator authority from a legacy Default agent title", async () => {
    const space = await createSpace(db, "Legacy");
    const actorAgent = await createAgent(db, space.id, { role: "lead" });

    const decision = await authorizationService(db).decide({
      actor: { type: "agent", agentId: actorAgent.id, spaceId: space.id, source: "agent_jwt" },
      action: "agents:create",
      resource: { type: "space", spaceId: space.id },
    });

    expect(decision).toMatchObject({ allowed: false, reason: "deny_missing_grant" });
  });

  it("honors a operator-recorded creation denial on a Default agent instead of the Default agent title", async () => {
    const space = await createSpace(db, "DefaultAgentCreateDenied");
    const actorAgent = await createAgent(db, space.id, {
      role: "lead",
      permissions: { canCreateAgents: false, canCreateSkills: true, leadCreationDeniedBy: { actorType: "user", actorId: "operator-user", at: "2026-11-08T00:00:00.000Z" } },
    });

    const decision = await authorizationService(db).decide({
      actor: { type: "agent", agentId: actorAgent.id, spaceId: space.id, source: "agent_jwt" },
      action: "agents:create",
      resource: { type: "space", spaceId: space.id },
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: "deny_missing_grant",
      explanation: "Missing permission: agents:create.",
    });
  });

  it("honors an explicit false regardless of legacy title", async () => {
    const space = await createSpace(db, "DefaultAgentUnrecordedFalse");
    const actorAgent = await createAgent(db, space.id, {
      role: "lead",
      permissions: { canCreateAgents: false, canCreateSkills: true },
    });

    const decision = await authorizationService(db).decide({
      actor: { type: "agent", agentId: actorAgent.id, spaceId: space.id, source: "agent_jwt" },
      action: "agents:create",
      resource: { type: "space", spaceId: space.id },
    });

    expect(decision).toMatchObject({ allowed: false, reason: "deny_missing_grant" });
  });

  it("does not treat the compatibility toggle as authority", async () => {
    const space = await createSpace(db, "DefaultCreate");
    const actorAgent = await createAgent(db, space.id, {
      role: "engineer",
      permissions: { canCreateAgents: true, canCreateSkills: true },
    });

    const decision = await authorizationService(db).decide({
      actor: { type: "agent", agentId: actorAgent.id, spaceId: space.id, source: "agent_jwt" },
      action: "agents:create",
      resource: { type: "space", spaceId: space.id },
    });

    expect(decision).toMatchObject({ allowed: false, reason: "deny_missing_grant" });
  });

  it("grants create authority through an explicit permission grant", async () => {
    const space = await createSpace(db, "ExplicitCreateGrant");
    const actorAgent = await createAgent(db, space.id, { role: "general" });
    await grantAgentPermission(db, space.id, actorAgent.id, "agents:create");

    const decision = await authorizationService(db).decide({
      actor: { type: "agent", agentId: actorAgent.id, spaceId: space.id, source: "agent_jwt" },
      action: "agents:create",
      resource: { type: "space", spaceId: space.id },
    });

    expect(decision).toMatchObject({ allowed: true, reason: "allow_explicit_grant" });
  });

  it("keeps legacy rows without an explicit canCreateAgents fail-closed", async () => {
    const space = await createSpace(db, "LegacyRowFailClosed");
    const actorAgent = await createAgent(db, space.id, { role: "engineer", permissions: {} });

    const decision = await authorizationService(db).decide({
      actor: { type: "agent", agentId: actorAgent.id, spaceId: space.id, source: "agent_jwt" },
      action: "agents:create",
      resource: { type: "space", spaceId: space.id },
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: "deny_missing_grant",
    });
  });

  it("denies agent creation for a low-trust boundary even with explicit canCreateAgents", async () => {
    const space = await createSpace(db, "LowTrustCreateDenied");
    const project = await createProject(db, space.id, "Contained");
    const actorAgent = await createAgent(db, space.id, {
      permissions: {
        canCreateAgents: true,
        trustPreset: LOW_TRUST_REVIEW_PRESET,
        authorizationPolicy: {
          trustBoundary: {
            mode: LOW_TRUST_REVIEW_PRESET,
            projectIds: [project.id],
          },
        },
      },
    });

    const decision = await authorizationService(db).decide({
      actor: { type: "agent", agentId: actorAgent.id, spaceId: space.id, source: "agent_jwt" },
      action: "agents:create",
      resource: { type: "space", spaceId: space.id },
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: "deny_low_trust_boundary",
    });
  });

  it("denies active-checkout management outside the Default agent caller space scope", async () => {
    const sourceSpace = await createSpace(db, "CheckoutSource");
    const targetSpace = await createSpace(db, "CheckoutTarget");
    const actorAgent = await createAgent(db, sourceSpace.id, { role: "lead" });
    const targetAgent = await createAgent(db, targetSpace.id, { role: "engineer" });

    const decision = await authorizationService(db).decide({
      actor: { type: "agent", agentId: actorAgent.id, spaceId: sourceSpace.id, source: "agent_jwt" },
      action: "tasks:manage_active_checkouts",
      resource: { type: "issue", spaceId: targetSpace.id, assigneeAgentId: targetAgent.id },
    });

    expect(decision).toMatchObject({
      allowed: false,
      reason: "deny_space_boundary",
    });
    expect(decision.explanation).toContain("another space");
  });

  it("allows scoped assignment inside a granted project and denies other projects", async () => {
    const space = await createSpace(db, "ProjectScope");
    const project = await createProject(db, space.id, "Allowed");
    const otherProject = await createProject(db, space.id, "Denied");
    const actorAgent = await createAgent(db, space.id);
    const targetAgent = await createAgent(db, space.id);
    await grantAgentPermission(db, space.id, actorAgent.id, "tasks:assign_scope", {
      projectIds: [project.id],
    });

    const allowed = await authorizationService(db).decidePrincipalGrant({
      spaceId: space.id,
      principalType: "agent",
      principalId: actorAgent.id,
      action: "tasks:assign",
      permissionKey: "tasks:assign_scope",
      scope: { projectId: project.id, assigneeAgentId: targetAgent.id },
    });
    const denied = await authorizationService(db).decidePrincipalGrant({
      spaceId: space.id,
      principalType: "agent",
      principalId: actorAgent.id,
      action: "tasks:assign",
      permissionKey: "tasks:assign_scope",
      scope: { projectId: otherProject.id, assigneeAgentId: targetAgent.id },
    });

    expect(allowed).toMatchObject({
      allowed: true,
      grant: { permissionKey: "tasks:assign_scope" },
    });
    expect(denied).toMatchObject({
      allowed: false,
      reason: "deny_scope",
    });
    expect(denied.explanation).toContain("does not cover the requested scope");
  });

  it("treats unknown grant scope metadata as unconstrained", async () => {
    const space = await createSpace(db, "UnknownScopeMetadata");
    const actorAgent = await createAgent(db, space.id);
    const targetAgent = await createAgent(db, space.id);
    await grantAgentPermission(db, space.id, actorAgent.id, "tasks:assign_scope", {
      note: "Default agent-approved",
    });

    const decision = await authorizationService(db).decidePrincipalGrant({
      spaceId: space.id,
      principalType: "agent",
      principalId: actorAgent.id,
      action: "tasks:assign",
      permissionKey: "tasks:assign_scope",
      scope: { assigneeAgentId: targetAgent.id },
    });

    expect(decision).toMatchObject({
      allowed: true,
      grant: { permissionKey: "tasks:assign_scope" },
    });
  });

  it("allows scoped assignment to agents inside a managed subtree only", async () => {
    const space = await createSpace(db, "SubtreeScope");
    const actorAgent = await createAgent(db, space.id);
    const managerAgent = await createAgent(db, space.id);
    const childAgent = await createAgent(db, space.id, { reportsTo: managerAgent.id });
    const grandchildAgent = await createAgent(db, space.id, { reportsTo: childAgent.id });
    const outsideAgent = await createAgent(db, space.id);
    await grantAgentPermission(db, space.id, actorAgent.id, "tasks:assign_scope", {
      managedSubtreeAgentIds: [managerAgent.id],
    });

    const allowed = await authorizationService(db).decidePrincipalGrant({
      spaceId: space.id,
      principalType: "agent",
      principalId: actorAgent.id,
      action: "tasks:assign",
      permissionKey: "tasks:assign_scope",
      scope: { assigneeAgentId: grandchildAgent.id },
    });
    const denied = await authorizationService(db).decidePrincipalGrant({
      spaceId: space.id,
      principalType: "agent",
      principalId: actorAgent.id,
      action: "tasks:assign",
      permissionKey: "tasks:assign_scope",
      scope: { assigneeAgentId: outsideAgent.id },
    });

    expect(allowed.allowed).toBe(true);
    expect(allowed.grant?.permissionKey).toBe("tasks:assign_scope");
    expect(denied).toMatchObject({
      allowed: false,
      reason: "deny_scope",
    });
  });

  it("allows scoped assignment to an explicit target-agent allowlist only", async () => {
    const space = await createSpace(db, "AllowlistScope");
    const actorAgent = await createAgent(db, space.id);
    const allowedTarget = await createAgent(db, space.id);
    const deniedTarget = await createAgent(db, space.id);
    await grantAgentPermission(db, space.id, actorAgent.id, "tasks:assign_scope", {
      assigneeAgentIds: [allowedTarget.id],
    });

    const allowed = await authorizationService(db).decidePrincipalGrant({
      spaceId: space.id,
      principalType: "agent",
      principalId: actorAgent.id,
      action: "tasks:assign",
      permissionKey: "tasks:assign_scope",
      scope: { assigneeAgentId: allowedTarget.id },
    });
    const denied = await authorizationService(db).decidePrincipalGrant({
      spaceId: space.id,
      principalType: "agent",
      principalId: actorAgent.id,
      action: "tasks:assign",
      permissionKey: "tasks:assign_scope",
      scope: { assigneeAgentId: deniedTarget.id },
    });

    expect(allowed.allowed).toBe(true);
    expect(denied.allowed).toBe(false);
  });

  it("preserves unscoped tasks:assign compatibility for assignment decisions", async () => {
    const space = await createSpace(db, "BroadAssign");
    const actorAgent = await createAgent(db, space.id);
    const targetAgent = await createAgent(db, space.id);
    await grantAgentPermission(db, space.id, actorAgent.id, "tasks:assign");

    const decision = await authorizationService(db).decidePrincipalGrant({
      spaceId: space.id,
      principalType: "agent",
      principalId: actorAgent.id,
      action: "tasks:assign",
      permissionKey: "tasks:assign",
      scope: { assigneeAgentId: targetAgent.id },
    });

    expect(decision).toMatchObject({
      allowed: true,
      grant: { permissionKey: "tasks:assign" },
    });
  });

  it("scopes task bridge JWTs away from space-wide reads and unrelated issue writes", async () => {
    const space = await createSpace(db, "TaskBridge");
    const bridgeAgent = await createAgent(db, space.id);
    const targetAgent = await createAgent(db, space.id);
    const project = await createProject(db, space.id, "Bridge");
    const parentIssue = await createIssue(db, space.id, { projectId: project.id });
    const assignedIssue = await createIssue(db, space.id, { assigneeAgentId: bridgeAgent.id });
    const keyId = randomUUID();
    const bridgeCreatedIssue = await createIssue(db, space.id, {
      originKind: "task_bridge",
      originId: keyId,
    });
    const unrelatedIssue = await createIssue(db, space.id);
    const actor = {
      type: "agent" as const,
      agentId: bridgeAgent.id,
      spaceId: space.id,
      source: "agent_jwt" as const,
      keyId,
      keyScope: {
        kind: "task_bridge" as const,
        parentIssueId: parentIssue.id,
        allowedAssigneeAgentIds: [targetAgent.id],
      },
    };
    const authz = authorizationService(db);

    await expect(authz.decide({
      actor,
      action: "space_scope:read",
      resource: { type: "space", spaceId: space.id },
    })).resolves.toMatchObject({
      allowed: false,
      reason: "deny_scope",
    });

    await expect(authz.decide({
      actor,
      action: "tasks:assign",
      resource: {
        type: "issue",
        spaceId: space.id,
        parentIssueId: parentIssue.id,
        assigneeAgentId: targetAgent.id,
      },
    })).resolves.toMatchObject({
      allowed: true,
    });

    await expect(authz.decide({
      actor,
      action: "tasks:assign",
      resource: {
        type: "issue",
        spaceId: space.id,
        projectId: project.id,
        assigneeUserId: randomUUID(),
      },
    })).resolves.toMatchObject({
      allowed: false,
      reason: "deny_scope",
    });

    await expect(authz.decide({
      actor,
      action: "issue:comment",
      resource: {
        type: "issue",
        spaceId: space.id,
        issueId: assignedIssue.id,
      },
    })).resolves.toMatchObject({
      allowed: true,
    });

    await expect(authz.decide({
      actor,
      action: "issue:mutate",
      resource: {
        type: "issue",
        spaceId: space.id,
        issueId: bridgeCreatedIssue.id,
      },
    })).resolves.toMatchObject({
      allowed: true,
    });

    await expect(authz.decide({
      actor,
      action: "issue:mutate",
      resource: {
        type: "issue",
        spaceId: space.id,
        issueId: unrelatedIssue.id,
      },
    })).resolves.toMatchObject({
      allowed: false,
      reason: "deny_scope",
    });

    await expect(authz.decide({
      actor,
      action: "agent_config:read",
      resource: {
        type: "agent",
        spaceId: space.id,
        agentId: bridgeAgent.id,
      },
    })).resolves.toMatchObject({
      allowed: false,
      reason: "deny_scope",
    });
  });

  it("scopes skill-test keys to their own issue only", async () => {
    const space = await createSpace(db, "SkillTest");
    const skillTestAgent = await createAgent(db, space.id);
    const ownIssue = await createIssue(db, space.id, { assigneeAgentId: skillTestAgent.id });
    const otherIssue = await createIssue(db, space.id);
    const actor = {
      type: "agent" as const,
      agentId: skillTestAgent.id,
      spaceId: space.id,
      source: "agent_key" as const,
      keyScope: {
        kind: "skill_test" as const,
        issueId: ownIssue.id,
      },
    };
    const authz = authorizationService(db);

    for (const action of ["issue:read", "issue:comment", "issue:mutate"] as const) {
      await expect(authz.decide({
        actor,
        action,
        resource: {
          type: "issue",
          spaceId: space.id,
          issueId: ownIssue.id,
        },
      })).resolves.toMatchObject({
        allowed: true,
      });
    }

    await expect(authz.decide({
      actor,
      action: "issue:mutate",
      resource: {
        type: "issue",
        spaceId: space.id,
        issueId: otherIssue.id,
      },
    })).resolves.toMatchObject({
      allowed: false,
      reason: "deny_scope",
    });

    await expect(authz.decide({
      actor,
      action: "space_scope:read",
      resource: { type: "space", spaceId: space.id },
    })).resolves.toMatchObject({
      allowed: false,
      reason: "deny_scope",
    });

    await expect(authz.decide({
      actor,
      action: "tasks:assign",
      resource: {
        type: "issue",
        spaceId: space.id,
        parentIssueId: ownIssue.id,
        assigneeAgentId: skillTestAgent.id,
      },
    })).resolves.toMatchObject({
      allowed: false,
      reason: "deny_scope",
    });
  });

  it("allows responsible-user inbox management by default", async () => {
    const space = await createSpace(db, "InboxDefaultOpen");
    const actorAgent = await createAgent(db, space.id);
    const responsibleUserId = await createUser(db);
    await db.insert(spaceMemberships).values({
      spaceId: space.id,
      principalType: "user",
      principalId: responsibleUserId,
      status: "active",
      membershipRole: "operator",
    });

    await expect(authorizationService(db).decide({
      actor: {
        type: "agent",
        agentId: actorAgent.id,
        spaceId: space.id,
        onBehalfOfUserId: responsibleUserId,
        source: "agent_jwt",
      },
      action: "inbox:manage",
      resource: { type: "space", spaceId: space.id },
    })).resolves.toMatchObject({
      allowed: true,
      reason: "allow_self",
      inboxPolicyMode: "open",
    });
  });

  it("denies responsible-user inbox management when disabled", async () => {
    const space = await createSpace(db, "InboxDisabled");
    const actorAgent = await createAgent(db, space.id);
    const responsibleUserId = await createUser(db);
    await db.insert(spaceMemberships).values({
      spaceId: space.id,
      principalType: "user",
      principalId: responsibleUserId,
      status: "active",
      membershipRole: "operator",
    });
    await db.insert(userInboxAgentPolicies).values({
      spaceId: space.id,
      userId: responsibleUserId,
      mode: "disabled",
    });

    await expect(authorizationService(db).decide({
      actor: {
        type: "agent",
        agentId: actorAgent.id,
        spaceId: space.id,
        onBehalfOfUserId: responsibleUserId,
        source: "agent_jwt",
      },
      action: "inbox:manage",
      resource: { type: "space", spaceId: space.id },
    })).resolves.toMatchObject({ allowed: false, reason: "inbox_management_disabled" });
  });

  it("enforces responsible-user inbox allowlists", async () => {
    const space = await createSpace(db, "InboxAllowlist");
    const allowedAgent = await createAgent(db, space.id);
    const deniedAgent = await createAgent(db, space.id);
    const responsibleUserId = await createUser(db);
    await db.insert(spaceMemberships).values({
      spaceId: space.id,
      principalType: "user",
      principalId: responsibleUserId,
      status: "active",
      membershipRole: "operator",
    });
    await db.insert(userInboxAgentPolicies).values({
      spaceId: space.id,
      userId: responsibleUserId,
      mode: "allowlist",
      allowedAgentIds: [allowedAgent.id],
    });
    const decideFor = (agentId: string) => authorizationService(db).decide({
      actor: {
        type: "agent" as const,
        agentId,
        spaceId: space.id,
        onBehalfOfUserId: responsibleUserId,
        source: "agent_jwt" as const,
      },
      action: "inbox:manage" as const,
      resource: { type: "space" as const, spaceId: space.id },
    });

    await expect(decideFor(allowedAgent.id)).resolves.toMatchObject({
      allowed: true,
      reason: "allow_self",
      inboxPolicyMode: "allowlist",
    });
    await expect(decideFor(deniedAgent.id)).resolves.toMatchObject({
      allowed: false,
      reason: "inbox_agent_not_allowed",
    });
  });

  it("requires a grant for cross-user inbox management", async () => {
    const space = await createSpace(db, "InboxCrossUserDenied");
    const actorAgent = await createAgent(db, space.id);
    const responsibleUserId = await createUser(db);
    const targetUserId = await createUser(db);
    await db.insert(spaceMemberships).values([
      {
        spaceId: space.id,
        principalType: "user",
        principalId: responsibleUserId,
        status: "active",
        membershipRole: "operator",
      },
      {
        spaceId: space.id,
        principalType: "user",
        principalId: targetUserId,
        status: "active",
        membershipRole: "operator",
      },
    ]);

    await expect(authorizationService(db).decide({
      actor: {
        type: "agent",
        agentId: actorAgent.id,
        spaceId: space.id,
        onBehalfOfUserId: responsibleUserId,
        source: "agent_jwt",
      },
      action: "inbox:manage",
      resource: { type: "space", spaceId: space.id },
      scope: { userId: targetUserId },
    })).resolves.toMatchObject({ allowed: false, reason: "deny_missing_grant" });
  });

  it("honors a target user's saved inbox policy for cross-user management", async () => {
    const space = await createSpace(db, "InboxCrossUserPolicy");
    const actorAgent = await createAgent(db, space.id);
    const deniedAgent = await createAgent(db, space.id);
    const responsibleUserId = await createUser(db);
    const allowlistTargetUserId = await createUser(db);
    const openTargetUserId = await createUser(db);
    await db.insert(spaceMemberships).values([
      {
        spaceId: space.id,
        principalType: "user",
        principalId: responsibleUserId,
        status: "active",
        membershipRole: "operator",
      },
      {
        spaceId: space.id,
        principalType: "user",
        principalId: allowlistTargetUserId,
        status: "active",
        membershipRole: "operator",
      },
      {
        spaceId: space.id,
        principalType: "user",
        principalId: openTargetUserId,
        status: "active",
        membershipRole: "operator",
      },
    ]);
    await db.insert(userInboxAgentPolicies).values([
      {
        spaceId: space.id,
        userId: allowlistTargetUserId,
        mode: "allowlist",
        allowedAgentIds: [actorAgent.id],
      },
      {
        spaceId: space.id,
        userId: openTargetUserId,
        mode: "open",
      },
    ]);
    const decideFor = (agentId: string, userId: string) => authorizationService(db).decide({
      actor: {
        type: "agent" as const,
        agentId,
        spaceId: space.id,
        onBehalfOfUserId: responsibleUserId,
        source: "agent_jwt" as const,
      },
      action: "inbox:manage" as const,
      resource: { type: "space" as const, spaceId: space.id },
      scope: { userId },
    });

    await expect(decideFor(actorAgent.id, allowlistTargetUserId)).resolves.toMatchObject({
      allowed: true,
      reason: "allow_user_inbox_policy",
      inboxPolicyMode: "allowlist",
    });
    await expect(decideFor(deniedAgent.id, allowlistTargetUserId)).resolves.toMatchObject({
      allowed: false,
      reason: "inbox_agent_not_allowed",
    });
    await expect(decideFor(actorAgent.id, openTargetUserId)).resolves.toMatchObject({
      allowed: true,
      reason: "allow_user_inbox_policy",
      inboxPolicyMode: "open",
    });
  });

  it("allows cross-user inbox management with an unscoped grant", async () => {
    const space = await createSpace(db, "InboxCrossUserGranted");
    const actorAgent = await createAgent(db, space.id);
    const responsibleUserId = await createUser(db);
    const targetUserId = await createUser(db);
    await db.insert(spaceMemberships).values([
      {
        spaceId: space.id,
        principalType: "user",
        principalId: responsibleUserId,
        status: "active",
        membershipRole: "operator",
      },
      {
        spaceId: space.id,
        principalType: "user",
        principalId: targetUserId,
        status: "active",
        membershipRole: "operator",
      },
    ]);
    await grantAgentPermission(db, space.id, actorAgent.id, "inbox:manage");

    await expect(authorizationService(db).decide({
      actor: {
        type: "agent",
        agentId: actorAgent.id,
        spaceId: space.id,
        onBehalfOfUserId: responsibleUserId,
        source: "agent_jwt",
      },
      action: "inbox:manage",
      resource: { type: "space", spaceId: space.id },
      scope: { userId: targetUserId },
    })).resolves.toMatchObject({ allowed: true, reason: "allow_explicit_grant" });
  });

  it("keeps a default inbox grant within the responsible user's policy", async () => {
    const space = await createSpace(db, "InboxDefaultScoped");
    const actorAgent = await createAgent(db, space.id);
    const responsibleUserId = await createUser(db);
    const disabledUserId = await createUser(db);
    const disallowedUserId = await createUser(db);
    await db.insert(spaceMemberships).values(
      [responsibleUserId, disabledUserId, disallowedUserId].map((principalId) => ({
        spaceId: space.id,
        principalType: "user" as const,
        principalId,
        status: "active" as const,
        membershipRole: "operator" as const,
      })),
    );
    await db.insert(userInboxAgentPolicies).values([
      { spaceId: space.id, userId: disabledUserId, mode: "disabled" },
      { spaceId: space.id, userId: disallowedUserId, mode: "allowlist", allowedAgentIds: [] },
    ]);
    await grantAgentPermission(db, space.id, actorAgent.id, "inbox:manage", { responsibleUserOnly: true });
    const decideFor = (userId: string) => authorizationService(db).decide({
      actor: {
        type: "agent" as const,
        agentId: actorAgent.id,
        spaceId: space.id,
        onBehalfOfUserId: responsibleUserId,
        source: "agent_jwt" as const,
      },
      action: "inbox:manage" as const,
      resource: { type: "space" as const, spaceId: space.id },
      scope: { userId },
    });

    await expect(decideFor(responsibleUserId)).resolves.toMatchObject({ allowed: true, reason: "allow_self" });
    await expect(decideFor(disabledUserId)).resolves.toMatchObject({ allowed: false, reason: "inbox_management_disabled" });
    await expect(decideFor(disallowedUserId)).resolves.toMatchObject({ allowed: false, reason: "inbox_agent_not_allowed" });
  });

  it("enforces user-scoped cross-user inbox grants", async () => {
    const space = await createSpace(db, "InboxCrossUserScoped");
    const actorAgent = await createAgent(db, space.id);
    const responsibleUserId = await createUser(db);
    const allowedTargetUserId = await createUser(db);
    const deniedTargetUserId = await createUser(db);
    await db.insert(spaceMemberships).values([
      {
        spaceId: space.id,
        principalType: "user",
        principalId: responsibleUserId,
        status: "active",
        membershipRole: "operator",
      },
      {
        spaceId: space.id,
        principalType: "user",
        principalId: allowedTargetUserId,
        status: "active",
        membershipRole: "operator",
      },
      {
        spaceId: space.id,
        principalType: "user",
        principalId: deniedTargetUserId,
        status: "active",
        membershipRole: "operator",
      },
    ]);
    await grantAgentPermission(db, space.id, actorAgent.id, "inbox:manage", {
      userIds: [allowedTargetUserId],
    });
    const decideFor = (userId: string) => authorizationService(db).decide({
      actor: {
        type: "agent" as const,
        agentId: actorAgent.id,
        spaceId: space.id,
        onBehalfOfUserId: responsibleUserId,
        source: "agent_jwt" as const,
      },
      action: "inbox:manage" as const,
      resource: { type: "space" as const, spaceId: space.id },
      scope: { userId },
    });

    await expect(decideFor(allowedTargetUserId)).resolves.toMatchObject({
      allowed: true,
      reason: "allow_explicit_grant",
    });
    await expect(decideFor(deniedTargetUserId)).resolves.toMatchObject({ allowed: false, reason: "deny_scope" });
  });

  it("denies inbox management when the target user cannot be resolved", async () => {
    const space = await createSpace(db, "InboxUnresolved");
    const actorAgent = await createAgent(db, space.id);

    await expect(authorizationService(db).decide({
      actor: { type: "agent", agentId: actorAgent.id, spaceId: space.id, source: "agent_key" },
      action: "inbox:manage",
      resource: { type: "space", spaceId: space.id },
    })).resolves.toMatchObject({ allowed: false, reason: "inbox_target_user_unresolved" });
  });

  it("denies low-trust inbox management", async () => {
    const space = await createSpace(db, "InboxLowTrust");
    const project = await createProject(db, space.id, "InboxLowTrust");
    const responsibleUserId = await createUser(db);
    const actorAgent = await createAgent(db, space.id, {
      permissions: {
        trustPreset: LOW_TRUST_REVIEW_PRESET,
        authorizationPolicy: {
          trustBoundary: {
            mode: LOW_TRUST_REVIEW_PRESET,
            spaceId: space.id,
            projectIds: [project.id],
          },
        },
      },
    });
    await db.insert(spaceMemberships).values({
      spaceId: space.id,
      principalType: "user",
      principalId: responsibleUserId,
      status: "active",
      membershipRole: "operator",
    });

    await expect(authorizationService(db).decide({
      actor: {
        type: "agent",
        agentId: actorAgent.id,
        spaceId: space.id,
        onBehalfOfUserId: responsibleUserId,
        source: "agent_jwt",
      },
      action: "inbox:manage",
      resource: { type: "space", spaceId: space.id },
    })).resolves.toMatchObject({ allowed: false, reason: "deny_low_trust_boundary" });
  });

  it("enforces private issue implicit principals, grants, revocation, and subtree inheritance", async () => {
    const previousMode = process.env.OUTPOST_ISSUE_PRIVACY_MODE;
    const previousTtl = process.env.OUTPOST_ISSUE_PRIVACY_CACHE_TTL_MS;
    process.env.OUTPOST_ISSUE_PRIVACY_MODE = "enforce";
    process.env.OUTPOST_ISSUE_PRIVACY_CACHE_TTL_MS = "5000";
    try {
      const space = await createSpace(db, "IssuePrivacy");
      const ownerId = await createUser(db);
      const memberId = await createUser(db);
      const granteeId = await createUser(db);
      await db.insert(spaceMemberships).values([ownerId, memberId, granteeId].map((principalId) => ({
        spaceId: space.id,
        principalType: "user",
        principalId,
        status: "active",
        membershipRole: "operator",
      })));
      const assignedAgent = await createAgent(db, space.id);
      const otherAgent = await createAgent(db, space.id);
      const authz = authorizationService(db);
      const userActor = (userId: string): AuthorizationActor => ({ type: "operator", userId, source: "session" });
      const agentActor = (agentId: string): AuthorizationActor => ({
        type: "agent",
        agentId,
        spaceId: space.id,
        source: "agent_key",
      });
      const decide = (actor: AuthorizationActor, issue: Awaited<ReturnType<typeof createIssue>>) => authz.decide({
        actor,
        action: "issue:read",
        resource: { type: "issue", spaceId: space.id, issueId: issue.id },
      });

      const openIssue = await createIssue(db, space.id);
      await expect(decide(userActor(memberId), openIssue)).resolves.toMatchObject({ allowed: true });

      const privateRootId = randomUUID();
      const privateRoot = await createIssue(db, space.id, {
        id: privateRootId,
        visibility: "private",
        privacyRootIssueId: privateRootId,
        responsibleUserId: ownerId,
        assigneeAgentId: assignedAgent.id,
      });
      await expect(decide(userActor(memberId), privateRoot)).resolves.toMatchObject({
        allowed: false,
        reason: "deny_issue_private",
      });
      await expect(decide(agentActor(otherAgent.id), privateRoot)).resolves.toMatchObject({
        allowed: false,
        reason: "deny_issue_private",
      });
      await expect(decide(userActor(ownerId), privateRoot)).resolves.toMatchObject({ allowed: true });
      await expect(decide(agentActor(assignedAgent.id), privateRoot)).resolves.toMatchObject({ allowed: true });

      const grant = await db.insert(issueAccessGrants).values({
        issueId: privateRoot.id,
        subjectType: "user",
        subjectId: granteeId,
        source: "explicit",
        grantedByUserId: ownerId,
      }).returning().then((rows) => rows[0]!);
      await expect(decide(userActor(granteeId), privateRoot)).resolves.toMatchObject({ allowed: true });

      const child = await createIssue(db, space.id, {
        parentId: privateRoot.id,
        privacyParentIssueId: privateRoot.id,
        visibility: "private",
        privacyRootIssueId: privateRoot.id,
      });
      await expect(decide(userActor(granteeId), child)).resolves.toMatchObject({ allowed: true });

      await db.update(issueAccessGrants).set({ revokedAt: new Date() }).where(eq(issueAccessGrants.id, grant.id));
      await expect(decide(userActor(granteeId), privateRoot)).resolves.toMatchObject({
        allowed: false,
        reason: "deny_issue_private",
      });

      process.env.OUTPOST_ISSUE_PRIVACY_MODE = "shadow";
      const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);
      await expect(decide(userActor(memberId), privateRoot)).resolves.toMatchObject({ allowed: true });
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          authzMode: "shadow",
          issueId: privateRoot.id,
          reason: "deny_issue_private",
        }),
        "issue privacy would deny read",
      );
      warn.mockRestore();
    } finally {
      if (previousMode === undefined) delete process.env.OUTPOST_ISSUE_PRIVACY_MODE;
      else process.env.OUTPOST_ISSUE_PRIVACY_MODE = previousMode;
      if (previousTtl === undefined) delete process.env.OUTPOST_ISSUE_PRIVACY_CACHE_TTL_MS;
      else process.env.OUTPOST_ISSUE_PRIVACY_CACHE_TTL_MS = previousTtl;
    }
  });

  it("uses private-project membership as the same issue-read predicate while preserving issue grants", async () => {
    const previousMode = process.env.OUTPOST_ISSUE_PRIVACY_MODE;
    process.env.OUTPOST_ISSUE_PRIVACY_MODE = "enforce";
    try {
      const space = await createSpace(db, "ProjectPrivacy");
      const memberId = await createUser(db);
      const granteeId = await createUser(db);
      const outsiderId = await createUser(db);
      await db.insert(spaceMemberships).values([memberId, granteeId, outsiderId].map((principalId) => ({
        spaceId: space.id,
        principalType: "user" as const,
        principalId,
        status: "active",
        membershipRole: "operator",
      })));
      const project = await createProject(db, space.id, "Private", "private");
      const memberAgent = await createAgent(db, space.id);
      const outsiderAgent = await createAgent(db, space.id);
      await db.insert(spaceMemberships).values([memberAgent.id, outsiderAgent.id].map((principalId) => ({
        spaceId: space.id,
        principalType: "agent" as const,
        principalId,
        status: "active",
        membershipRole: "member",
      })));
      await db.insert(projectAccessMembers).values({
        spaceId: space.id,
        projectId: project.id,
        subjectType: "user",
        subjectId: memberId,
      });
      await db.insert(projectAccessMembers).values({
        spaceId: space.id,
        projectId: project.id,
        subjectType: "agent",
        subjectId: memberAgent.id,
      });
      const issue = await createIssue(db, space.id, { projectId: project.id });
      await db.insert(issueAccessGrants).values({
        issueId: issue.id,
        subjectType: "user",
        subjectId: granteeId,
        source: "explicit",
        grantedByUserId: memberId,
      });
      const authz = authorizationService(db);
      const decideProject = (userId: string) => authz.decide({
        actor: { type: "operator", userId, source: "session" },
        action: "project:read",
        resource: { type: "project", spaceId: space.id, projectId: project.id },
      });
      const decideIssue = (userId: string) => authz.decide({
        actor: { type: "operator", userId, source: "session" },
        action: "issue:read",
        resource: { type: "issue", spaceId: space.id, issueId: issue.id },
      });
      const decideProjectAsAgent = (agentId: string) => authz.decide({
        actor: { type: "agent", agentId, spaceId: space.id, source: "agent_key" },
        action: "project:read",
        resource: { type: "project", spaceId: space.id, projectId: project.id },
      });
      const decideIssueAsAgent = (agentId: string) => authz.decide({
        actor: { type: "agent", agentId, spaceId: space.id, source: "agent_key" },
        action: "issue:read",
        resource: { type: "issue", spaceId: space.id, issueId: issue.id },
      });

      await expect(decideProject(memberId)).resolves.toMatchObject({ allowed: true });
      await expect(decideProject(outsiderId)).resolves.toMatchObject({
        allowed: false,
        reason: "deny_project_private",
      });
      await expect(decideIssue(memberId)).resolves.toMatchObject({ allowed: true });
      await expect(decideIssue(granteeId)).resolves.toMatchObject({ allowed: true });
      await expect(decideIssue(outsiderId)).resolves.toMatchObject({
        allowed: false,
        reason: "deny_issue_private",
      });
      await expect(decideProjectAsAgent(memberAgent.id)).resolves.toMatchObject({ allowed: true });
      await expect(decideIssueAsAgent(memberAgent.id)).resolves.toMatchObject({ allowed: true });
      await expect(decideProjectAsAgent(outsiderAgent.id)).resolves.toMatchObject({
        allowed: false,
        reason: "deny_project_private",
      });
      await expect(decideIssueAsAgent(outsiderAgent.id)).resolves.toMatchObject({
        allowed: false,
        reason: "deny_issue_private",
      });
    } finally {
      if (previousMode === undefined) delete process.env.OUTPOST_ISSUE_PRIVACY_MODE;
      else process.env.OUTPOST_ISSUE_PRIVACY_MODE = previousMode;
    }
  });


  it("denies secrets proposals for scoped tokens regardless of request source", async () => {
    const space = await createSpace(db, "SecretProposalScopes");
    const actorAgent = await createAgent(db, space.id);
    const resource = { type: "space" as const, spaceId: space.id };
    const authz = authorizationService(db);

    for (const actor of [
      {
        type: "agent" as const,
        agentId: actorAgent.id,
        spaceId: space.id,
        source: "agent_jwt" as const,
        keyId: randomUUID(),
        keyScope: { kind: "task_bridge" as const, parentIssueId: randomUUID() },
      },
      {
        type: "agent" as const,
        agentId: actorAgent.id,
        spaceId: space.id,
        source: "agent_jwt" as const,
        keyScope: { kind: "skill_test" as const, issueId: randomUUID() },
      },
    ]) {
      await expect(authz.decide({ actor, action: "secrets:propose", resource }))
        .resolves.toMatchObject({ allowed: false, reason: "deny_scope" });
    }
  });
});
