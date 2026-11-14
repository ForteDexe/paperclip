import { resolveExternalTestDatabaseUrl } from "./helpers/external-test-database.js";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  applyPendingMigrations,
  activityLog,
  agentConfigRevisions,
  agents,
  agentWakeupRequests,
  builtInManagedResources,
  cases,
  spaces,
  spaceSkillVersions,
  spaceSkills,
  spaceMemberships,
  createDb,
  heartbeatRunEvents,
  heartbeatRuns,
  issues,
  principalPermissionGrants,
  routines,
  routineTriggers,
} from "@outpost/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
// Observe the Cloud lifecycle doorbell without any network: the real
// implementation is env-gated (a no-op off Cloud), so these tests assert
// WHEN the service rings it, not what the ring does.
const notifyCloudSpy = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../services/cloud-lifecycle-sync.js", () => ({
  isCloudPinnedPrimarySpace: () => false,
  notifyCloudOfPrimarySpaceLifecycleChange: notifyCloudSpy,
}));

import { startAgentLifecycle } from "../services/agent-lifecycle.js";
import { createLifecycleDriver } from "../services/agent-lifecycle-driver.js";
import { reserveRunBudget } from "../services/budget-reservations.js";
import { spaceService } from "../services/space-service.js";
import { deriveIssuePrefixBase } from "../services/issue-prefix.js";
import { readBuiltInAgentMarker } from "../lib/built-in-agent-metadata.js";
import { builtInAgentService, reconcileBuiltInAgentsOnStartup } from "../services/built-in-agents.js";

