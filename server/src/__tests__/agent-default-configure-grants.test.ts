import { createAgentLifecycle } from "../services/agent-lifecycle.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { activityLog, agents, spaces, spaceMemberships, createDb, principalPermissionGrants } from "@outpost/db";
import { LOW_TRUST_REVIEW_PRESET, type PermissionKey } from "@outpost/shared";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { agentService } from "../services/agents.js";
import { authorizationService } from "../services/authorization.js";
import { accessService } from "../services/access.js";
import { agentJoinGrantsFromDefaults } from "../services/invite-grants.js";

const support = await getEmbeddedPostgresTestSupport();
const describeDatabase = support.supported ? describe : describe.skip;
const expectedNewAgentGrantKeys: PermissionKey[] = ([
  "agents:read",
  "agents:configure",
  "agents:suggest-changes",
  "skills:create",
  "skills:suggest-changes",
  "tools:manage_connections",
  "tools:manage_profiles",
  "tools:view_audit",
  "audit:view_agent_actions",
  "tools:use",
  "tools:manage_runtime",
  "inbox:manage",
  "tasks:assign",
  "tasks:assign_scope",
  "tasks:manage_active_checkouts",
] satisfies PermissionKey[]).sort();

describeDatabase("new agent configuration defaults", () => {
  let db!: ReturnType<typeof createDb>;
  let cleanup: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("agent-configure-defaults");
    db = createDb(started.connectionString);
    cleanup = started.cleanup;
  }, 20_000);

  afterAll(async () => {
    await cleanup?.();
  });

  it("grants standard new agents direct peer configuration, but keeps restricted agents narrow", async () => {
    const spaceId = randomUUID();
    await db.insert(spaces).values({
      id: spaceId,
      name: "Agent permission defaults",
      issuePrefix: `PD${spaceId.slice(0, 6).toUpperCase()}`,
    });
    const create = (name: string, permissions: Record<string, unknown> = {}, metadata?: Record<string, unknown>) =>
      createAgentLifecycle(db).requestCreation(spaceId, {
        name,
        role: "engineer",
        adapterType: "process",
        adapterConfig: {},
        runtimeConfig: {},
        permissions,
        metadata,
      }, metadata ? { allowBuiltInAgentMetadata: true } : undefined);

    const standard = await create("Standard");
    const peer = await create("Peer");
    const lowTrust = await create("Low trust", { trustPreset: LOW_TRUST_REVIEW_PRESET });
    const bundled = await create("Bundled", {}, {
      outpostBuiltInAgent: { key: "reflection-coach", featureKeys: [] },
    });

    const grants = await db.select().from(principalPermissionGrants)
      .where(eq(principalPermissionGrants.spaceId, spaceId));
    for (const agent of [standard, peer]) {
      expect(grants.filter((grant) => grant.principalId === agent.id)
        .map((grant) => grant.permissionKey).sort()).toEqual(expectedNewAgentGrantKeys);
      expect(grants.find((grant) => grant.principalId === agent.id && grant.permissionKey === "tasks:assign_scope")?.scope)
        .toEqual({ subtreeRootAgentId: agent.id });
      expect(grants.find((grant) => grant.principalId === agent.id && grant.permissionKey === "inbox:manage")?.scope)
        .toEqual({ responsibleUserOnly: true });
    }
    for (const agent of [lowTrust, bundled]) {
      expect(grants.filter((grant) => grant.principalId === agent.id)).toEqual([]);
    }

    await db.insert(spaceMemberships).values({
      spaceId,
      principalType: "agent",
      principalId: standard.id,
      status: "active",
      membershipRole: "member",
    });

    for (const permissionKey of expectedNewAgentGrantKeys) {
      if (permissionKey === "tasks:assign_scope" || permissionKey === "inbox:manage") continue; // These grants require a target scope or the responsible-user inbox path.
      expect(await accessService(db).hasPermission(spaceId, "agent", standard.id, permissionKey)).toBe(true);
    }
    expect(await authorizationService(db).decidePrincipalGrant({
      spaceId,
      principalType: "agent",
      principalId: standard.id,
      action: "tasks:assign",
      permissionKey: "tasks:assign_scope",
      scope: { assigneeAgentId: standard.id },
    })).toMatchObject({ allowed: true });
    expect(await authorizationService(db).decidePrincipalGrant({
      spaceId,
      principalType: "agent",
      principalId: standard.id,
      action: "tasks:assign",
      permissionKey: "tasks:assign_scope",
      scope: { assigneeAgentId: peer.id },
    })).toMatchObject({ allowed: false, reason: "deny_scope" });
    for (const permissionKey of [
      "agents:create", "environments:manage", "tools:admin", "users:invite",
      "users:manage_permissions", "joins:approve",
    ] as const) {
      expect(await accessService(db).hasPermission(spaceId, "agent", standard.id, permissionKey)).toBe(false);
    }

    const decision = await authorizationService(db).decide({
      actor: { type: "agent", agentId: standard.id, spaceId, source: "agent_key" },
      action: "agent_config:update",
      resource: { type: "agent", agentId: peer.id, spaceId },
      scope: { requiresChangeGrant: true },
    });
    expect(decision).toMatchObject({ allowed: true, reason: "allow_direct_change" });

    // A later ordinary self-update must not recreate a grant removed by an operator.
    await db.delete(principalPermissionGrants).where(eq(principalPermissionGrants.principalId, standard.id));
    await agentService(db).update(standard.id, { title: "Updated own title" });
    expect(await db.select().from(principalPermissionGrants)
      .where(eq(principalPermissionGrants.principalId, standard.id))).toEqual([]);

    await db.update(agents).set({ status: "terminated", lifecycleState: "terminated" }).where(eq(agents.id, peer.id));
    await agentService(db).remove(peer.id);
    expect(await db.select().from(principalPermissionGrants)
      .where(eq(principalPermissionGrants.principalId, peer.id))).toEqual([]);

    await db.delete(principalPermissionGrants).where(eq(principalPermissionGrants.spaceId, spaceId));
    await db.delete(spaceMemberships).where(eq(spaceMemberships.spaceId, spaceId));
    await db.delete(agents).where(eq(agents.spaceId, spaceId));
    await db.delete(activityLog).where(eq(activityLog.spaceId, spaceId));
    await db.delete(spaces).where(eq(spaces.id, spaceId));
  });

  it("keeps existing agents and their scoped grants unchanged during ordinary updates", async () => {
    const spaceId = randomUUID();
    await db.insert(spaces).values({
      id: spaceId,
      name: "Existing permission defaults",
      issuePrefix: `PE${spaceId.slice(0, 6).toUpperCase()}`,
    });
    const rows = await db.insert(agents).values([
      { spaceId, name: "Existing", role: "engineer", permissions: {}, adapterType: "process", adapterConfig: {}, runtimeConfig: {} },
      { spaceId, name: "Scoped", role: "engineer", permissions: {}, adapterType: "process", adapterConfig: {}, runtimeConfig: {} },
      { spaceId, name: "Restricted", role: "engineer", permissions: { trustPreset: LOW_TRUST_REVIEW_PRESET }, adapterType: "process", adapterConfig: {}, runtimeConfig: {} },
      { spaceId, name: "Built in", role: "engineer", metadata: { outpostBuiltInAgent: { key: "reflection-coach", featureKeys: [] } }, permissions: {}, adapterType: "process", adapterConfig: {}, runtimeConfig: {} },
      { spaceId, name: "Pending", role: "engineer", status: "pending_approval", permissions: {}, adapterType: "process", adapterConfig: {}, runtimeConfig: {} },
    ]).returning();
    await db.insert(principalPermissionGrants).values({
      spaceId,
      principalType: "agent",
      principalId: rows[1]!.id,
      permissionKey: "agents:configure",
      scope: { agentIds: [rows[0]!.id] },
    });

    for (const row of rows) {
      if (row.status === "pending_approval") {
        await expect(agentService(db).update(row.id, { title: "Updated existing agent" }))
          .rejects.toThrow("Pending approval agent configuration cannot be changed before operator approval");
      } else {
        await agentService(db).update(row.id, { title: "Updated existing agent" });
      }
    }
    const grants = await db.select().from(principalPermissionGrants)
      .where(eq(principalPermissionGrants.spaceId, spaceId));
    expect(grants.map((grant) => grant.principalId).sort()).toEqual([rows[1]!.id]);
    expect(grants.map((grant) => grant.permissionKey)).toEqual(["agents:configure"]);
    expect(grants.find((grant) => grant.principalId === rows[1]!.id)?.scope).toEqual({ agentIds: [rows[0]!.id] });

    await db.delete(principalPermissionGrants).where(eq(principalPermissionGrants.spaceId, spaceId));
    await db.delete(agents).where(eq(agents.spaceId, spaceId));
    await db.delete(activityLog).where(eq(activityLog.spaceId, spaceId));
    await db.delete(spaces).where(eq(spaces.id, spaceId));
  });

  it("adds the default grant when a standard pending create is approved", async () => {
    const spaceId = randomUUID();
    await db.insert(spaces).values({
      id: spaceId,
      name: "Pending permission default",
      issuePrefix: `PP${spaceId.slice(0, 6).toUpperCase()}`,
    });
    const pending = await createAgentLifecycle(db).requestCreation(spaceId, {
      name: "Pending create",
      status: "pending_approval",
      role: "engineer",
      adapterType: "process",
      adapterConfig: {},
      runtimeConfig: {},
    });
    expect(await db.select().from(principalPermissionGrants)
      .where(eq(principalPermissionGrants.spaceId, spaceId))).toEqual([]);

    const result = await createAgentLifecycle(db).approveCreation(pending.id);
    expect(result?.activated).toBe(true);
    expect((await db.select().from(principalPermissionGrants)
      .where(eq(principalPermissionGrants.spaceId, spaceId)))
      .map((grant) => grant.permissionKey).sort()).toEqual(expectedNewAgentGrantKeys);

    await db.delete(principalPermissionGrants).where(eq(principalPermissionGrants.spaceId, spaceId));
    await db.delete(agents).where(eq(agents.spaceId, spaceId));
    await db.delete(activityLog).where(eq(activityLog.spaceId, spaceId));
    await db.delete(spaces).where(eq(spaces.id, spaceId));
  });

  it("keeps configuration access when invitation approval replaces a new agent's grants", async () => {
    const spaceId = randomUUID();
    await db.insert(spaces).values({
      id: spaceId,
      name: "Invited permission default",
      issuePrefix: `PI${spaceId.slice(0, 6).toUpperCase()}`,
    });
    const invited = await createAgentLifecycle(db).requestCreation(spaceId, {
      name: "Invited agent",
      role: "engineer",
      adapterType: "process",
      adapterConfig: {},
      runtimeConfig: {},
    });
    await accessService(db).ensureMembership(spaceId, "agent", invited.id, "member", "active");
    await accessService(db).setPrincipalGrants(
      spaceId, "agent", invited.id, agentJoinGrantsFromDefaults(null, invited.id), null,
    );
    const grants = await db.select().from(principalPermissionGrants)
      .where(eq(principalPermissionGrants.principalId, invited.id));
    expect(grants.map((grant) => grant.permissionKey).sort()).toEqual(expectedNewAgentGrantKeys);

    await db.delete(principalPermissionGrants).where(eq(principalPermissionGrants.spaceId, spaceId));
    await db.delete(spaceMemberships).where(eq(spaceMemberships.spaceId, spaceId));
    await db.delete(agents).where(eq(agents.spaceId, spaceId));
    await db.delete(activityLog).where(eq(activityLog.spaceId, spaceId));
    await db.delete(spaces).where(eq(spaces.id, spaceId));
  });
});
