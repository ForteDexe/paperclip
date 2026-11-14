import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  agents,
  agentWakeupRequests,
  authUsers,
  spaces,
  spaceMemberships,
  createDb,
  heartbeatRuns,
  issues,
  issueThreadInteractions,
} from "@outpost/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { heartbeatService } from "../services/heartbeat.ts";
import { runningProcesses } from "../adapters/index.ts";

const mockAdapterExecute = vi.hoisted(() =>
  vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    errorMessage: null,
    summary: "Queued-run claim isolation test run.",
    provider: "test",
    model: "test-model",
  })),
);

vi.mock("../adapters/index.ts", async () => {
  const actual = await vi.importActual<typeof import("../adapters/index.ts")>("../adapters/index.ts");
  return {
    ...actual,
    getServerAdapter: vi.fn(() => ({
      supportsLocalAgentJwt: false,
      execute: mockAdapterExecute,
    })),
  };
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres queued-run claim isolation tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("heartbeat queued-run claim isolation", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let heartbeat!: ReturnType<typeof heartbeatService>;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("heartbeat-queued-run-claim-isolation-");
    db = createDb(tempDb.connectionString);
    heartbeat = heartbeatService(db);
  }, 20_000);

  afterEach(async () => {
    await heartbeat.drainActiveRunExecutions();
    mockAdapterExecute.mockClear();
    runningProcesses.clear();
    // Executed runs write to many space-scoped tables; clear them all.
    await db.execute(sql`truncate table ${spaces} cascade`);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function insertAgent() {
    const spaceId = randomUUID();
    const agentId = randomUUID();

    await db.insert(spaces).values({
      id: spaceId,
      name: "Claim Isolation Co",
      status: "active",
      issuePrefix: `T${spaceId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });

    await db.insert(agents).values({
      id: agentId,
      spaceId,
      name: "Claim Isolation Agent",
      role: "engineer",
      status: "idle",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {
        heartbeat: {
          enabled: true,
          intervalSec: 60,
          wakeOnDemand: true,
          maxConcurrentRuns: 1,
        },
      },
      permissions: {},
    });

    return { spaceId, agentId };
  }

  async function insertQueuedRun(
    spaceId: string,
    agentId: string,
    wake: Partial<typeof agentWakeupRequests.$inferInsert>,
    createdAt: Date,
  ) {
    const wakeupRequestId = randomUUID();
    const runId = randomUUID();

    await db.insert(agentWakeupRequests).values({
      id: wakeupRequestId,
      spaceId,
      agentId,
      source: "on_demand",
      triggerDetail: "manual",
      status: "queued",
      runId,
      ...wake,
    });
    await db.insert(heartbeatRuns).values({
      id: runId,
      spaceId,
      agentId,
      invocationSource: "on_demand",
      triggerDetail: "manual",
      status: "queued",
      wakeupRequestId,
      createdAt,
    });

    return { runId, wakeupRequestId };
  }

  // A queued-comment interrupt wake whose receipt cannot be verified. The run
  // identity check rejects it with a 403 every time the run is claimed.
  function insertUnverifiableInterruptRun(spaceId: string, agentId: string, createdAt = new Date(Date.now() - 60_000)) {
    return insertQueuedRun(spaceId, agentId, {
      reason: "issue_commented",
      idempotencyKey: `queued-comment-interrupt:${randomUUID()}`,
      requestedByActorType: "user",
      requestedByActorId: "operator-user",
    }, createdAt);
  }

  // A system wake with no issue in a space without members. Its responsible
  // user cannot be resolved yet (422), but a user added later would fix that.
  function insertUnresolvableOwnerRun(spaceId: string, agentId: string, createdAt = new Date(Date.now() - 60_000)) {
    return insertQueuedRun(spaceId, agentId, {
      source: "automation",
      triggerDetail: "system",
      requestedByActorType: "system",
      requestedByActorId: "heartbeat_test",
    }, createdAt);
  }

  // A manual wake from a user. It resolves its identity from the receipt, so it
  // can always be claimed.
  function insertClaimableRun(spaceId: string, agentId: string, createdAt = new Date()) {
    return insertQueuedRun(spaceId, agentId, {
      requestedByActorType: "user",
      requestedByActorId: "operator-user",
      payload: { manualUserWake: true },
    }, createdAt);
  }

  async function runStatus(runId: string) {
    return db
      .select({ status: heartbeatRuns.status, errorCode: heartbeatRuns.errorCode, error: heartbeatRuns.error })
      .from(heartbeatRuns)
      .where(sql`${heartbeatRuns.id} = ${runId}`)
      .then((rows) => rows[0] ?? null);
  }

  it("cancels a queued run whose claim is rejected instead of failing recovery", async () => {
    const { spaceId, agentId } = await insertAgent();
    const { runId, wakeupRequestId } = await insertUnverifiableInterruptRun(spaceId, agentId);

    await expect(heartbeat.resumeQueuedRuns()).resolves.toBeUndefined();

    expect(await runStatus(runId)).toMatchObject({
      status: "cancelled",
      errorCode: "queued_run_claim_rejected",
      error: "Cancelled because the queued run cannot be claimed: Queued-message interrupt authority is unavailable",
    });
    const wakeup = await db
      .select({ status: agentWakeupRequests.status })
      .from(agentWakeupRequests)
      .where(sql`${agentWakeupRequests.id} = ${wakeupRequestId}`)
      .then((rows) => rows[0] ?? null);
    expect(wakeup).toMatchObject({ status: "cancelled" });

    // Recovery runs again on the next cycle and on every restart. The run must
    // stay settled instead of failing the claim loop again.
    await expect(heartbeat.resumeQueuedRuns()).resolves.toBeUndefined();
    expect(await runStatus(runId)).toMatchObject({ status: "cancelled" });
  });

  it("claims the agent's next queued run after a rejected one", async () => {
    const { spaceId, agentId } = await insertAgent();
    const { runId: rejectedRunId } = await insertUnverifiableInterruptRun(spaceId, agentId);
    const { runId: healthyRunId } = await insertClaimableRun(spaceId, agentId);

    await expect(heartbeat.resumeQueuedRuns()).resolves.toBeUndefined();
    await heartbeat.drainActiveRunExecutions();

    expect(await runStatus(rejectedRunId)).toMatchObject({
      status: "cancelled",
      errorCode: "queued_run_claim_rejected",
    });
    expect(mockAdapterExecute).toHaveBeenCalledOnce();
    expect(await runStatus(healthyRunId)).toMatchObject({ status: "succeeded" });
  });

  it("keeps a recoverable rejection queued without blocking the runs behind it", async () => {
    const { spaceId, agentId } = await insertAgent();
    const { runId: deferredRunId } = await insertUnresolvableOwnerRun(spaceId, agentId);
    const { runId: healthyRunId } = await insertClaimableRun(spaceId, agentId);

    await expect(heartbeat.resumeQueuedRuns()).resolves.toBeUndefined();
    await heartbeat.drainActiveRunExecutions();

    expect(await runStatus(deferredRunId)).toMatchObject({ status: "queued", errorCode: null });
    expect(mockAdapterExecute).toHaveBeenCalledOnce();
    expect(await runStatus(healthyRunId)).toMatchObject({ status: "succeeded" });
  });

  it("keeps a routine run queued while another task holds the routine slot, then runs it once the slot is free", async () => {
    const { spaceId, agentId } = await insertAgent();
    const origin = { originKind: "routine_execution", originId: randomUUID(), originFingerprint: "scheduled" };
    // The earlier task keeps its lock while its failed run waits for a scheduled resume.
    const holderIssueId = randomUUID();
    const holderRunId = randomUUID();
    await db.insert(issues).values({ id: holderIssueId, spaceId, title: "Earlier routine task",
      status: "in_progress", assigneeAgentId: agentId, ...origin });
    await db.insert(heartbeatRuns).values({ id: holderRunId, spaceId, agentId, status: "failed",
      finishedAt: new Date(), contextSnapshot: { issueId: holderIssueId } });
    await db.update(issues).set({ executionRunId: holderRunId }).where(sql`${issues.id} = ${holderIssueId}`);
    const userId = `routine-owner-${randomUUID()}`;
    await db.insert(authUsers).values({ id: userId, name: "Routine owner", email: `${userId}@outpost.test`,
      createdAt: new Date(), updatedAt: new Date() });
    await db.insert(spaceMemberships).values({ spaceId, principalType: "user", principalId: userId,
      status: "active", membershipRole: "owner" });
    const routineIssueId = randomUUID();
    await db.insert(issues).values({ id: routineIssueId, spaceId, title: "Current routine task",
      status: "todo", assigneeAgentId: agentId, responsibleUserId: userId, ...origin });
    const { runId: routineRunId } = await insertQueuedRun(spaceId, agentId, {
      requestedByActorType: "user", requestedByActorId: userId,
      payload: { manualUserWake: true, issueId: routineIssueId },
    }, new Date(Date.now() - 60_000));
    await db.update(heartbeatRuns).set({ contextSnapshot: { issueId: routineIssueId } })
      .where(sql`${heartbeatRuns.id} = ${routineRunId}`);
    const { runId: healthyRunId } = await insertClaimableRun(spaceId, agentId);

    await expect(heartbeat.resumeQueuedRuns()).resolves.toBeUndefined();
    await heartbeat.drainActiveRunExecutions();
    expect(await runStatus(routineRunId)).toMatchObject({ status: "queued", errorCode: null });
    expect(await runStatus(healthyRunId)).toMatchObject({ status: "succeeded" });
    expect(mockAdapterExecute).toHaveBeenCalledOnce();

    await db.update(issues).set({ executionRunId: null }).where(sql`${issues.id} = ${holderIssueId}`);
    await expect(heartbeat.resumeQueuedRuns()).resolves.toBeUndefined();
    await heartbeat.drainActiveRunExecutions();
    expect(await runStatus(routineRunId)).toMatchObject({ status: "succeeded" });
    // Count executions per run: the finished task may queue its own follow-up run.
    const executedRunIds = mockAdapterExecute.mock.calls.map(call => ((call as unknown[])[0] as { runId?: string }).runId);
    expect(executedRunIds.filter(id => id === routineRunId)).toHaveLength(1);
    expect(executedRunIds.filter(id => id === healthyRunId)).toHaveLength(1);
  });

  async function insertCardAnswerInterruptRun(fault?: "other-answer" | "other-resolver") {
    const { spaceId, agentId } = await insertAgent();
    const userId = `card-owner-${randomUUID()}`;
    await db.insert(authUsers).values({ id: userId, name: "Card owner", email: `${userId}@outpost.test`,
      createdAt: new Date(), updatedAt: new Date() });
    await db.insert(spaceMemberships).values({ spaceId, principalType: "user", principalId: userId,
      status: "active", membershipRole: "owner" });
    const issueId = randomUUID();
    await db.insert(issues).values({ id: issueId, spaceId, title: "Website", status: "in_progress",
      assigneeAgentId: agentId, responsibleUserId: userId });
    const [interaction] = await db.insert(issueThreadInteractions).values({ spaceId, issueId,
      kind: "request_confirmation", status: "accepted", payload: { version: 1, prompt: "Use the simpler layout?" },
      result: { version: 1, outcome: "accepted" }, createdByUserId: userId,
      resolvedByUserId: fault === "other-resolver" ? "another-user" : userId, resolvedAt: new Date() }).returning();
    const queueId = randomUUID();
    const { runId, wakeupRequestId } = await insertQueuedRun(spaceId, agentId, {
      reason: "issue_commented",
      idempotencyKey: `queued-comment-interrupt:${queueId}`,
      requestedByActorType: "user",
      requestedByActorId: userId,
      payload: { issueId, interactionId: interaction!.id, explicitUserContinuation: { queuedCommentInterruptId: queueId } },
    }, new Date(Date.now() - 60_000));
    await db.insert(agentWakeupRequests).values({ id: queueId, spaceId, agentId, source: "automation",
      triggerDetail: "system", reason: "issue_commented", status: "coalesced", runId,
      requestedByActorType: "user", requestedByActorId: userId,
      payload: { issueId, mutation: "interaction", interactionId: interaction!.id, interactionKind: "request_confirmation",
        interactionStatus: "accepted", queuedCommentInterrupt: { actorId: userId, requestedAt: new Date().toISOString() } } });
    await db.update(heartbeatRuns).set({ contextSnapshot: { issueId, taskId: issueId,
      interactionId: fault === "other-answer" ? randomUUID() : interaction!.id, interactionKind: "request_confirmation",
      interactionStatus: "accepted", queuedCommentSourceWakeIds: [queueId] } }).where(sql`${heartbeatRuns.id} = ${runId}`);
    return { runId, wakeupRequestId, userId };
  }

  it("claims the successor of an interrupt that delivers a queued card answer", async () => {
    const { runId, userId } = await insertCardAnswerInterruptRun();

    await expect(heartbeat.resumeQueuedRuns()).resolves.toBeUndefined();
    await heartbeat.drainActiveRunExecutions();

    expect(await runStatus(runId)).toMatchObject({ status: "succeeded", errorCode: null });
    const [run] = await db.select({ responsibleUserId: heartbeatRuns.responsibleUserId }).from(heartbeatRuns)
      .where(sql`${heartbeatRuns.id} = ${runId}`);
    expect(run).toMatchObject({ responsibleUserId: userId });
  });

  it.each(["other-answer", "other-resolver"] as const)(
    "rejects a card-answer interrupt whose %s does not match the receipt", async (fault) => {
      const { runId } = await insertCardAnswerInterruptRun(fault);

      await expect(heartbeat.resumeQueuedRuns()).resolves.toBeUndefined();

      expect(await runStatus(runId)).toMatchObject({ status: "cancelled", errorCode: "queued_run_claim_rejected" });
      expect(mockAdapterExecute).not.toHaveBeenCalled();
    },
  );

  it("keeps processing other agents' queued runs after one agent's run is rejected", async () => {
    const first = await insertAgent();
    const second = await insertAgent();
    const { runId: rejectedRunId } = await insertUnverifiableInterruptRun(first.spaceId, first.agentId);
    const { runId: healthyRunId } = await insertClaimableRun(second.spaceId, second.agentId);

    await expect(heartbeat.resumeQueuedRuns()).resolves.toBeUndefined();
    await heartbeat.drainActiveRunExecutions();

    expect(await runStatus(rejectedRunId)).toMatchObject({ status: "cancelled" });
    expect(await runStatus(healthyRunId)).toMatchObject({ status: "succeeded" });
  });
});
