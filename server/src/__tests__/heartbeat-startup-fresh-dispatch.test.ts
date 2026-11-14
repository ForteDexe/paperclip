import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agentRuntimeState,
  agentWakeupRequests,
  agents,
  authUsers,
  spaces,
  spaceMemberships,
  spaceSkills,
  costEvents,
  createDb,
  heartbeatRunEvents,
  heartbeatRuns,
  issues,
} from "@outpost/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { heartbeatService, startTaskDrain, stopTaskDrain } from "../services/heartbeat.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres startup fresh-dispatch tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

// After a restart, queued turns that never executed must not wait behind
// restart recovery of unrelated runs. Turns whose agent still has a run left
// `running` by the previous process, or a queued retry/continuation, depend on
// that recovery and must stay queued for the full queued-run pass.
describeEmbeddedPostgres("heartbeat startup dispatch of queued runs without prior execution", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("heartbeat-startup-fresh-dispatch-");
    db = createDb(tempDb.connectionString);
    await db.insert(authUsers).values({ id: "responsible-user", name: "Startup fixture sponsor",
      email: "startup-sponsor@example.test", createdAt: new Date(), updatedAt: new Date() });
  }, 60_000);

  afterEach(async () => {
    stopTaskDrain();
    await heartbeatService(db).drainActiveRunExecutions();
    await db.delete(heartbeatRunEvents);
    await db.delete(activityLog);
    await db.delete(costEvents);
    await db.delete(heartbeatRuns);
    await db.delete(agentWakeupRequests);
    await db.delete(issues);
    await db.delete(agentRuntimeState);
    await db.delete(agents);
    await db.delete(spaceSkills);
    await db.delete(spaceMemberships);
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
      issuePrefix: `S${spaceId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });
    await db.insert(spaceMemberships).values({ spaceId, principalType: "user", principalId: "responsible-user",
      membershipRole: "operator", status: "active" });
    return spaceId;
  }

  async function seedAgentWithIssue(spaceId: string, name: string) {
    const agentId = randomUUID();
    const issueId = randomUUID();
    await db.insert(agents).values({
      id: agentId,
      spaceId,
      name,
      role: "engineer",
      status: "idle",
      adapterType: "process",
      adapterConfig: { command: process.execPath, args: ["-e", "process.exit(0)"] },
      runtimeConfig: { heartbeat: { enabled: true, intervalSec: 60, wakeOnDemand: true } },
      permissions: {},
    });
    await db.insert(issues).values({
      id: issueId,
      spaceId,
      title: `Work for ${name}`,
      status: "todo",
      priority: "high",
      assigneeAgentId: agentId,
      responsibleUserId: "responsible-user",
    });
    return { agentId, issueId };
  }

  async function seedQueuedRun(spaceId: string, agentId: string, issueId: string,
    values: Partial<typeof heartbeatRuns.$inferInsert> = {}) {
    const runId = randomUUID();
    const wakeupRequestId = randomUUID();
    await db.insert(agentWakeupRequests).values({ id: wakeupRequestId, spaceId, agentId, source: "assignment", status: "queued" });
    await db.insert(heartbeatRuns).values({
      id: runId,
      spaceId,
      agentId,
      invocationSource: "assignment",
      triggerDetail: "system",
      status: "queued",
      wakeupRequestId,
      contextSnapshot: { issueId, wakeReason: "issue_assigned" },
      ...values,
    });
    return runId;
  }

  async function statuses(runIds: string[]) {
    const rows = await db.select({ id: heartbeatRuns.id, status: heartbeatRuns.status })
      .from(heartbeatRuns).where(inArray(heartbeatRuns.id, runIds));
    return Object.fromEntries(rows.map(row => [row.id, row.status]));
  }

  it("starts new turns at once and leaves recovery-dependent agents for the full pass", async () => {
    const spaceId = await seedSpace();
    const fresh = await seedAgentWithIssue(spaceId, "Fresh worker");
    const freshRunId = await seedQueuedRun(spaceId, fresh.agentId, fresh.issueId);

    // The previous process left this agent's run `running`; restart recovery owns it.
    const orphaned = await seedAgentWithIssue(spaceId, "Orphaned worker");
    const orphanRunId = await seedQueuedRun(spaceId, orphaned.agentId, orphaned.issueId,
      { status: "running", startedAt: new Date(Date.now() - 60_000) });
    const behindOrphanRunId = await seedQueuedRun(spaceId, orphaned.agentId, orphaned.issueId);

    // A queued retry has a prior execution and waits for recovery to settle it.
    const retrying = await seedAgentWithIssue(spaceId, "Retrying worker");
    const failedRunId = await seedQueuedRun(spaceId, retrying.agentId, retrying.issueId,
      { status: "failed", startedAt: new Date(Date.now() - 120_000), finishedAt: new Date(Date.now() - 90_000) });
    const retryRunId = await seedQueuedRun(spaceId, retrying.agentId, retrying.issueId, { retryOfRunId: failedRunId });

    const heartbeat = heartbeatService(db);
    const result = await heartbeat.resumeFreshQueuedRunsAtStartup();
    await heartbeat.drainActiveRunExecutions();

    expect(result).toEqual({ agents: 1 });
    expect(await statuses([freshRunId, orphanRunId, behindOrphanRunId, retryRunId])).toEqual({
      [freshRunId]: "succeeded",
      [orphanRunId]: "running",
      [behindOrphanRunId]: "queued",
      [retryRunId]: "queued",
    });
  }, 30_000);

  it("keeps the maintenance hold: nothing starts while a task drain is active", async () => {
    const spaceId = await seedSpace();
    const fresh = await seedAgentWithIssue(spaceId, "Held worker");
    const runId = await seedQueuedRun(spaceId, fresh.agentId, fresh.issueId);
    startTaskDrain({});

    const heartbeat = heartbeatService(db);
    expect(await heartbeat.resumeFreshQueuedRunsAtStartup()).toEqual({ agents: 0 });
    await heartbeat.drainActiveRunExecutions();
    const [run] = await db.select({ status: heartbeatRuns.status, startedAt: heartbeatRuns.startedAt })
      .from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
    expect(run).toEqual({ status: "queued", startedAt: null });
  }, 30_000);
});