const externalUrl = resolveExternalTestDatabaseUrl("OUTPOST_COMPANIES_TEST_DATABASE_URL");
const embeddedPostgresSupport = externalUrl ? { supported: true, reason: undefined } : await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres space service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("spaceService", () => {
  let db!: ReturnType<typeof createDb>;
  let lifecycleWorker: ReturnType<typeof startAgentLifecycle>;
  beforeEach(() => {
    lifecycleWorker = startAgentLifecycle(db, { ...createLifecycleDriver(db, {} as never),
      requiredPluginIds: async () => [], runPlugin: async () => "complete" }, () => true);
  });
  const lifecycleStateFor = (status: typeof agents.$inferInsert["status"]): NonNullable<typeof agents.$inferInsert["lifecycleState"]> =>
    status === "paused" || status === "pending_approval" || status === "terminated" ? status : "ready";
  async function insertAgents(input: typeof agents.$inferInsert | Array<typeof agents.$inferInsert>) {
    const rows = Array.isArray(input) ? input : [input];
    await db.insert(agents).values(rows.map(row => ({ ...row,
      lifecycleState: lifecycleStateFor(row.status),
      lifecycleHolds: row.status === "paused" ? [row.pauseReason ?? "manual"] : [],
    })));
  }

  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    if (externalUrl) await applyPendingMigrations(externalUrl);
    else tempDb = await startEmbeddedPostgresTestDatabase("outpost-space-service-");
    db = createDb(externalUrl ?? tempDb!.connectionString);
  }, 20_000);

  afterEach(async () => {
    await lifecycleWorker.stop();
    await db.delete(routineTriggers);
    await db.delete(routines);
    await db.delete(builtInManagedResources);
    await db.delete(spaceSkillVersions);
    await db.delete(spaceSkills);
    await db.delete(heartbeatRunEvents);
    await db.delete(heartbeatRuns);
    await db.delete(agentWakeupRequests);
    await db.delete(agentConfigRevisions);
    await db.delete(activityLog);
    await db.delete(agents);
    await db.delete(principalPermissionGrants);
    await db.delete(spaceMemberships);
    await db.delete(cases);
    await db.delete(issues);
    await db.delete(spaces);
  });

  afterAll(async () => {
    await db?.$client.end({ timeout: 1 });
    await tempDb?.cleanup();
  });

  it("retries generated issue prefixes when Drizzle wraps the unique constraint error", async () => {
    await db.insert(spaces).values({
      name: "Aron Existing",
      issuePrefix: "ARO",
    });

    const created = await spaceService(db).create({
      name: "Aron & Sharon",
    });

    expect(created.issuePrefix).toBe("AROA");

    const rows = await db.select({ issuePrefix: spaces.issuePrefix }).from(spaces);
    expect(rows.map((row) => row.issuePrefix).sort()).toEqual(["ARO", "AROA"]);
  });

  it("leaves unrelated space-hold projection out of name edits", async () => {
    const [space] = await db.insert(spaces).values({ name: "Rename only", issuePrefix: "REN" }).returning();
    const [agent] = await db.insert(agents).values({ spaceId: space.id, name: "Unrelated agent",
      status: "paused", lifecycleState: "paused", lifecycleHolds: ["manual", "space_paused"], pauseReason: "manual" }).returning();
    await spaceService(db).update(space.id, { description: "Updated description" });
    expect((await db.select().from(agents).where(eq(agents.id, agent.id)))[0].lifecycleHolds)
      .toEqual(["manual", "space_paused"]);
    await lifecycleWorker.sweep();
    expect((await db.select().from(agents).where(eq(agents.id, agent.id)))[0].lifecycleHolds).toEqual(["manual"]);
  });

  it("does not auto-provision bundled built-in agents for a freshly created space", async () => {
    const created = await spaceService(db).create({
      name: "Fresh Space",
    });

    // A new space starts clean: the Reflection Coach and Summarizer are
    // opt-in, not seeded by default for a new user.
    const agentRows = await db.select().from(agents).where(eq(agents.spaceId, created.id));
    expect(agentRows.filter((row) => readBuiltInAgentMarker(row.metadata))).toHaveLength(0);

    // Startup reconcile leaves a fresh space untouched — nothing is created.
    await reconcileBuiltInAgentsOnStartup(db);
    const afterReconcileRows = await db.select().from(agents).where(eq(agents.spaceId, created.id));
    expect(afterReconcileRows.filter((row) => readBuiltInAgentMarker(row.metadata))).toHaveLength(0);

    // The Reflection Coach remains available to enable on demand, and enabling
    // it materializes its bundled skill + paused routine.
    const enabled = await builtInAgentService(db).ensure(created.id, "reflection-coach");
    expect(enabled.agent).toMatchObject({
      name: "Reflection Coach",
      status: "paused",
      budgetMonthlyCents: 0,
    });

    const [skill] = await db
      .select()
      .from(spaceSkills)
      .where(and(
        eq(spaceSkills.spaceId, created.id),
        eq(spaceSkills.key, "outpost/bundled/outpost-operations/reflection-coach"),
      ));
    expect(skill).toMatchObject({
      slug: "reflection-coach",
    });

    const [routine] = await db
      .select()
      .from(routines)
      .where(and(eq(routines.spaceId, created.id), eq(routines.assigneeAgentId, enabled.agentId!)));
    expect(routine).toMatchObject({
      status: "paused",
      assigneeAgentId: enabled.agentId,
      originKind: "built_in_agent_bundle",
      originId: "reflection-coach:recent-agent-reflection",
    });
    const [trigger] = await db.select().from(routineTriggers).where(eq(routineTriggers.routineId, routine!.id));
    expect(trigger).toMatchObject({
      kind: "schedule",
      enabled: false,
    });
  });

  it("archives spaces by pausing runnable agents and cancelling active runs", async () => {
    const spaceId = randomUUID();
    const runningAgentId = randomUUID();
    const idleAgentId = randomUUID();
    const errorAgentId = randomUUID();
    const pausedAgentId = randomUUID();
    const pendingAgentId = randomUUID();
    const terminatedAgentId = randomUUID();
    const wakeupRequestId = randomUUID();
    const runId = randomUUID();

    await db.insert(spaces).values({
      id: spaceId,
      name: "Archive Test Co",
      issuePrefix: `T${spaceId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });

    await insertAgents([
      {
        id: runningAgentId,
        spaceId,
        name: "Running Agent",
        role: "engineer",
        status: "running",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: idleAgentId,
        spaceId,
        name: "Idle Agent",
        role: "engineer",
        status: "idle",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: errorAgentId,
        spaceId,
        name: "Error Agent",
        role: "engineer",
        status: "error",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: pausedAgentId,
        spaceId,
        name: "Paused Agent",
        role: "engineer",
        status: "paused",
        pauseReason: "manual",
        pausedAt: new Date("2026-06-01T00:00:00Z"),
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: pendingAgentId,
        spaceId,
        name: "Pending Agent",
        role: "engineer",
        status: "pending_approval",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: terminatedAgentId,
        spaceId,
        name: "Terminated Agent",
        role: "engineer",
        status: "terminated",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);

    await db.insert(agentWakeupRequests).values({
      id: wakeupRequestId,
      spaceId,
      agentId: runningAgentId,
      source: "timer",
      status: "queued",
    });

    await db.insert(heartbeatRuns).values({
      id: runId,
      spaceId,
      agentId: runningAgentId,
      invocationSource: "timer",
      status: "running",
      wakeupRequestId,
    });

    const archived = await spaceService(db).archive(spaceId, {
      actorType: "user",
      actorId: "test-user",
      agentId: null,
      runId: null,
    });

    expect(archived?.status).toBe("archived");
    // The request commits the admission block; stopping providers is owed work.
    expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId)))[0].status).toBe("running");
    expect(await lifecycleWorker.hasPending()).toBe(true);
    await lifecycleWorker.sweep();

    const archiveActivity = await db
      .select({
        actorType: activityLog.actorType,
        actorId: activityLog.actorId,
        details: activityLog.details,
      })
      .from(activityLog)
      .where(and(
        eq(activityLog.spaceId, spaceId),
        eq(activityLog.action, "space.archived"),
      ));
    expect(archiveActivity).toHaveLength(1);
    expect(archiveActivity[0]).toMatchObject({
      actorType: "user",
      actorId: "test-user",
      details: { agentsPauseRequested: 3, runsCancellationRequested: 1 },
    });

    const rows = await db
      .select({
        id: agents.id,
        status: agents.status,
        pauseReason: agents.pauseReason,
      })
      .from(agents);

    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(runningAgentId)).toMatchObject({ status: "paused", pauseReason: "space_archived" });
    expect(byId.get(idleAgentId)).toMatchObject({ status: "paused", pauseReason: "space_archived" });
    expect(byId.get(errorAgentId)).toMatchObject({ status: "paused", pauseReason: "space_archived" });
    expect(byId.get(pausedAgentId)).toMatchObject({ status: "paused", pauseReason: "manual" });
    expect(byId.get(pendingAgentId)).toMatchObject({ status: "pending_approval", pauseReason: null });
    expect(byId.get(terminatedAgentId)).toMatchObject({ status: "terminated", pauseReason: null });

    const run = await db
      .select({
        status: heartbeatRuns.status,
        error: heartbeatRuns.error,
      })
      .from(heartbeatRuns)
      .then((result) => result[0] ?? null);
    expect(run).toMatchObject({
      status: "cancelled",
      error: "Cancelled because the space was archived",
    });

    const wakeup = await db
      .select({
        status: agentWakeupRequests.status,
        error: agentWakeupRequests.error,
      })
      .from(agentWakeupRequests)
      .then((result) => result[0] ?? null);
    expect(wakeup).toMatchObject({
      status: "cancelled",
      error: "Cancelled because the space was archived",
    });
  });

  it.each(["archive", "pause"] as const)("preserves owed stops across immediate %s and reactivation", async action => {
    const spaceId = randomUUID();
    const agentId = randomUUID();
    await db.insert(spaces).values({ id: spaceId, name: "Rapid lifecycle", issuePrefix: `R${spaceId.slice(0, 6)}` });
    await insertAgents({ id: agentId, spaceId, name: "Running target", adapterType: "process", status: "running" });
    const [original] = await db.insert(heartbeatRuns).values({ spaceId, agentId, status: "running", invocationSource: "on_demand" }).returning();
    const service = spaceService(db);
    if (action === "archive") await service.archive(spaceId);
    else await service.update(spaceId, { status: "paused" });
    expect((await db.select().from(agents).where(eq(agents.id, agentId)))[0]).toMatchObject({ lifecycleState: "pausing", status: "paused" });
    expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, original.id)))[0].status).toBe("running");
    await service.update(spaceId, { status: "active" });
    const [waiting] = await db.insert(heartbeatRuns).values({ spaceId, agentId, status: "queued", invocationSource: "on_demand" }).returning();
    await expect(reserveRunBudget(db, spaceId, waiting.id, null)).rejects.toThrow(/paused|not ready/);
    await lifecycleWorker.sweep();
    expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, original.id)))[0].status).toBe("cancelled");
    expect((await db.select().from(agents).where(eq(agents.id, agentId)))[0]).toMatchObject({ lifecycleState: "ready", status: "idle" });
    const [fresh] = await db.insert(heartbeatRuns).values({ spaceId, agentId, status: "queued", invocationSource: "on_demand" }).returning();
    await expect(reserveRunBudget(db, spaceId, fresh.id, null)).resolves.toMatchObject({ runId: fresh.id, reused: false });
  });

  it("reactivates only agents paused because the space was archived", async () => {
    const spaceId = randomUUID();
    const archivedPausedAgentId = randomUUID();
    const manualPausedAgentId = randomUUID();
    const pendingAgentId = randomUUID();

    await db.insert(spaces).values({
      id: spaceId,
      name: "Reactivate Test Co",
      status: "archived",
      issuePrefix: `T${spaceId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });

    await insertAgents([
      {
        id: archivedPausedAgentId,
        spaceId,
        name: "Archived Paused Agent",
        role: "engineer",
        status: "paused",
        pauseReason: "space_archived",
        pausedAt: new Date("2026-06-01T00:00:00Z"),
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: manualPausedAgentId,
        spaceId,
        name: "Manual Paused Agent",
        role: "engineer",
        status: "paused",
        pauseReason: "manual",
        pausedAt: new Date("2026-06-01T00:00:00Z"),
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: pendingAgentId,
        spaceId,
        name: "Pending Approval Agent",
        role: "engineer",
        status: "pending_approval",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);

    const reactivated = await spaceService(db).update(
      spaceId,
      { status: "active" },
      { actorType: "user", actorId: "test-user", agentId: null, runId: null },
    );

    expect(reactivated?.status).toBe("active");
    await lifecycleWorker.sweep();

    const reactivateActivity = await db
      .select({
        actorType: activityLog.actorType,
        actorId: activityLog.actorId,
        details: activityLog.details,
      })
      .from(activityLog)
      .where(and(
        eq(activityLog.spaceId, spaceId),
        eq(activityLog.action, "space.reactivated"),
      ));
    expect(reactivateActivity).toHaveLength(1);
    expect(reactivateActivity[0]).toMatchObject({
      actorType: "user",
      actorId: "test-user",
      details: { agentsRestored: 1 },
    });

    const rows = await db
      .select({
        id: agents.id,
        status: agents.status,
        pauseReason: agents.pauseReason,
        pausedAt: agents.pausedAt,
      })
      .from(agents);

    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(archivedPausedAgentId)).toMatchObject({
      status: "idle",
      pauseReason: null,
      pausedAt: null,
    });
    expect(byId.get(manualPausedAgentId)).toMatchObject({
      status: "paused",
      pauseReason: "manual",
    });
    expect(byId.get(pendingAgentId)).toMatchObject({
      status: "pending_approval",
      pauseReason: null,
    });
  });

  it("runs the archive cascade when update() transitions a space to archived", async () => {
    const spaceId = randomUUID();
    const runningAgentId = randomUUID();
    const idleAgentId = randomUUID();
    const pendingAgentId = randomUUID();
    const wakeupRequestId = randomUUID();
    const runId = randomUUID();

    await db.insert(spaces).values({
      id: spaceId,
      name: "Update Archive Test Co",
      issuePrefix: `T${spaceId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });

    await insertAgents([
      {
        id: runningAgentId,
        spaceId,
        name: "Running Agent",
        role: "engineer",
        status: "running",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: idleAgentId,
        spaceId,
        name: "Idle Agent",
        role: "engineer",
        status: "idle",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: pendingAgentId,
        spaceId,
        name: "Pending Agent",
        role: "engineer",
        status: "pending_approval",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);

    await db.insert(agentWakeupRequests).values({
      id: wakeupRequestId,
      spaceId,
      agentId: runningAgentId,
      source: "timer",
      status: "queued",
    });

    await db.insert(heartbeatRuns).values({
      id: runId,
      spaceId,
      agentId: runningAgentId,
      invocationSource: "timer",
      status: "running",
      wakeupRequestId,
    });

    const archived = await spaceService(db).update(
      spaceId,
      { status: "archived" },
      { actorType: "user", actorId: "test-user", agentId: null, runId: null },
    );

    expect(archived?.status).toBe("archived");
    await lifecycleWorker.sweep();

    const rows = await db
      .select({ id: agents.id, status: agents.status, pauseReason: agents.pauseReason })
      .from(agents);
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(runningAgentId)).toMatchObject({ status: "paused", pauseReason: "space_archived" });
    expect(byId.get(idleAgentId)).toMatchObject({ status: "paused", pauseReason: "space_archived" });
    expect(byId.get(pendingAgentId)).toMatchObject({ status: "pending_approval", pauseReason: null });

    const run = await db
      .select({ status: heartbeatRuns.status, error: heartbeatRuns.error })
      .from(heartbeatRuns)
      .then((result) => result[0] ?? null);
    expect(run).toMatchObject({
      status: "cancelled",
      error: "Cancelled because the space was archived",
    });

    const archiveActivity = await db
      .select({
        actorType: activityLog.actorType,
        actorId: activityLog.actorId,
        details: activityLog.details,
      })
      .from(activityLog)
      .where(and(
        eq(activityLog.spaceId, spaceId),
        eq(activityLog.action, "space.archived"),
      ));
    expect(archiveActivity).toHaveLength(1);
    expect(archiveActivity[0]).toMatchObject({
      actorType: "user",
      actorId: "test-user",
      details: { agentsPauseRequested: 2, runsCancellationRequested: 1 },
    });
  });

  it("reactivates space_archived agents even when going via paused state (archived → paused → active)", async () => {
    const spaceId = randomUUID();
    const archivedPausedAgentId = randomUUID();
    const manualPausedAgentId = randomUUID();

    await db.insert(spaces).values({
      id: spaceId,
      name: "Indirect Reactivate Test Co",
      status: "paused",
      issuePrefix: `T${spaceId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });

    await insertAgents([
      {
        id: archivedPausedAgentId,
        spaceId,
        name: "Archived Paused Agent",
        role: "engineer",
        status: "paused",
        pauseReason: "space_archived",
        pausedAt: new Date("2026-06-01T00:00:00Z"),
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: manualPausedAgentId,
        spaceId,
        name: "Manual Paused Agent",
        role: "engineer",
        status: "paused",
        pauseReason: "manual",
        pausedAt: new Date("2026-06-01T00:00:00Z"),
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);

    const reactivated = await spaceService(db).update(
      spaceId,
      { status: "active" },
      { actorType: "user", actorId: "test-user", agentId: null, runId: null },
    );

    expect(reactivated?.status).toBe("active");
    await lifecycleWorker.sweep();

    const rows = await db
      .select({ id: agents.id, status: agents.status, pauseReason: agents.pauseReason })
      .from(agents);
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(archivedPausedAgentId)).toMatchObject({ status: "idle", pauseReason: null });
    expect(byId.get(manualPausedAgentId)).toMatchObject({ status: "paused", pauseReason: "manual" });

    const reactivateActivity = await db
      .select({ details: activityLog.details })
      .from(activityLog)
      .where(and(
        eq(activityLog.spaceId, spaceId),
        eq(activityLog.action, "space.reactivated"),
      ));
    expect(reactivateActivity).toHaveLength(1);
    expect(reactivateActivity[0]).toMatchObject({ details: { agentsRestored: 1 } });
  });

  it("emits space.reactivated for archived → active even when no agents need restoring", async () => {
    const spaceId = randomUUID();
    const terminatedAgentId = randomUUID();

    await db.insert(spaces).values({
      id: spaceId,
      name: "Empty Reactivate Co",
      status: "archived",
      issuePrefix: `T${spaceId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });

    await insertAgents({
      id: terminatedAgentId,
      spaceId,
      name: "Terminated Agent",
      role: "engineer",
      status: "terminated",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    const reactivated = await spaceService(db).update(
      spaceId,
      { status: "active" },
      { actorType: "user", actorId: "test-user", agentId: null, runId: null },
    );

    expect(reactivated?.status).toBe("active");

    const reactivateActivity = await db
      .select({ details: activityLog.details })
      .from(activityLog)
      .where(and(
        eq(activityLog.spaceId, spaceId),
        eq(activityLog.action, "space.reactivated"),
      ));
    expect(reactivateActivity).toHaveLength(1);
    expect(reactivateActivity[0]).toMatchObject({ details: { agentsRestored: 0 } });
  });

  it("does not emit space.reactivated when paused → active restores no archive-paused agents", async () => {
    const spaceId = randomUUID();
    const manualPausedAgentId = randomUUID();

    await db.insert(spaces).values({
      id: spaceId,
      name: "Plain Unpause Co",
      status: "paused",
      issuePrefix: `T${spaceId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });

    await insertAgents({
      id: manualPausedAgentId,
      spaceId,
      name: "Manual Paused Agent",
      role: "engineer",
      status: "paused",
      pauseReason: "manual",
      pausedAt: new Date("2026-06-01T00:00:00Z"),
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    const reactivated = await spaceService(db).update(
      spaceId,
      { status: "active" },
      { actorType: "user", actorId: "test-user", agentId: null, runId: null },
    );

    expect(reactivated?.status).toBe("active");

    const reactivateActivity = await db
      .select({ id: activityLog.id })
      .from(activityLog)
      .where(and(
        eq(activityLog.spaceId, spaceId),
        eq(activityLog.action, "space.reactivated"),
      ));
    expect(reactivateActivity).toHaveLength(0);

    const agent = await db
      .select({ status: agents.status, pauseReason: agents.pauseReason })
      .from(agents)
      .then((rows) => rows[0] ?? null);
    expect(agent).toMatchObject({ status: "paused", pauseReason: "manual" });
  });

  it("cancels orphan queued wakeup requests with no runId during archive", async () => {
    const spaceId = randomUUID();
    const agentId = randomUUID();
    const orphanWakeupId = randomUUID();
    const runWakeupId = randomUUID();
    const runId = randomUUID();

    await db.insert(spaces).values({
      id: spaceId,
      name: "Orphan Wakeup Co",
      issuePrefix: `T${spaceId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });

    await insertAgents({
      id: agentId,
      spaceId,
      name: "Idle Agent",
      role: "engineer",
      status: "idle",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    await db.insert(agentWakeupRequests).values([
      {
        id: orphanWakeupId,
        spaceId,
        agentId,
        source: "automation",
        status: "queued",
      },
      {
        id: runWakeupId,
        spaceId,
        agentId,
        source: "timer",
        status: "queued",
      },
    ]);

    await db.insert(heartbeatRuns).values({
      id: runId,
      spaceId,
      agentId,
      invocationSource: "timer",
      status: "running",
      wakeupRequestId: runWakeupId,
    });

    const archived = await spaceService(db).archive(spaceId, {
      actorType: "user",
      actorId: "test-user",
      agentId: null,
      runId: null,
    });
    expect(archived?.status).toBe("archived");
    await lifecycleWorker.sweep();

    const wakeups = await db
      .select({
        id: agentWakeupRequests.id,
        status: agentWakeupRequests.status,
        error: agentWakeupRequests.error,
      })
      .from(agentWakeupRequests);
    const byId = new Map(wakeups.map((row) => [row.id, row]));
    expect(byId.get(orphanWakeupId)).toMatchObject({
      status: "cancelled",
      error: "Cancelled because the space was archived",
    });
    expect(byId.get(runWakeupId)).toMatchObject({
      status: "cancelled",
      error: "Cancelled because the space was archived",
    });
  });

  it("archive() is idempotent — re-archiving emits no second cascade or activity entry", async () => {
    const spaceId = randomUUID();
    const agentId = randomUUID();

    await db.insert(spaces).values({
      id: spaceId,
      name: "Idempotent Archive Test Co",
      issuePrefix: `T${spaceId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });

    await insertAgents({
      id: agentId,
      spaceId,
      name: "Idle Agent",
      role: "engineer",
      status: "idle",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    const actor = { actorType: "user" as const, actorId: "test-user", agentId: null, runId: null };
    const first = await spaceService(db).archive(spaceId, actor);
    expect(first?.status).toBe("archived");

    const second = await spaceService(db).archive(spaceId, actor);
    expect(second?.status).toBe("archived");

    const archiveActivity = await db
      .select({ details: activityLog.details })
      .from(activityLog)
      .where(and(
        eq(activityLog.spaceId, spaceId),
        eq(activityLog.action, "space.archived"),
      ));
    expect(archiveActivity).toHaveLength(1);
    expect(archiveActivity[0]).toMatchObject({ details: { agentsPauseRequested: 1, runsCancellationRequested: 0 } });
  });

  it("rings the Cloud lifecycle doorbell exactly on archived-boundary transitions", async () => {
    notifyCloudSpy.mockClear();
    const spaceId = randomUUID();
    await db.insert(spaces).values({
      id: spaceId,
      name: "Doorbell Test Co",
      issuePrefix: `T${spaceId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });
    const svc = spaceService(db);
    const actor = { actorType: "user" as const, actorId: "test-user", agentId: null, runId: null };

    // A plain edit never rings.
    await svc.update(spaceId, { name: "Doorbell Test Co (renamed)" }, actor);
    expect(notifyCloudSpy).not.toHaveBeenCalled();

    // archive() rings once; re-archiving (no transition) does not.
    await svc.archive(spaceId, actor);
    expect(notifyCloudSpy).toHaveBeenCalledTimes(1);
    expect(notifyCloudSpy).toHaveBeenLastCalledWith(spaceId);
    await svc.archive(spaceId, actor);
    expect(notifyCloudSpy).toHaveBeenCalledTimes(1);

    // Unarchiving through update() rings again.
    await svc.update(spaceId, { status: "active" }, actor);
    expect(notifyCloudSpy).toHaveBeenCalledTimes(2);

    // update() into archived rings too (the status-patch archive path).
    await svc.update(spaceId, { status: "archived" }, actor);
    expect(notifyCloudSpy).toHaveBeenCalledTimes(3);
  });

  it("runs the archive cascade when update() transitions a paused space to archived", async () => {
    const spaceId = randomUUID();
    const idleAgentId = randomUUID();
    const runId = randomUUID();

    await db.insert(spaces).values({
      id: spaceId,
      name: "Paused To Archived Test Co",
      status: "paused",
      issuePrefix: `T${spaceId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });

    await insertAgents({
      id: idleAgentId,
      spaceId,
      name: "Idle Agent",
      role: "engineer",
      status: "idle",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });

    await db.insert(heartbeatRuns).values({
      id: runId,
      spaceId,
      agentId: idleAgentId,
      invocationSource: "timer",
      status: "queued",
    });

    const archived = await spaceService(db).update(
      spaceId,
      { status: "archived" },
      { actorType: "user", actorId: "test-user", agentId: null, runId: null },
    );

    expect(archived?.status).toBe("archived");
    await lifecycleWorker.sweep();

    const agent = await db
      .select({ status: agents.status, pauseReason: agents.pauseReason })
      .from(agents)
      .then((rows) => rows[0] ?? null);
    expect(agent).toMatchObject({ status: "paused", pauseReason: "space_archived" });

    const run = await db
      .select({ status: heartbeatRuns.status })
      .from(heartbeatRuns)
      .then((rows) => rows[0] ?? null);
    expect(run?.status).toBe("cancelled");

    const archiveActivity = await db
      .select({ details: activityLog.details })
      .from(activityLog)
      .where(and(
        eq(activityLog.spaceId, spaceId),
        eq(activityLog.action, "space.archived"),
      ));
    expect(archiveActivity).toHaveLength(1);
    expect(archiveActivity[0]).toMatchObject({
      details: { agentsPauseRequested: 1, runsCancellationRequested: 1 },
    });
  });

  it("getById returns null (not a query error) for non-UUID refs", async () => {
    const svc = spaceService(db);
    await expect(svc.getById("tumbly-haus-creative")).resolves.toBeNull();
    await expect(svc.getById("not-a-uuid")).resolves.toBeNull();
    await expect(svc.getById("")).resolves.toBeNull();
  });

  describe("issue prefix re-derivation on rename", () => {
    const TEST_ACTOR = {
      actorType: "user" as const,
      actorId: "test-user",
      agentId: null,
      runId: null,
    };

    beforeEach(() => {
      // The tenant server token is the managed-instance signal the prefix
      // re-derivation gates on.
      process.env.OUTPOST_CLOUD_TENANT_SERVER_TOKEN = "test-server-token";
    });

    afterEach(() => {
      delete process.env.OUTPOST_CLOUD_TENANT_SERVER_TOKEN;
    });

    async function seedSpaceWithWork(name: string, issuePrefix: string) {
      const [space] = await db
        .insert(spaces)
        .values({ name, issuePrefix })
        .returning({ id: spaces.id });
      const spaceId = space!.id;
      await db.insert(issues).values([
        { spaceId, title: "First", issueNumber: 1, identifier: `${issuePrefix}-1` },
        { spaceId, title: "Second", issueNumber: 12, identifier: `${issuePrefix}-12` },
        // A pre-identifier issue must survive the re-key untouched.
        { spaceId, title: "Unnumbered", issueNumber: null, identifier: null },
      ]);
      await db.insert(cases).values({
        spaceId,
        caseNumber: 3,
        identifier: `${issuePrefix}-C3`,
        caseType: "decision",
        title: "A case",
      });
      return spaceId;
    }

    // Nulls last, so an issue that never got an identifier stays visible in
    // the assertion instead of sorting unpredictably.
    function sortIdentifiers(values: (string | null)[]) {
      return [...values].sort((a, b) => {
        if (a === null) return b === null ? 0 : 1;
        if (b === null) return -1;
        return a.localeCompare(b);
      });
    }

    async function readIdentifiers(spaceId: string) {
      const issueRows = await db
        .select({ identifier: issues.identifier })
        .from(issues)
        .where(eq(issues.spaceId, spaceId));
      const caseRows = await db
        .select({ identifier: cases.identifier })
        .from(cases)
        .where(eq(cases.spaceId, spaceId));
      return {
        issues: sortIdentifiers(issueRows.map((row) => row.identifier)),
        cases: sortIdentifiers(caseRows.map((row) => row.identifier)),
      };
    }

    it("re-derives the prefix and re-keys both identifier tables on a managed instance", async () => {
      const spaceId = await seedSpaceWithWork("Acme Robotics", "ACM");

      const updated = await spaceService(db).update(
        spaceId,
        { name: "Northwind Traders" },
        TEST_ACTOR,
      );

      expect(updated).toMatchObject({ name: "Northwind Traders", issuePrefix: "NOR" });
      await expect(readIdentifiers(spaceId)).resolves.toEqual({
        issues: ["NOR-1", "NOR-12", null],
        cases: ["NOR-C3"],
      });

      const logged = await db
        .select({ details: activityLog.details })
        .from(activityLog)
        .where(and(
          eq(activityLog.spaceId, spaceId),
          eq(activityLog.action, "space.updated"),
        ));
      expect(logged).toHaveLength(1);
      expect(logged[0]).toMatchObject({
        details: {
          source: "space_rename",
          reason: "issue_prefix_rederived",
          previousIssuePrefix: "ACM",
          issuePrefix: "NOR",
          issuesRekeyed: 2,
          casesRekeyed: 1,
        },
      });
    });

    it("suffixes the candidate when another space already holds the derived base", async () => {
      await db.insert(spaces).values({ name: "Northwind Holdings", issuePrefix: "NOR" });
      const spaceId = await seedSpaceWithWork("Acme Robotics", "ACM");

      const updated = await spaceService(db).update(
        spaceId,
        { name: "Northwind Traders" },
        TEST_ACTOR,
      );

      expect(updated?.issuePrefix).toBe("NORA");
      await expect(readIdentifiers(spaceId)).resolves.toEqual({
        issues: ["NORA-1", "NORA-12", null],
        cases: ["NORA-C3"],
      });
    });

    it("keeps the prefix when the rename derives the same base", async () => {
      const spaceId = await seedSpaceWithWork("Acme Robotics", "ACMA");

      const updated = await spaceService(db).update(
        spaceId,
        { name: "Acme Robotics International" },
        TEST_ACTOR,
      );

      // The suffixed prefix is kept: the base did not move, so nothing needs
      // to be re-keyed and no disambiguating suffix is lost.
      expect(updated?.issuePrefix).toBe("ACMA");
      await expect(readIdentifiers(spaceId)).resolves.toEqual({
        issues: ["ACMA-1", "ACMA-12", null],
        cases: ["ACMA-C3"],
      });
      const logged = await db
        .select({ id: activityLog.id })
        .from(activityLog)
        .where(eq(activityLog.spaceId, spaceId));
      expect(logged).toHaveLength(0);
    });

    it("keeps identifiers and the space prefix together under concurrent renames", async () => {
      const spaceId = await seedSpaceWithWork("Acme Robotics", "ACM");
      const svc = spaceService(db);

      // Both renames read the space before either commits. Without a row
      // lock the loser re-keys from the prefix it read, finds nothing left to
      // move, and strands the identifiers on the winner's prefix while the
      // space row carries its own.
      await Promise.all([
        svc.update(spaceId, { name: "Northwind Traders" }, TEST_ACTOR),
        svc.update(spaceId, { name: "Zenith Freight" }, TEST_ACTOR),
      ]);

      const [space] = await db
        .select({ issuePrefix: spaces.issuePrefix })
        .from(spaces)
        .where(eq(spaces.id, spaceId));
      const prefix = space!.issuePrefix;
      expect(["NOR", "ZEN"]).toContain(prefix);
      await expect(readIdentifiers(spaceId)).resolves.toEqual({
        issues: [`${prefix}-1`, `${prefix}-12`, null],
        cases: [`${prefix}-C3`],
      });
    });

    it("keeps the prefix consistent when a stale form resubmits the old name during a rename", async () => {
      const spaceId = await seedSpaceWithWork("Acme Robotics", "ACM");
      const svc = spaceService(db);

      // The second caller submits the name it loaded before the rename. Judged
      // against its own stale read that name looks unchanged, so a pre-lock
      // comparison would skip re-derivation and restore "Acme Robotics" on top
      // of the rename's prefix.
      await Promise.all([
        svc.update(spaceId, { name: "Northwind Traders" }, TEST_ACTOR),
        svc.update(spaceId, { name: "Acme Robotics" }, TEST_ACTOR),
      ]);

      const [space] = await db
        .select({ name: spaces.name, issuePrefix: spaces.issuePrefix })
        .from(spaces)
        .where(eq(spaces.id, spaceId));
      // Whichever update commits last, the prefix derives from the name that
      // survived, and the identifiers sit on that prefix.
      expect(space!.issuePrefix.startsWith(deriveIssuePrefixBase(space!.name))).toBe(true);
      await expect(readIdentifiers(spaceId)).resolves.toEqual({
        issues: [`${space!.issuePrefix}-1`, `${space!.issuePrefix}-12`, null],
        cases: [`${space!.issuePrefix}-C3`],
      });
    });

    it("leaves the prefix alone when only non-name fields change", async () => {
      const spaceId = await seedSpaceWithWork("Acme Robotics", "ACM");

      const updated = await spaceService(db).update(
        spaceId,
        { description: "Now with rockets" },
        TEST_ACTOR,
      );

      expect(updated?.issuePrefix).toBe("ACM");
      await expect(readIdentifiers(spaceId)).resolves.toEqual({
        issues: ["ACM-1", "ACM-12", null],
        cases: ["ACM-C3"],
      });
    });

    it("never touches the prefix on a self-hosted instance", async () => {
      delete process.env.OUTPOST_CLOUD_TENANT_SERVER_TOKEN;
      const spaceId = await seedSpaceWithWork("Acme Robotics", "ACM");

      const updated = await spaceService(db).update(
        spaceId,
        { name: "Northwind Traders" },
        TEST_ACTOR,
      );

      expect(updated).toMatchObject({ name: "Northwind Traders", issuePrefix: "ACM" });
      await expect(readIdentifiers(spaceId)).resolves.toEqual({
        issues: ["ACM-1", "ACM-12", null],
        cases: ["ACM-C3"],
      });
    });
  });

});
