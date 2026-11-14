import { createAgentLifecycle } from "../services/agent-lifecycle.js";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  agents,
  approvals,
  activityLog,
  budgetPolicies,
  spaces,
  createDb,
  principalPermissionGrants,
} from "@outpost/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { agentService } from "../services/agents.ts";
import { approvalService } from "../services/approvals.ts";
import { outpostRunnerSupportsPlatform } from "@outpost/shared";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

function issuePrefix(id: string) {
  return `T${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres pending approval agent tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("pending approval agent config integrity", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("outpost-pending-agent-config-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(principalPermissionGrants);
    await db.delete(budgetPolicies);
    await db.delete(approvals);
    await db.delete(agents);
    await db.delete(spaces);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedSpace() {
    const spaceId = randomUUID();
    await db.insert(spaces).values({
      id: spaceId,
      name: "Outpost",
      issuePrefix: issuePrefix(spaceId),
      requireOperatorApprovalForNewAgents: true,
    });
    return spaceId;
  }

  it("resolves internal Codex creation once and preserves legacy agents through ordinary edits", async () => {
    const spaceId = await seedSpace();
    const service = agentService(db);
    const lifecycle = createAgentLifecycle(db);
    const native = await lifecycle.requestCreation(spaceId, { name: "New Codex", adapterType: "codex_local", adapterConfig: { modelReasoningEffort: "high" }, status: "pending_approval" });
    const legacy = await lifecycle.requestCreation(spaceId, { name: "Legacy Codex", adapterType: "codex_local", runner: "legacy", adapterConfig: { extraArgs: ["--search"] }, status: "pending_approval" });
    const reviewedLegacy = await lifecycle.requestCreation(spaceId, { name: "Historical approved create", adapterType: "codex_local", adapterConfig: {}, status: "pending_approval" }, { runnerResolved: true });
    if (outpostRunnerSupportsPlatform("codex_local", process.platform, process.arch)) {
      expect(native).toMatchObject({ adapterType: "outpost_runner", adapterConfig: { provider: "codex", modelReasoningEffort: "high" } });
    } else {
      expect(native).toMatchObject({ adapterType: "codex_local", adapterConfig: { modelReasoningEffort: "high" } });
    }
    expect(legacy.adapterType).toBe("codex_local");
    expect(reviewedLegacy.adapterType).toBe("codex_local");
    for (const agent of [native, legacy, reviewedLegacy]) {
      expect(agent).not.toHaveProperty("runner");
      await lifecycle.approveCreation(agent.id);
      await service.update(agent.id, { title: "Updated title" });
      const saved = await service.getById(agent.id);
      expect(saved?.adapterType).toBe(agent.adapterType);
      expect(saved?.adapterConfig).toEqual(agent.adapterConfig);
    }
  });

  it("freezes generic pending create config and reapplies the approval snapshot on activation", async () => {
    const spaceId = await seedSpace();
    const agentSvc = agentService(db);
    const agentSvcLifecycle = createAgentLifecycle(db);
    const approvalSvc = approvalService(db);
    const pending = await agentSvcLifecycle.requestCreation(spaceId, {
      name: "Pending Coder",
      role: "engineer",
      title: "Software Engineer",
      icon: "code",
      capabilities: "Writes code",
      adapterType: "process",
      adapterConfig: { command: "echo safe" },
      runtimeConfig: { maxConcurrentRuns: 1 },
      budgetMonthlyCents: 1234,
      metadata: { source: "create-form" },
      status: "pending_approval",
      spentMonthlyCents: 0,
      permissions: {},
      lastHeartbeatAt: null,
    });
    const approval = await approvalSvc.create(spaceId, {
      type: "create_agent",
      requestedByAgentId: null,
      requestedByUserId: "operator-user",
      status: "pending",
      payload: {
        name: "Pending Coder",
        role: "engineer",
        title: "Software Engineer",
        icon: "code",
        leadAgentId: null,
        capabilities: "Writes code",
        adapterType: "process",
        adapterConfig: { command: "echo safe" },
        runtimeConfig: { maxConcurrentRuns: 1 },
        budgetMonthlyCents: 1234,
        metadata: { source: "create-form" },
        agentId: pending.id,
        appearance: pending.appearance,
      },
      decisionNote: null,
      decidedByUserId: null,
      decidedAt: null,
      updatedAt: new Date(),
    });

    await expect(agentSvc.update(pending.id, {
      name: "Tampered Coder",
      adapterConfig: { command: "echo malicious" },
      runtimeConfig: { maxConcurrentRuns: 99 },
    })).rejects.toMatchObject({
      status: 409,
      details: {
        code: "pending_approval_agent_config_frozen",
        agentId: pending.id,
        fields: ["name", "adapterConfig", "runtimeConfig"],
      },
    });
    await expect(agentSvc.updatePermissions(pending.id, {
      canCreateAgents: true,
    })).rejects.toMatchObject({
      status: 409,
      details: {
        code: "pending_approval_agent_config_frozen",
        agentId: pending.id,
        fields: ["permissions"],
      },
    });

    await db
      .update(agents)
      .set({
        name: "Tampered Coder",
        adapterConfig: { command: "echo malicious" },
        runtimeConfig: { maxConcurrentRuns: 99 },
        metadata: { source: "tampered" },
      })
      .where(eq(agents.id, pending.id));

    await approvalSvc.approve(approval.id, "operator-user", "Approved generic create");

    await expect(agentSvc.getById(pending.id)).resolves.toMatchObject({
      status: "paused",
      lifecycleState: "preparing",
      appearance: pending.appearance,
      name: "Pending Coder",
      role: "engineer",
      title: "Software Engineer",
      icon: "code",
      capabilities: "Writes code",
      adapterType: "process",
      adapterConfig: { command: "echo safe" },
      runtimeConfig: { maxConcurrentRuns: 1 },
      budgetMonthlyCents: 1234,
      metadata: { source: "create-form" },
    });
  });

  it("keeps creation authority explicit and removes legacy Default agent metadata", async () => {
    const spaceId = await seedSpace();
    const service = agentService(db);
    const insertDefaultAgent = (permissions: Record<string, unknown>) => db.insert(agents).values({
      spaceId, name: `Default agent ${randomUUID()}`, role: "lead", permissions,
      adapterType: "process", adapterConfig: {}, runtimeConfig: {},
    }).returning().then(rows => rows[0]!);
    const stored = (id: string) => db.select().from(agents).where(eq(agents.id, id)).then(rows => rows[0]!.permissions as Record<string, unknown>);

    const legacy = await insertDefaultAgent({});
    await service.updatePermissions(legacy.id, { canCreateSkills: false } as never);
    expect(await stored(legacy.id)).toMatchObject({ canCreateAgents: false, canCreateSkills: false });

    const unrecorded = await insertDefaultAgent({ canCreateAgents: false, canCreateSkills: true });
    await service.updatePermissions(unrecorded.id, { canCreateSkills: false } as never);
    expect(await stored(unrecorded.id)).toMatchObject({ canCreateAgents: false, canCreateSkills: false });

    const denial = { actorType: "user", actorId: "operator-user", at: "2026-11-08T00:00:00.000Z" };
    const denied = await insertDefaultAgent({ canCreateAgents: false, canCreateSkills: true, leadCreationDeniedBy: denial });
    await service.updatePermissions(denied.id, { canCreateSkills: false } as never);
    expect(await stored(denied.id)).toMatchObject({ canCreateAgents: false, canCreateSkills: false });
    expect(await stored(denied.id)).not.toHaveProperty("leadCreationDeniedBy");

    // Generic configuration writes also discard the retired marker.
    await service.update(denied.id, { permissions: {} } as never);
    expect(await stored(denied.id)).toMatchObject({ canCreateAgents: false });
    expect(await stored(denied.id)).not.toHaveProperty("leadCreationDeniedBy");
    const open = await insertDefaultAgent({ canCreateAgents: true });
    await service.update(open.id, { permissions: { canCreateAgents: false, leadCreationDeniedBy: denial } } as never);
    expect(await stored(open.id)).not.toHaveProperty("leadCreationDeniedBy");
  });
});
