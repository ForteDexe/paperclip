import { resolveExternalTestDatabaseUrl } from "../../../__tests__/helpers/external-test-database.js";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agents,
  approvals,
  budgetIncidents,
  budgetPolicies,
  budgetReservations,
  budgetEvaluationWork,
  spaces,
  costEvents,
  createDb,
  applyPendingMigrations,
  documentRevisions,
  documents,
  environmentLeases,
  heartbeatRunEvents,
  heartbeatRuns,
  issueApprovals,
  issueDocuments,
  issueRelations,
  issueRecoveryActions,
  issueTreeHolds,
  issues,
  nativeRunFinalizations,
  projects,
} from "@outpost/db";
import { ISSUE_CONTINUATION_SUMMARY_DOCUMENT_KEY } from "@outpost/shared";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../../__tests__/helpers/embedded-postgres.js";
import { createPostgresRunDispatchAdapter } from "./postgres.js";
import { settleUnrecoverableExecutions } from "../../../services/execution-recovery-resolution.js";
import { getExecutionBlocker } from "../../../services/execution-blocker.js";
import { projectTaskInterruption } from "../../../services/task-interruption-presentation.js";
import { reserveRunBudget } from "../../../services/budget-reservations.js";
import { budgetService, flushBudgetEvaluationWork, recheckAdmittedRunBudgetReadOnly } from "../../../services/budgets.js";
import { costService } from "../../../services/costs.js";

// Proves the DB-to-facts mapping this adapter owns for each state the two
// run-dispatch gates decide on. `application/use-cases.test.ts` and
// `domain/policy.test.ts` cover the gates' branching with hand-built facts;
// this file proves the adapter reads the right rows into those facts, then
// feeds the mapped facts back through the real gate to prove the wiring
// produces the same suppression a caller would have seen before this module
// existed.
const external = resolveExternalTestDatabaseUrl("OUTPOST_RUN_DISPATCH_TEST_DATABASE_URL");
const embeddedPostgresSupport = external ? { supported: true, reason: undefined } : await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres run-dispatch adapter tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("run-dispatch postgres adapter", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    if (external) await applyPendingMigrations(external);
    else tempDb = await startEmbeddedPostgresTestDatabase("outpost-run-dispatch-postgres-adapter-");
    db = createDb(external ?? tempDb!.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(budgetIncidents);
    await db.delete(approvals);
    await db.delete(budgetPolicies);
    await db.delete(costEvents);
    await db.delete(environmentLeases);
    await db.delete(nativeRunFinalizations);
    await db.delete(activityLog);
    await db.delete(issueDocuments);
    await db.delete(documentRevisions);
    await db.delete(documents);
    await db.delete(issueTreeHolds);
    await db.delete(issueRelations);
    await db.delete(issues);
    await db.delete(heartbeatRunEvents);
    await db.delete(heartbeatRuns);
    await db.delete(projects);
    await db.delete(agents);
    await db.delete(spaces);
  });

  afterAll(async () => {
    await db?.$client.end({ timeout: 1 });
    await tempDb?.cleanup();
  });

  async function seedSpaceAndAgent(): Promise<{ spaceId: string; agentId: string }> {
    const spaceId = randomUUID();
    const agentId = randomUUID();
    await db.insert(spaces).values({
      id: spaceId,
      name: "Outpost",
      issuePrefix: `T${spaceId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
      defaultResponsibleUserId: "responsible-user",
    });
    await db.insert(agents).values({
      id: agentId,
      spaceId,
      name: "CodexCoder",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: { heartbeat: { wakeOnDemand: true, maxConcurrentRuns: 1 } },
      permissions: {},
    });
    return { spaceId, agentId };
  }

  async function seedAgent(input: {
    id: string;
    spaceId: string;
    name: string;
    role?: string;
  }) {
    await db.insert(agents).values({
      id: input.id,
      spaceId: input.spaceId,
      name: input.name,
      role: input.role ?? "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: { heartbeat: { wakeOnDemand: true, maxConcurrentRuns: 1 } },
      permissions: {},
    });
  }

  async function seedIssue(input: {
    spaceId: string;
    issueId: string;
    status: string;
    assigneeAgentId?: string | null;
    executionState?: Record<string, unknown> | null;
  }) {
    await db.insert(issues).values({
      id: input.issueId,
      spaceId: input.spaceId,
      title: "Run-dispatch adapter fixture issue",
      status: input.status,
      priority: "medium",
      assigneeAgentId: input.assigneeAgentId ?? null,
      executionState: input.executionState ?? null,
    });
  }

  async function seedRun(input: {
    spaceId: string;
    agentId: string;
    contextSnapshot?: Record<string, unknown>;
    status?: "queued" | "running" | "scheduled_retry";
    scheduledRetryReason?: string | null;
    now?: Date;
  }) {
    const runId = randomUUID();
    const now = input.now ?? new Date();
    await db.insert(heartbeatRuns).values({
      id: runId,
      spaceId: input.spaceId,
      agentId: input.agentId,
      invocationSource: "retry",
      status: input.status ?? "queued",
      contextSnapshot: input.contextSnapshot ?? {},
      scheduledRetryReason: input.scheduledRetryReason ?? null,
      scheduledRetryAt: input.status === "scheduled_retry" ? now : null,
      createdAt: now,
      updatedAt: now,
    });
    return runId;
  }

  async function seedCleanupRetry(status: "scheduled_retry" | "queued" = "scheduled_retry") {
    const { spaceId, agentId } = await seedSpaceAndAgent();
    const issueId = randomUUID();
    const now = new Date();
    await seedIssue({ spaceId, issueId, assigneeAgentId: agentId, status: "in_progress" });
    const sourceId = await seedRun({ spaceId, agentId, contextSnapshot: { issueId } });
    await db.update(heartbeatRuns).set({ status: "failed", finishedAt: now,
      resultJson: { conversationContinuation: "continue_conversation_v1", workspaceRestoreFailure: "restore_failed" },
    }).where(eq(heartbeatRuns.id, sourceId));
    const [lease] = await db.insert(environmentLeases).values({ spaceId, issueId,
      heartbeatRunId: sourceId, status: "pending_cleanup", cleanupStatus: "failed",
    }).returning();
    const runId = await seedRun({ spaceId, agentId, status, now,
      contextSnapshot: { issueId, retryOfRunId: sourceId, executionRetryAccounting: { version: 1, failureRetries: 1, maxTurnContinuations: 0 } },
      scheduledRetryReason: "transient_failure",
    });
    await db.update(heartbeatRuns).set({ retryOfRunId: sourceId, scheduledRetryAttempt: 1,
      resultJson: { conversationContinuation: "continue_conversation_v1" },
    }).where(eq(heartbeatRuns.id, runId));
    await db.update(issues).set({ executionRunId: runId }).where(eq(issues.id, issueId));
    return { spaceId, agentId, issueId, sourceId, leaseId: lease!.id, runId, now };
  }

  it("keeps one scheduled retry through cleanup and promotes it once after release", async () => {
    const f = await seedCleanupRetry();
    let adapter = createPostgresRunDispatchAdapter(db);
    for (let attempt = 0; attempt < 4; attempt++) {
      expect(await adapter.promoteOrCancelDueRetry({ ...f, now: new Date(f.now.getTime() + attempt * 60_000) }))
        .toMatchObject({ outcome: "not_promoted" });
      // Reconstruct the service to prove the wait survives controller restart.
      adapter = createPostgresRunDispatchAdapter(db);
    }
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.runId));
    expect(run).toMatchObject({ status: "scheduled_retry", startedAt: null, finishedAt: null,
      retryOfRunId: f.sourceId, scheduledRetryAttempt: 1,
      contextSnapshot: { executionRetryAccounting: { failureRetries: 1 } },
    });
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.spaceId, f.spaceId))).toHaveLength(2);
    expect(await db.select().from(issueRecoveryActions)).toHaveLength(0);
    const events = await db.select().from(heartbeatRunEvents).where(eq(heartbeatRunEvents.runId, f.runId));
    expect(events.filter(e => e.message?.includes("waiting for execution cleanup"))).toHaveLength(1);
    await db.update(environmentLeases).set({ status: "released", cleanupStatus: "success", releasedAt: new Date() })
      .where(eq(environmentLeases.id, f.leaseId));
    const now = new Date(f.now.getTime() + 300_000);
    const outcomes = await Promise.all([
      adapter.promoteOrCancelDueRetry({ ...f, now }), adapter.promoteOrCancelDueRetry({ ...f, now }),
    ]);
    expect(outcomes.filter(o => o.outcome === "promoted")).toHaveLength(1);
    const [resumed] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.runId));
    expect(resumed).toMatchObject({ status: "queued", scheduledRetryAttempt: 1 });
    expect(resumed.resultJson).not.toHaveProperty("executionWait");
    expect(await adapter.cancelStaleQueuedRun({ ...f, now, expectedStatus: "queued" }))
      .toMatchObject({ outcome: "not_stale" });
  });

  it("parks the same unstarted retry if cleanup becomes pending after promotion", async () => {
    const f = await seedCleanupRetry("queued");
    const adapter = createPostgresRunDispatchAdapter(db);
    expect(await adapter.cancelStaleQueuedRun({ ...f, expectedStatus: "queued" }))
      .toMatchObject({ outcome: "deferred" });
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.runId));
    expect(run).toMatchObject({ status: "scheduled_retry", scheduledRetryAttempt: 1, startedAt: null, finishedAt: null });
    expect((await db.select().from(issues).where(eq(issues.id, f.issueId)))[0].executionRunId).toBe(f.runId);
  });

  it("still suppresses a cleanup-waiting retry when the task is cancelled", async () => {
    const f = await seedCleanupRetry();
    await db.update(issues).set({ status: "cancelled" }).where(eq(issues.id, f.issueId));
    expect(await createPostgresRunDispatchAdapter(db).promoteOrCancelDueRetry(f))
      .toMatchObject({ outcome: "gate_suppressed", errorCode: "issue_cancelled" });
  });

  it("still suppresses a cleanup-waiting retry after reassignment", async () => {
    const f = await seedCleanupRetry();
    const newOwnerId = randomUUID();
    await seedAgent({ id: newOwnerId, spaceId: f.spaceId, name: "New owner" });
    await db.update(issues).set({ assigneeAgentId: newOwnerId }).where(eq(issues.id, f.issueId));
    expect(await createPostgresRunDispatchAdapter(db).promoteOrCancelDueRetry(f))
      .toMatchObject({ outcome: "gate_suppressed", errorCode: "issue_reassigned" });
  });

  it("retains a no-replay hold after cleanup releases ownership", async () => {
    const f = await seedCleanupRetry();
    const adapter = createPostgresRunDispatchAdapter(db);
    await db.insert(issueRecoveryActions).values({
      spaceId: f.spaceId, sourceIssueId: f.issueId, kind: "active_run_watchdog",
      ownerType: "operator", cause: "uncertain_external_action", status: "resolved",
      evidence: { automaticRecovery: { replay: "blocked" } }, fingerprint: f.sourceId,
      nextAction: "Verify the external action before continuing.",
    });
    expect(await adapter.promoteOrCancelDueRetry(f)).toMatchObject({ outcome: "not_promoted" });
    await db.update(environmentLeases).set({ status: "released", cleanupStatus: "success", releasedAt: new Date() })
      .where(eq(environmentLeases.id, f.leaseId));
    const now = new Date(f.now.getTime() + 60_000);
    expect(await adapter.promoteOrCancelDueRetry({ ...f, now })).toMatchObject({ outcome: "promoted" });
    expect(await adapter.cancelStaleQueuedRun({ ...f, now, expectedStatus: "queued" }))
      .toMatchObject({ outcome: "cancelled", errorCode: "execution_reconciliation_required" });
    expect(await getExecutionBlocker(db, f.spaceId, f.issueId)).toMatchObject({ cause: "uncertain_external_action" });
  });

  it.each(["native", "started", "non-conversation"])("does not park a %s run behind cleanup", async (mode) => {
    const f = await seedCleanupRetry("queued");
    await db.update(heartbeatRuns).set(mode === "native" ? { runtimeMode: "native" }
      : mode === "started" ? { startedAt: f.now } : { resultJson: {} })
      .where(eq(heartbeatRuns.id, f.runId));
    expect(await createPostgresRunDispatchAdapter(db).cancelStaleQueuedRun({ ...f, expectedStatus: "queued" }))
      .toMatchObject({ outcome: "cancelled", errorCode: "execution_reconciliation_required" });
  });

  async function seedContinuationSummary(input: {
    spaceId: string;
    issueId: string;
    agentId: string;
    body: string;
  }) {
    const documentId = randomUUID();
    const revisionId = randomUUID();
    await db.insert(documents).values({
      id: documentId,
      spaceId: input.spaceId,
      title: "Continuation Summary",
      format: "markdown",
      latestBody: input.body,
      latestRevisionId: revisionId,
      latestRevisionNumber: 1,
      createdByAgentId: input.agentId,
      updatedByAgentId: input.agentId,
    });
    await db.insert(documentRevisions).values({
      id: revisionId,
      spaceId: input.spaceId,
      documentId,
      revisionNumber: 1,
      title: "Continuation Summary",
      format: "markdown",
      body: input.body,
      createdByAgentId: input.agentId,
    });
    await db.insert(issueDocuments).values({
      spaceId: input.spaceId,
      issueId: input.issueId,
      documentId,
      key: ISSUE_CONTINUATION_SUMMARY_DOCUMENT_KEY,
    });
  }

  it.each([
    ["executionRunId", "native_safe_replacement"], ["checkoutRunId", "native_safe_replacement"],
    ["executionRunId", "native_provider_overloaded"], ["checkoutRunId", "native_provider_overloaded"],
  ] as const)("suppresses delayed retry after another run acquires %s (%s)", async (lock, retryReason) => {
    const { spaceId, agentId } = await seedSpaceAndAgent();
    const issueId = randomUUID();
    await seedIssue({ spaceId, issueId, assigneeAgentId: agentId, status: "in_progress" });
    const contextSnapshot = { issueId, wakeReason: retryReason, retryReason, forceFreshSession: true };
    const replacementId = await seedRun({ spaceId, agentId, status: "scheduled_retry", contextSnapshot });
    const competingId = await seedRun({ spaceId, agentId, status: "running", contextSnapshot: { issueId } });
    await db.update(issues).set({ [lock]: competingId }).where(eq(issues.id, issueId));
    const adapter = createPostgresRunDispatchAdapter(db);
    expect(await adapter.evaluateScheduledRetryGate({ spaceId, runId: replacementId, retryReasonOverride: retryReason, now: new Date() }))
      .toMatchObject({ allowed: false, errorCode: "issue_execution_lock_changed" });
    await db.update(heartbeatRuns).set({ status: "queued" }).where(eq(heartbeatRuns.id, replacementId));
    const reservation = await reserveRunBudget(db, spaceId, replacementId, null);
    expect(await adapter.cancelStaleQueuedRun({ spaceId, runId: replacementId, expectedStatus: "queued", now: new Date() }))
      .toMatchObject({ outcome: "cancelled", errorCode: "issue_execution_lock_changed" });

    // A competing owner can also appear after queue validation. The final
    // dispatch gate must prevent any provider call, even from a running row.
    await db.update(heartbeatRuns).set({ status: "running" }).where(eq(heartbeatRuns.id, replacementId));
    let dispatched = false;
    const outcome = await adapter.dispatchResolvedInteractionIfCurrent({ spaceId, runId: replacementId,
      reservationId: reservation.id, expectedStatus: "running", now: new Date(), dispatch: async () => { dispatched = true; } });
    expect(outcome).toMatchObject({ dispatched: false, cancellation: { outcome: "cancelled" } });
    expect(dispatched).toBe(false);
    expect((await db.select().from(issues).where(eq(issues.id, issueId)))[0]![lock]).toBe(competingId);
    expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, competingId)))[0]?.status).toBe("running");
  });

  it.each(["native_safe_replacement", "native_provider_overloaded", "interrupted_preparation"])("does not dispatch %s when the task becomes blocked after scheduling", async retryReason => {
    const { spaceId, agentId } = await seedSpaceAndAgent();
    const issueId = randomUUID();
    await seedIssue({ spaceId, issueId, assigneeAgentId: agentId, status: "in_progress" });
    const contextSnapshot = { issueId, wakeReason: retryReason, retryReason: retryReason, forceFreshSession: true };
    const replacementId = await seedRun({ spaceId, agentId, status: "scheduled_retry", contextSnapshot });
    await db.update(issues).set({ status: "blocked" }).where(eq(issues.id, issueId));
    const adapter = createPostgresRunDispatchAdapter(db);
    expect(await adapter.evaluateScheduledRetryGate({ spaceId, runId: replacementId, retryReasonOverride: retryReason, now: new Date() }))
      .toMatchObject({ allowed: false, errorCode: "issue_blocked" });
    await db.update(heartbeatRuns).set({ status: "queued" }).where(eq(heartbeatRuns.id, replacementId));
    const reservation = await reserveRunBudget(db, spaceId, replacementId, null);
    expect(await adapter.cancelStaleQueuedRun({ spaceId, runId: replacementId, expectedStatus: "queued", now: new Date() }))
      .toMatchObject({ outcome: "cancelled", errorCode: "issue_blocked" });
    await db.update(heartbeatRuns).set({ status: "running" }).where(eq(heartbeatRuns.id, replacementId));
    const dispatch = vi.fn(async () => undefined);
    expect(await adapter.dispatchResolvedInteractionIfCurrent({ spaceId, runId: replacementId, reservationId: reservation.id, expectedStatus: "running", now: new Date(), dispatch }))
      .toMatchObject({ dispatched: false, cancellation: { outcome: "cancelled" } });
    expect(dispatch).not.toHaveBeenCalled();
    expect((await db.select().from(issues).where(eq(issues.id, issueId)))[0]!.status).toBe("blocked");
  });

  it("keeps recovered preparation behind approvals added after scheduling", async () => {
    const { spaceId, agentId } = await seedSpaceAndAgent();
    const issueId = randomUUID();
    await seedIssue({ spaceId, issueId, assigneeAgentId: agentId, status: "in_progress" });
    const retryReason = "interrupted_preparation";
    const replacementId = await seedRun({ spaceId, agentId, status: "scheduled_retry",
      contextSnapshot: { issueId, wakeReason: retryReason, retryReason, forceFreshSession: true } });
    const adapter = createPostgresRunDispatchAdapter(db);
    expect(await adapter.evaluateScheduledRetryGate({ spaceId, runId: replacementId, retryReasonOverride: retryReason, now: new Date() }))
      .toMatchObject({ allowed: true });
    const approvalId = randomUUID();
    await db.insert(approvals).values({ id: approvalId, spaceId, type: "create_agent", status: "pending", payload: {} });
    await db.insert(issueApprovals).values({ spaceId, issueId, approvalId });
    expect(await adapter.evaluateScheduledRetryGate({ spaceId, runId: replacementId, retryReasonOverride: retryReason, now: new Date() }))
      .toMatchObject({ allowed: false, errorCode: "issue_waiting_for_response" });
    await db.update(heartbeatRuns).set({ status: "queued" }).where(eq(heartbeatRuns.id, replacementId));
    const reservation = await reserveRunBudget(db, spaceId, replacementId, null);
    expect(await adapter.cancelStaleQueuedRun({ spaceId, runId: replacementId, expectedStatus: "queued", now: new Date() }))
      .toMatchObject({ outcome: "cancelled", errorCode: "issue_waiting_for_response" });
    await db.update(heartbeatRuns).set({ status: "running" }).where(eq(heartbeatRuns.id, replacementId));
    const dispatch = vi.fn(async () => undefined);
    expect(await adapter.dispatchResolvedInteractionIfCurrent({ spaceId, runId: replacementId,
      reservationId: reservation.id, expectedStatus: "running", now: new Date(), dispatch }))
      .toMatchObject({ dispatched: false, cancellation: { outcome: "cancelled" } });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each(["queued", "final", "resolved"] as const)("rechecks late native replacement dependencies at %s dispatch", async mode => {
    const { spaceId, agentId } = await seedSpaceAndAgent();
    const issueId = randomUUID(), blockerId = randomUUID();
    await seedIssue({ spaceId, issueId, assigneeAgentId: agentId, status: "in_progress" });
    await seedIssue({ spaceId, issueId: blockerId, status: "todo" });
    const contextSnapshot = { issueId, wakeReason: "native_safe_replacement", retryReason: "native_safe_replacement", forceFreshSession: true };
    const replacementId = await seedRun({ spaceId, agentId, status: "scheduled_retry", contextSnapshot });
    const adapter = createPostgresRunDispatchAdapter(db);
    expect(await adapter.evaluateScheduledRetryGate({ spaceId, runId: replacementId, retryReasonOverride: "native_safe_replacement", now: new Date() }))
      .toMatchObject({ allowed: true });
    await db.update(heartbeatRuns).set({ runtimeMode: "native" }).where(eq(heartbeatRuns.id, replacementId));
    await db.insert(issueRelations).values({ spaceId, issueId: blockerId, relatedIssueId: issueId, type: "blocks" });
    const dispatch = vi.fn(async () => undefined);
    if (mode === "queued") {
      await db.update(heartbeatRuns).set({ status: "queued" }).where(eq(heartbeatRuns.id, replacementId));
      expect(await adapter.cancelStaleQueuedRun({ spaceId, runId: replacementId, expectedStatus: "queued", now: new Date() }))
        .toMatchObject({ outcome: "cancelled", errorCode: "issue_dependencies_blocked" });
    } else {
      if (mode === "resolved") await db.update(issues).set({ status: "done" }).where(eq(issues.id, blockerId));
      await db.update(issues).set({ executionRunId: replacementId }).where(eq(issues.id, issueId));
      await db.update(heartbeatRuns).set({ status: "running" }).where(eq(heartbeatRuns.id, replacementId));
      const reservation = await reserveRunBudget(db, spaceId, replacementId, null);
      const result = await adapter.dispatchResolvedInteractionIfCurrent({ spaceId, runId: replacementId, reservationId: reservation.id, expectedStatus: "running", now: new Date(), dispatch });
      expect(result).toMatchObject(mode === "resolved" ? { dispatched: true } : {
        dispatched: false, cancellation: { outcome: "cancelled", errorCode: "issue_dependencies_blocked" },
      });
    }
    expect(dispatch).toHaveBeenCalledTimes(mode === "resolved" ? 1 : 0);
    if (mode !== "resolved") {
      const [cancelled] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, replacementId));
      expect(cancelled).toMatchObject({ status: "cancelled", runtimeMode: "native", startedAt: null,
        resultJson: { stopReason: "issue_dependencies_blocked", timeoutSource: "stale_queued_run_gate" } });
      expect(projectTaskInterruption({ id: issueId, spaceId, status: "in_progress", assigneeAgentId: agentId, projectId: null }, {
        run: cancelled!, agent: { status: "idle", pauseReason: null }, paused: false, approval: false,
      })).toMatchObject({ state: "resolved", canRetry: false });
    }
    expect((await db.select().from(issues).where(eq(issues.id, issueId)))[0]!.status).toBe("in_progress");
  });

  it("commits the handoff without awaiting a recovered provider that fails before spawning", async () => {
    const { spaceId, agentId } = await seedSpaceAndAgent();
    const issueId = randomUUID();
    await seedIssue({ spaceId, issueId, assigneeAgentId: agentId, status: "in_progress" });
    const runId = await seedRun({ spaceId, agentId, status: "running", contextSnapshot: { issueId } });
    await db.update(issues).set({ executionRunId: runId }).where(eq(issues.id, issueId));
    const adapter = createPostgresRunDispatchAdapter(db);
    const reservation = await reserveRunBudget(db, spaceId, runId, null);
    const gate = await adapter.dispatchResolvedInteractionIfCurrent({
      spaceId, runId, reservationId: reservation.id, expectedStatus: "running", now: new Date(),
      dispatch: async () => {
        // The incident's third attempt failed here before onSpawn. A held
        // admission lock makes this finalization fail with lock_timeout.
        await db.transaction(async tx => {
          await tx.execute(sql`select set_config('lock_timeout', '1000', true)`);
          await tx.update(issues).set({ executionRunId: null }).where(eq(issues.id, issueId));
          await tx.update(heartbeatRuns).set({ status: "failed", finishedAt: new Date() }).where(eq(heartbeatRuns.id, runId));
        });
        return "provider_checkpoint_failed_terminal";
      },
    });
    expect(gate.dispatched).toBe(true);
    if (gate.dispatched) expect(await gate.resultPromise).toBe("provider_checkpoint_failed_terminal");
    expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId)))[0]?.status).toBe("failed");
  });

  it("commits dispatch authority before provider HTTP and permits accounting while that provider waits", async () => {
    const { spaceId, agentId } = await seedSpaceAndAgent();
    const runId = await seedRun({ spaceId, agentId, status: "running" });
    await budgetService(db).upsertPolicy(spaceId, { scopeType: "space", scopeId: spaceId,
      metric: "billed_cents", windowKind: "lifetime", amount: 100, notifyEnabled: false }, null);
    const reservation = await reserveRunBudget(db, spaceId, runId, null);
    let readyToCommit!: () => void, commit!: () => void, providerArrived!: () => void, finishProvider!: () => void;
    let readyToHandoff!: () => void, commitHandoff!: () => void;
    const ready = new Promise<void>(resolve => { readyToCommit = resolve; });
    const commitAllowed = new Promise<void>(resolve => { commit = resolve; });
    const arrived = new Promise<void>(resolve => { providerArrived = resolve; });
    const providerResponse = new Promise<void>(resolve => { finishProvider = resolve; });
    const handoffReady = new Promise<void>(resolve => { readyToHandoff = resolve; });
    const handoffCommit = new Promise<void>(resolve => { commitHandoff = resolve; });
    let requests = 0;
    const server = createServer((_request, response) => {
      requests += 1;
      providerArrived();
      void providerResponse.then(() => response.end("provider result"));
    });
    await new Promise<void>(resolve => { server.listen(0, "127.0.0.1", resolve); });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a provider HTTP fixture port");
    const dispatch = vi.fn(async () => (await fetch(`http://127.0.0.1:${address.port}`)).text());
    const transaction = db.transaction.bind(db);
    let transactionNumber = 0;
    // Freeze the exact SQL commit boundary. A provider callback inside the
    // accounting transaction would contact this server before we release it.
    const transactionSpy = vi.spyOn(db, "transaction").mockImplementation(async (callback, config) => {
      const phase = ++transactionNumber;
      return transaction(async tx => {
        const value = await callback(tx);
        if (phase === 1) { readyToCommit(); await commitAllowed; }
        if (phase === 2) { readyToHandoff(); await handoffCommit; }
        return value;
      }, config);
    });
    const admission = createPostgresRunDispatchAdapter(db).dispatchResolvedInteractionIfCurrent({
      spaceId, runId, reservationId: reservation.id, expectedStatus: "running", now: new Date(), dispatch,
    });
    let result: Promise<string> | undefined;
    let charge: Promise<unknown> | undefined;
    try {
      await ready;
      expect(dispatch).not.toHaveBeenCalled();
      expect(requests).toBe(0);
      commit();
      await Promise.all([arrived, handoffReady]);
      const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
      expect(run.usageJson?.budgetDispatch).toMatchObject({ reservationId: reservation.id, recoveryLeaseOwner: null });
      // This charge commits after dispatch admission. It durably queues budget
      // evaluation without waiting for the provider's response or ownership tx.
      const beforeInputs = await db.select({ id: budgetEvaluationWork.id }).from(budgetEvaluationWork)
        .where(eq(budgetEvaluationWork.spaceId, spaceId));
      let charged = false;
      charge = costService(db).createEvent(spaceId, { agentId, provider: "fixture", model: "post-admission-charge",
        costCents: 100, inputTokens: 1, outputTokens: 1, occurredAt: new Date() }).then(() => { charged = true; });
      void charge.catch(() => {});
      // Phase two still owns issue/run locks and the provider is waiting.
      // Holding space accounting here would stall this independent charge.
      await vi.waitFor(() => expect(charged).toBe(true), { timeout: 2_000 });
      const inputs = await db.select({ id: budgetEvaluationWork.id }).from(budgetEvaluationWork)
        .where(eq(budgetEvaluationWork.spaceId, spaceId));
      expect(inputs.length).toBeGreaterThan(beforeInputs.length);
      expect(requests).toBe(1);
      commitHandoff();
      const gate = await admission;
      transactionSpy.mockRestore();
      expect(gate.dispatched).toBe(true);
      if (!gate.dispatched) throw new Error("Expected committed provider admission");
      result = gate.resultPromise;
      await flushBudgetEvaluationWork(db, { spaceId });
      const [policy] = await db.select().from(budgetPolicies).where(eq(budgetPolicies.spaceId, spaceId));
      expect(policy.enforcementVersion).toBeGreaterThan(policy.enforcementDeliveredVersion);
      finishProvider();
      expect(await result).toBe("provider result");
    } finally {
      commit();
      commitHandoff();
      finishProvider();
      transactionSpy.mockRestore();
      await admission.catch(() => undefined);
      await result?.catch(() => undefined);
      await charge?.catch(() => undefined);
      server.closeAllConnections();
      await new Promise<void>(resolve => { server.close(() => resolve()); });
    }
  });

  it("does not hand off when another run takes issue ownership after accounting admission commits", async () => {
    const { spaceId, agentId } = await seedSpaceAndAgent();
    const issueId = randomUUID();
    await seedIssue({ spaceId, issueId, status: "in_progress", assigneeAgentId: agentId });
    const runId = await seedRun({ spaceId, agentId, status: "running", contextSnapshot: { issueId } });
    const competingId = await seedRun({ spaceId, agentId, status: "running", contextSnapshot: { issueId } });
    await db.update(issues).set({ executionRunId: runId }).where(eq(issues.id, issueId));
    const reservation = await reserveRunBudget(db, spaceId, runId, null);
    const transaction = db.transaction.bind(db);
    let admitted = false;
    const race = vi.spyOn(db, "transaction").mockImplementation(async (callback, config) => {
      const value = await transaction(callback, config);
      if (!admitted) { admitted = true; await db.update(issues).set({ executionRunId: competingId }).where(eq(issues.id, issueId)); }
      return value;
    });
    const dispatch = vi.fn(async () => "must not run");
    try {
      expect(await createPostgresRunDispatchAdapter(db).dispatchResolvedInteractionIfCurrent({ spaceId, runId,
        reservationId: reservation.id, expectedStatus: "running", now: new Date(), dispatch })).toMatchObject({ dispatched: false,
          cancellation: { outcome: "cancelled", errorCode: "issue_execution_lock_changed" } });
      expect(dispatch).not.toHaveBeenCalled();
      expect((await db.select().from(issues).where(eq(issues.id, issueId)))[0].executionRunId).toBe(competingId);
    } finally { race.mockRestore(); }
  });

  it.each(["charge", "budget reduction"] as const)("rejects a committed %s between accounting admission and final ownership handoff", async change => {
    const { spaceId, agentId } = await seedSpaceAndAgent();
    const runId = await seedRun({ spaceId, agentId, status: "running" });
    const budgets = budgetService(db);
    await budgets.upsertPolicy(spaceId, { scopeType: "space", scopeId: spaceId,
      metric: "billed_cents", windowKind: "lifetime", amount: 100, reservationCents: "60", notifyEnabled: false }, null);
    const reservation = await reserveRunBudget(db, spaceId, runId, null);
    const transaction = db.transaction.bind(db);
    let admitted = false;
    const race = vi.spyOn(db, "transaction").mockImplementation(async (callback, config) => {
      const value = await transaction(callback, config);
      if (!admitted) {
        admitted = true;
        if (change === "charge") await costService(db).createEvent(spaceId, { agentId, provider: "fixture",
          model: "between-phase-charge", inputTokens: 1, outputTokens: 1, costCents: 50, occurredAt: new Date() });
        else await budgets.upsertPolicy(spaceId, { scopeType: "space", scopeId: spaceId,
          metric: "billed_cents", windowKind: "lifetime", amount: 50 }, null);
      }
      return value;
    });
    const dispatch = vi.fn(async () => "must not run");
    try {
      expect(await createPostgresRunDispatchAdapter(db).dispatchResolvedInteractionIfCurrent({ spaceId, runId,
        reservationId: reservation.id, expectedStatus: "running", now: new Date(), dispatch })).toMatchObject({ dispatched: false,
          admissionBlockReason: "Available budget is reserved by unfinished runs" });
      expect(dispatch).not.toHaveBeenCalled();
      // Neither case has actually spent its hard-stop limit. The denial must
      // observe capacity, rather than relying only on a projected pause flag.
      expect((await db.select().from(spaces).where(eq(spaces.id, spaceId)))[0].status).toBe("active");
    } finally { race.mockRestore(); }
  });

  it("performs the post-admission capacity check in a PostgreSQL read-only transaction", async () => {
    const { spaceId, agentId } = await seedSpaceAndAgent();
    const runId = await seedRun({ spaceId, agentId, status: "running" });
    await budgetService(db).upsertPolicy(spaceId, { scopeType: "space", scopeId: spaceId,
      metric: "billed_cents", windowKind: "lifetime", amount: 100, reservationCents: "60", notifyEnabled: false }, null);
    const reservation = await reserveRunBudget(db, spaceId, runId, null);
    await db.transaction(async tx => {
      await tx.execute(sql`set transaction read only`);
      // PostgreSQL rejects both writes and SELECT FOR UPDATE in this mode.
      expect(await recheckAdmittedRunBudgetReadOnly(tx as unknown as typeof db,
        { spaceId, agentId, runId, projectId: null, reservationId: reservation.id })).toBeNull();
    });
  });

  it("does not dispatch into an archival project deleted after accounting admission", async () => {
    const { spaceId, agentId } = await seedSpaceAndAgent();
    const runId = await seedRun({ spaceId, agentId, status: "running" });
    const [project] = await db.insert(projects).values({ spaceId, name: "Dispatch project" }).returning();
    const reservation = await reserveRunBudget(db, spaceId, runId, project.id);
    const transaction = db.transaction.bind(db);
    let admitted = false;
    const race = vi.spyOn(db, "transaction").mockImplementation(async (callback, config) => {
      const value = await transaction(callback, config);
      if (!admitted) { admitted = true; await db.delete(projects).where(eq(projects.id, project.id)); }
      return value;
    });
    const dispatch = vi.fn(async () => "must not run");
    try {
      expect(await createPostgresRunDispatchAdapter(db).dispatchResolvedInteractionIfCurrent({ spaceId, runId,
        reservationId: reservation.id, expectedStatus: "running", now: new Date(), dispatch })).toMatchObject({ dispatched: false,
          admissionBlockReason: "Reserved project no longer exists" });
      expect(dispatch).not.toHaveBeenCalled();
      expect((await db.select().from(budgetReservations).where(eq(budgetReservations.id, reservation.id)))[0])
        .toMatchObject({ state: "held", projectId: project.id });
    } finally { race.mockRestore(); }
  });

  it("initiates the provider callback while the final issue ownership lock is held without awaiting its response", async () => {
    const { spaceId, agentId } = await seedSpaceAndAgent();
    const issueId = randomUUID();
    await seedIssue({ spaceId, issueId, status: "in_progress", assigneeAgentId: agentId });
    const runId = await seedRun({ spaceId, agentId, status: "running", contextSnapshot: { issueId } });
    const competingId = await seedRun({ spaceId, agentId, status: "running", contextSnapshot: { issueId } });
    await db.update(issues).set({ executionRunId: runId }).where(eq(issues.id, issueId));
    const reservation = await reserveRunBudget(db, spaceId, runId, null);
    const transaction = db.transaction.bind(db);
    let phase = 0, finishProvider!: () => void;
    const response = new Promise<void>(resolve => { finishProvider = resolve; });
    const ordering: string[] = [];
    const race = vi.spyOn(db, "transaction").mockImplementation(async (callback, config) => {
      const current = ++phase;
      const value = await transaction(callback, config);
      if (current === 2) {
        await db.update(issues).set({ executionRunId: competingId }).where(eq(issues.id, issueId));
        ordering.push("competing-owner");
      }
      return value;
    });
    try {
      const gate = await createPostgresRunDispatchAdapter(db).dispatchResolvedInteractionIfCurrent({ spaceId, runId,
        reservationId: reservation.id, expectedStatus: "running", now: new Date(),
        dispatch: () => { ordering.push("handoff"); return response; } });
      expect(gate.dispatched).toBe(true);
      expect(ordering).toEqual(["handoff", "competing-owner"]);
      finishProvider();
      if (gate.dispatched) await gate.resultPromise;
    } finally { finishProvider(); race.mockRestore(); }
  });

  it.each(["0", "25"])("fences duplicate handoff of a %s-cent reservation generation", async reservationCents => {
    const { spaceId, agentId } = await seedSpaceAndAgent();
    const runId = await seedRun({ spaceId, agentId, status: "running" });
    await budgetService(db).upsertPolicy(spaceId, { scopeType: "space", scopeId: spaceId,
      metric: "billed_cents", windowKind: "lifetime", amount: 100, reservationCents, notifyEnabled: false }, null);
    const reservation = await reserveRunBudget(db, spaceId, runId, null);
    const dispatch = vi.fn(async () => "one handoff");
    const input = { spaceId, runId, reservationId: reservation.id, expectedStatus: "running" as const, now: new Date(), dispatch };
    const adapter = createPostgresRunDispatchAdapter(db);
    const first = await adapter.dispatchResolvedInteractionIfCurrent(input);
    expect(first.dispatched).toBe(true);
    if (first.dispatched) await first.resultPromise;
    expect(await adapter.dispatchResolvedInteractionIfCurrent(input)).toMatchObject({ dispatched: false,
      admissionBlockReason: "Provider dispatch already admitted this reservation generation" });
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it("does not enter a provider when its dispatch claim rolls back", async () => {
    const { spaceId, agentId } = await seedSpaceAndAgent();
    const runId = await seedRun({ spaceId, agentId, status: "running" });
    const reservation = await reserveRunBudget(db, spaceId, runId, null);
    const transaction = db.transaction.bind(db);
    const rollback = vi.spyOn(db, "transaction").mockImplementation(async (callback, config) => transaction(async tx => {
      await callback(tx);
      throw new Error("fixture commit rejected");
    }, config));
    const dispatch = vi.fn(async () => "must not run");
    try {
      await expect(createPostgresRunDispatchAdapter(db).dispatchResolvedInteractionIfCurrent({ spaceId, runId,
        reservationId: reservation.id, expectedStatus: "running", now: new Date(), dispatch })).rejects.toThrow("fixture commit rejected");
      expect(dispatch).not.toHaveBeenCalled();
    } finally { rollback.mockRestore(); }
    expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId)))[0].usageJson?.budgetDispatch).toBeUndefined();
  });

  it("retains uncertain dispatch authority when the ownership commit fails after callback entry", async () => {
    const { spaceId, agentId } = await seedSpaceAndAgent();
    const runId = await seedRun({ spaceId, agentId, status: "running" });
    const reservation = await reserveRunBudget(db, spaceId, runId, null);
    const transaction = db.transaction.bind(db);
    let phase = 0;
    const rollback = vi.spyOn(db, "transaction").mockImplementation(async (callback, config) => {
      const current = ++phase;
      return transaction(async tx => {
        const value = await callback(tx);
        if (current === 2) throw new Error("fixture ownership commit rejected");
        return value;
      }, config);
    });
    const dispatch = vi.fn(async () => "provider already entered");
    const input = { spaceId, runId, reservationId: reservation.id, expectedStatus: "running" as const, now: new Date(), dispatch };
    try {
      await expect(createPostgresRunDispatchAdapter(db).dispatchResolvedInteractionIfCurrent(input)).rejects.toThrow("fixture ownership commit rejected");
      expect(dispatch).toHaveBeenCalledOnce();
    } finally { rollback.mockRestore(); }
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
    expect(run).toMatchObject({ costAccountingPending: true, costAccountedAt: null,
      usageJson: { budgetDispatch: { reservationId: reservation.id } } });
    expect((await db.select().from(budgetReservations).where(eq(budgetReservations.id, reservation.id)))[0].state).toBe("held");
    expect(await createPostgresRunDispatchAdapter(db).dispatchResolvedInteractionIfCurrent(input))
      .toMatchObject({ dispatched: false, admissionBlockReason: "Provider dispatch already admitted this reservation generation" });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(await db.select().from(costEvents)).toHaveLength(0);
  });

  it("commits the ownership handoff when a provider callback throws synchronously", async () => {
    const { spaceId, agentId } = await seedSpaceAndAgent();
    const runId = await seedRun({ spaceId, agentId, status: "running" });
    const reservation = await reserveRunBudget(db, spaceId, runId, null);
    const failure = new Error("synchronous provider bootstrap failure");
    const dispatch = vi.fn(() => { throw failure; });
    const input = { spaceId, runId, reservationId: reservation.id, expectedStatus: "running" as const, now: new Date(), dispatch };
    const gate = await createPostgresRunDispatchAdapter(db).dispatchResolvedInteractionIfCurrent(input);
    expect(gate.dispatched).toBe(true);
    if (gate.dispatched) await expect(gate.resultPromise).rejects.toBe(failure);
    expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId)))[0].usageJson?.budgetDispatch)
      .toMatchObject({ reservationId: reservation.id, handedOffAt: expect.any(String) });
    expect(await createPostgresRunDispatchAdapter(db).dispatchResolvedInteractionIfCurrent(input))
      .toMatchObject({ dispatched: false, admissionBlockReason: "Provider dispatch already admitted this reservation generation" });
    expect(dispatch).toHaveBeenCalledOnce();
  });

  it.each(["charge", "budget reduction"] as const)("rechecks a late %s after ordinary run preparation before any provider handoff", async change => {
    const { spaceId, agentId } = await seedSpaceAndAgent();
    const runId = await seedRun({ spaceId, agentId, status: "running" });
    const budgets = budgetService(db);
    await budgets.upsertPolicy(spaceId, { scopeType: "space", scopeId: spaceId,
      metric: "billed_cents", windowKind: "lifetime", amount: 100, reservationCents: "60", notifyEnabled: false }, null);
    const reservation = await reserveRunBudget(db, spaceId, runId, null);
    let finishPreparation!: () => void;
    const preparation = new Promise<void>(resolve => { finishPreparation = resolve; });
    const dispatch = vi.fn(async () => "provider started");
    const preparedDispatch = preparation.then(() => createPostgresRunDispatchAdapter(db).dispatchResolvedInteractionIfCurrent({
      spaceId, runId, reservationId: reservation.id, expectedStatus: "running", now: new Date(), dispatch,
    }));
    try {
      if (change === "charge") await costService(db).createEvent(spaceId, {
        agentId, provider: "test", model: "dispatch-race", costCents: 50,
        inputTokens: 1, outputTokens: 1, occurredAt: new Date(),
      });
      else await budgets.upsertPolicy(spaceId, { scopeType: "space", scopeId: spaceId,
        metric: "billed_cents", windowKind: "lifetime", amount: 50 }, null);
      finishPreparation();
      expect(await preparedDispatch).toMatchObject({ dispatched: false,
        admissionBlockReason: "Available budget is reserved by unfinished runs" });
      expect(dispatch).not.toHaveBeenCalled();
    } finally { finishPreparation(); await preparedDispatch; }
  });

  it("does not count its own existing reservation twice at final handoff", async () => {
    const { spaceId, agentId } = await seedSpaceAndAgent();
    const runId = await seedRun({ spaceId, agentId, status: "running" });
    await budgetService(db).upsertPolicy(spaceId, { scopeType: "space", scopeId: spaceId,
      metric: "billed_cents", windowKind: "lifetime", amount: 100, reservationCents: "100", notifyEnabled: false }, null);
    const reservation = await reserveRunBudget(db, spaceId, runId, null);
    const dispatch = vi.fn(async () => "started");
    const gate = await createPostgresRunDispatchAdapter(db).dispatchResolvedInteractionIfCurrent({
      spaceId, runId, reservationId: reservation.id, expectedStatus: "running", now: new Date(), dispatch,
    });
    expect(gate.dispatched).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
    if (gate.dispatched) expect(await gate.resultPromise).toBe("started");
  });

  it("does not dispatch a zero reservation once other work has fully reserved capacity", async () => {
    const { spaceId, agentId } = await seedSpaceAndAgent();
    const runId = await seedRun({ spaceId, agentId, status: "running" });
    const budgets = budgetService(db);
    await budgets.upsertPolicy(spaceId, { scopeType: "space", scopeId: spaceId,
      metric: "billed_cents", windowKind: "lifetime", amount: 100, reservationCents: "0", notifyEnabled: false }, null);
    const reservation = await reserveRunBudget(db, spaceId, runId, null);
    await budgets.upsertPolicy(spaceId, { scopeType: "space", scopeId: spaceId,
      metric: "billed_cents", windowKind: "lifetime", reservationCents: "100" }, null);
    const otherRunId = await seedRun({ spaceId, agentId, status: "running" });
    await reserveRunBudget(db, spaceId, otherRunId, null);
    const dispatch = vi.fn(async () => undefined);
    expect(await createPostgresRunDispatchAdapter(db).dispatchResolvedInteractionIfCurrent({
      spaceId, runId, reservationId: reservation.id, expectedStatus: "running", now: new Date(), dispatch,
    })).toMatchObject({ dispatched: false, admissionBlockReason: "Available budget is reserved by unfinished runs" });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("denies an overrun at final handoff and leaves its budget stop to the worker", async () => {
    const { spaceId, agentId } = await seedSpaceAndAgent();
    const runId = await seedRun({ spaceId, agentId, status: "running" });
    await budgetService(db).upsertPolicy(spaceId, { scopeType: "space", scopeId: spaceId,
      metric: "billed_cents", windowKind: "lifetime", amount: 100, notifyEnabled: false }, null);
    const reservation = await reserveRunBudget(db, spaceId, runId, null);
    // The committed charge queues enforcement. Admission reads the overrun
    // immediately, while lifecycle transitions remain owned by the worker.
    await costService(db).createEvent(spaceId, { agentId, provider: "test", model: "unprojected-charge",
      inputTokens: 1, outputTokens: 1, costCents: 110, occurredAt: new Date() });
    const dispatch = vi.fn(async () => undefined);
    expect(await createPostgresRunDispatchAdapter(db).dispatchResolvedInteractionIfCurrent({
      spaceId, runId, reservationId: reservation.id, expectedStatus: "running", now: new Date(), dispatch,
    })).toMatchObject({ dispatched: false, admissionBlockReason: expect.any(String) });
    expect(dispatch).not.toHaveBeenCalled();
    expect((await db.select().from(spaces).where(eq(spaces.id, spaceId)))[0])
      .toMatchObject({ status: "active", pauseReason: null });
    await flushBudgetEvaluationWork(db, { spaceId });
    expect((await db.select().from(spaces).where(eq(spaces.id, spaceId)))[0])
      .toMatchObject({ status: "paused", pauseReason: "budget" });
    const [policy] = await db.select().from(budgetPolicies).where(eq(budgetPolicies.spaceId, spaceId));
    expect(policy.enforcementVersion).toBeGreaterThan(policy.enforcementDeliveredVersion);
  });

  it.each([false, true])("preserves accepted non-assignee work while retaining its final budget gate (late reduction: %s)", async reduceBudget => {
    const { spaceId, agentId } = await seedSpaceAndAgent();
    const assigneeId = randomUUID(), issueId = randomUUID();
    await seedAgent({ id: assigneeId, spaceId, name: "Assigned owner" });
    await seedIssue({ spaceId, issueId, assigneeAgentId: assigneeId, status: "in_progress" });
    const runId = await seedRun({ spaceId, agentId, status: "running",
      contextSnapshot: { issueId, wakeReason: "issue_comment_mentioned", commentId: randomUUID() } });
    const budgets = budgetService(db);
    await budgets.upsertPolicy(spaceId, { scopeType: "space", scopeId: spaceId,
      metric: "billed_cents", windowKind: "lifetime", amount: 100, reservationCents: "60", notifyEnabled: false }, null);
    const reservation = await reserveRunBudget(db, spaceId, runId, null);
    if (reduceBudget) await budgets.upsertPolicy(spaceId, { scopeType: "space", scopeId: spaceId,
      metric: "billed_cents", windowKind: "lifetime", amount: 50 }, null);
    const dispatch = vi.fn(async () => "accepted mention delivered");
    const gate = await createPostgresRunDispatchAdapter(db).dispatchResolvedInteractionIfCurrent({ spaceId, runId,
      reservationId: reservation.id, expectedStatus: "running", enforceContinuationOwnership: false, now: new Date(), dispatch });
    expect(gate.dispatched).toBe(!reduceBudget);
    expect(dispatch).toHaveBeenCalledTimes(reduceBudget ? 0 : 1);
    if (!gate.dispatched) expect(gate).toMatchObject({ admissionBlockReason: "Available budget is reserved by unfinished runs" });
    const [issue] = await db.select().from(issues).where(eq(issues.id, issueId));
    expect(issue).toMatchObject({ assigneeAgentId: assigneeId, executionRunId: null });
  });

  async function seedRecoveryAdmission() {
    const { spaceId, agentId } = await seedSpaceAndAgent();
    const issueId = randomUUID(), owner = `recovery:${randomUUID()}`;
    await seedIssue({ spaceId, issueId, assigneeAgentId: agentId, status: "in_progress" });
    const runId = await seedRun({ spaceId, agentId, status: "running", contextSnapshot: { issueId } });
    await db.update(heartbeatRuns).set({ runtimeMode: "native", nativeIssueId: issueId }).where(eq(heartbeatRuns.id, runId));
    await db.update(issues).set({ executionRunId: runId }).where(eq(issues.id, issueId));
    const reservation = await reserveRunBudget(db, spaceId, runId, null);
    await db.insert(nativeRunFinalizations).values({ spaceId, issueId, runId, phase: "observed",
      leaseOwner: owner, leaseExpiresAt: new Date(Date.now() + 60_000) });
    return { spaceId, agentId, issueId, runId, owner, reservation };
  }

  it.each(["fresh", "bootstrap", "dead-runner", "expired", "foreign-owner", "foreign-intent", "missing-audit", "foreign-audit", "stale-generation", "terminal", "no-hold", "settled-hold"] as const)(
    "keeps %s work fenced while a space is paused for budget", async mode => {
      const f = await seedRecoveryAdmission();
      const intentAuditId = randomUUID();
      await db.insert(activityLog).values({ id: intentAuditId, spaceId: f.spaceId, actorType: "system", actorId: "native-session-cancellation",
        action: "native.cancellation_intent_recorded", entityType: "heartbeat_run", entityId: f.runId, runId: f.runId, agentId: f.agentId });
      await db.update(nativeRunFinalizations).set({ controllerGeneration: 2, attempt: 1, recoveryState: "awaiting_runner_reattach",
        recoveryHistory: [{ disposition: "reattach_remote_runner", controllerGeneration: 2, providerAttempt: 1 }],
        ...(mode === "bootstrap" ? { recoveryState: "bootstrap_incomplete" } : {}),
        ...(mode === "dead-runner" ? { recoveryState: "resuming_session" } : {}),
        ...(mode === "expired" ? { leaseExpiresAt: new Date(Date.now() - 1) } : {}),
        ...(mode === "foreign-owner" ? { leaseOwner: "another-owner" } : {}),
        ...(mode === "stale-generation" ? { controllerGeneration: 3 } : {}),
        ...(mode === "terminal" ? { phase: "terminal_failure" } : {}),
      }).where(eq(nativeRunFinalizations.runId, f.runId));
      await db.update(heartbeatRuns).set({ resultJson: mode === "fresh" ? {} : {
        startupCancellation: { beforeNativeSelection: false, errorCode: "cancelled", requestedAt: new Date().toISOString() },
        nativeCancellation: { schema: "outpost.native-cancellation.v1", spaceId: f.spaceId, runId: f.runId,
          issueId: mode === "foreign-intent" ? randomUUID() : f.issueId, scope: "run", reasonCode: "cancellation_run_only",
          intentId: `native-cancellation:${randomUUID()}`, intentAuditId: mode === "missing-audit" ? randomUUID() : intentAuditId,
          dispatchState: "pending", dispatched: false, effects: ["release_run_resources"] },
      } }).where(eq(heartbeatRuns.id, f.runId));
      if (mode === "foreign-audit") await db.update(activityLog).set({ entityId: randomUUID() }).where(eq(activityLog.id, intentAuditId));
      if (mode === "no-hold") await db.delete(budgetReservations).where(eq(budgetReservations.id, f.reservation.id));
      if (mode === "settled-hold") await db.update(budgetReservations).set({ state: "settled" }).where(eq(budgetReservations.id, f.reservation.id));
      await db.update(spaces).set({ status: "paused", pauseReason: "budget" }).where(eq(spaces.id, f.spaceId));
      await expect(reserveRunBudget(db, f.spaceId, f.runId, null, {}, f.owner)).rejects.toThrow();
      const dispatch = vi.fn(async () => undefined);
      const gate = await createPostgresRunDispatchAdapter(db).dispatchResolvedInteractionIfCurrent({ spaceId: f.spaceId, runId: f.runId,
        reservationId: f.reservation.id, recoveryLeaseOwner: f.owner, expectedStatus: "running", now: new Date(), dispatch })
        .catch(error => ({ dispatched: false, error }));
      expect(gate.dispatched).toBe(false);
      expect(dispatch).not.toHaveBeenCalled();
      expect(await db.select().from(budgetReservations).where(eq(budgetReservations.runId, f.runId)))
        .toHaveLength(mode === "no-hold" ? 0 : 1);
      expect(await db.select().from(costEvents).where(eq(costEvents.heartbeatRunId, f.runId))).toHaveLength(0);
    });

  it.each(["reservation", "dispatch"] as const)("orders recovery %s behind a coordinator before taking finalization's issue and run locks", async boundary => {
    const f = await seedRecoveryAdmission();
    let signalLocked!: () => void, allowFinalization!: () => void;
    const locked = new Promise<void>(resolve => { signalLocked = resolve; });
    const proceed = new Promise<void>(resolve => { allowFinalization = resolve; });
    const finalization = db.transaction(async tx => {
      await tx.execute(sql`set local lock_timeout = '2000ms'`);
      await tx.select({ id: nativeRunFinalizations.runId }).from(nativeRunFinalizations)
        .where(eq(nativeRunFinalizations.runId, f.runId)).for("update");
      signalLocked();
      await proceed;
      await tx.select({ id: issues.id }).from(issues).where(eq(issues.id, f.issueId)).for("update");
      await tx.update(heartbeatRuns).set({ updatedAt: new Date() }).where(eq(heartbeatRuns.id, f.runId));
    });
    await Promise.race([locked, finalization]);
    const dispatch = vi.fn(async () => "one provider handoff");
    const gateInput = { spaceId: f.spaceId, runId: f.runId, reservationId: f.reservation.id,
      expectedStatus: "running" as const, recoveryLeaseOwner: f.owner, now: new Date(), dispatch };
    const recovery = boundary === "dispatch"
      ? createPostgresRunDispatchAdapter(db).dispatchResolvedInteractionIfCurrent(gateInput)
      : reserveRunBudget(db, f.spaceId, f.runId, null, {}, f.owner).then(reservation => {
          expect(reservation.reused).toBe(true);
          return createPostgresRunDispatchAdapter(db).dispatchResolvedInteractionIfCurrent({ ...gateInput, reservationId: reservation.id });
        });
    try {
      expect(await waitForBlockedForUpdate("native_run_finalizations")).toBe(true);
      allowFinalization();
      await finalization;
      const gate = await recovery;
      expect(gate.dispatched).toBe(true);
      if (gate.dispatched) expect(await gate.resultPromise).toBe("one provider handoff");
      expect(await createPostgresRunDispatchAdapter(db).dispatchResolvedInteractionIfCurrent(gateInput))
        .toMatchObject({ dispatched: false, admissionBlockReason: "Provider dispatch already admitted this reservation generation" });
      expect(dispatch).toHaveBeenCalledOnce();
    } finally {
      allowFinalization();
      await Promise.allSettled([finalization, recovery]);
    }
  });

  it.each(["expired", "replaced"] as const)("does not admit recovery under an %s coordinator owner", async ownership => {
    const f = await seedRecoveryAdmission();
    await db.update(nativeRunFinalizations).set(ownership === "expired"
      ? { leaseExpiresAt: new Date(Date.now() - 1) } : { leaseOwner: "another-owner" }).where(eq(nativeRunFinalizations.runId, f.runId));
    await expect(reserveRunBudget(db, f.spaceId, f.runId, null, {}, f.owner)).rejects.toThrow("Native recovery no longer owns provider dispatch");
    const dispatch = vi.fn(async () => undefined);
    await expect(createPostgresRunDispatchAdapter(db).dispatchResolvedInteractionIfCurrent({ spaceId: f.spaceId, runId: f.runId,
      reservationId: f.reservation.id, recoveryLeaseOwner: f.owner, expectedStatus: "running", now: new Date(), dispatch }))
      .rejects.toThrow("Native recovery no longer owns provider dispatch");
    expect(dispatch).not.toHaveBeenCalled();
  });

  // Staging run e892cf75: a controlled wait was saved, shutdown confirmation of the
  // retained execution was still pending, and the coordinator scheduled the
  // same run to settle it. Its own recovery action then cancelled that resume.
  it.each(["own-resume", "other-run", "no-resume-policy"] as const)(
    "lets a saved controlled wait settle on its own same-run resume (%s)", async mode => {
      const f = await seedRecoveryAdmission();
      const context = { issueId: f.issueId, mutation: "interaction", wakeReason: "issue_commented",
        interactionId: randomUUID(), interactionKind: "ask_user_questions", interactionStatus: "answered" };
      await db.update(heartbeatRuns).set({ contextSnapshot: context }).where(eq(heartbeatRuns.id, f.runId));
      await db.update(nativeRunFinalizations).set({ phase: "retryable_failure", attempt: 1,
        failureCode: "native_controlled_wait_settlement_pending" }).where(eq(nativeRunFinalizations.runId, f.runId));
      const resumedRunId = mode === "other-run" ? randomUUID() : f.runId;
      await db.insert(issueRecoveryActions).values({ spaceId: f.spaceId, sourceIssueId: f.issueId,
        kind: "active_run_watchdog", ownerType: "agent", ownerAgentId: f.agentId, returnOwnerAgentId: f.agentId,
        cause: "native_controlled_wait_settlement_pending", fingerprint: `controlled-wait:${f.runId}`,
        evidence: { runId: resumedRunId, sourceFailureCode: "native_controlled_wait_settlement_pending",
          recoveryMode: "exact_checkpoint_resume", coordinatorAttempt: 1, providerSessionEstablished: true },
        nextAction: "Resume the exact persisted native session on the same heartbeat run.",
        wakePolicy: mode === "no-resume-policy" ? null
          : { kind: "resume_native_run", runId: resumedRunId, notBefore: new Date().toISOString() },
        maxAttempts: 3, attemptCount: 1 });
      const dispatch = vi.fn(async () => "settled the saved controlled wait");
      const gate = await createPostgresRunDispatchAdapter(db).dispatchResolvedInteractionIfCurrent({ spaceId: f.spaceId,
        runId: f.runId, reservationId: f.reservation.id, recoveryLeaseOwner: f.owner, expectedStatus: "running",
        enforceContinuationOwnership: true, now: new Date(), dispatch });
      const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, f.runId));
      if (mode === "own-resume") {
        expect({ dispatched: gate.dispatched, status: run!.status, errorCode: run!.errorCode })
          .toEqual({ dispatched: true, status: "running", errorCode: null });
        if (gate.dispatched) expect(await gate.resultPromise).toBe("settled the saved controlled wait");
      } else {
        // Any other reconciliation hold on the task still stops this run.
        expect(gate).toMatchObject({ dispatched: false, cancellation: { outcome: "cancelled", errorCode: "execution_reconciliation_required" } });
        expect(dispatch).not.toHaveBeenCalled();
      }
    });

  it("rechecks recovery lease expiry after waiting for the issue lock", async () => {
    const f = await seedRecoveryAdmission();
    const expiresAt = new Date(Date.now() + 1_000);
    await db.update(nativeRunFinalizations).set({ leaseExpiresAt: expiresAt }).where(eq(nativeRunFinalizations.runId, f.runId));
    let signalLocked!: () => void, releaseIssue!: () => void;
    const locked = new Promise<void>(resolve => { signalLocked = resolve; });
    const release = new Promise<void>(resolve => { releaseIssue = resolve; });
    const holder = db.transaction(async tx => {
      await tx.select({ id: issues.id }).from(issues).where(eq(issues.id, f.issueId)).for("update");
      signalLocked();
      await release;
    });
    await Promise.race([locked, holder]);
    const dispatch = vi.fn(async () => undefined);
    const recovery = createPostgresRunDispatchAdapter(db).dispatchResolvedInteractionIfCurrent({ spaceId: f.spaceId,
      runId: f.runId, reservationId: f.reservation.id, recoveryLeaseOwner: f.owner, expectedStatus: "running", now: new Date(), dispatch });
    try {
      expect(await waitForBlockedForUpdate("issues")).toBe(true);
      await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now() + 10)));
      releaseIssue();
      expect(await recovery).toMatchObject({ dispatched: false, admissionBlockReason: "Native recovery no longer owns provider dispatch" });
      expect(dispatch).not.toHaveBeenCalled();
    } finally {
      releaseIssue();
      await Promise.allSettled([holder, recovery]);
    }
  });

  async function waitForBlockedForUpdate(tableName: string) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const [waiting] = await db.execute<{ waiting: boolean }>(sql`
        SELECT EXISTS (
          SELECT 1
          FROM pg_stat_activity
          WHERE state = 'active'
            AND wait_event_type = 'Lock'
            AND query ILIKE ${`%${tableName}%`}
            AND query ILIKE '%for update%'
        ) AS waiting
      `);
      if (waiting?.waiting) return true;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return false;
  }

  async function reassignIssueAndLockRunOnceAConcurrentWaiterBlocks(
    issueId: string,
    runId: string,
    newAssigneeAgentId: string,
  ) {
    let signalLocked!: () => void;
    const locked = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });
    const transaction = db.transaction(async (tx) => {
      await tx.select({ id: issues.id }).from(issues).where(eq(issues.id, issueId)).for("update");
      signalLocked();
      if (!(await waitForBlockedForUpdate("issues"))) {
        throw new Error("expected a concurrent `for update` waiter on issues");
      }
      // The production claim path locks issue -> wake -> run. Taking the run
      // lock here proves the semantic adapter follows the same ordering: if it
      // held run while waiting for issue, these two transactions would deadlock.
      await tx
        .select({ id: heartbeatRuns.id })
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, runId))
        .for("update");
      await tx
        .update(issues)
        .set({ assigneeAgentId: newAssigneeAgentId })
        .where(eq(issues.id, issueId));
    });
    // Await lock acquisition before starting the competing operation. Keep
    // completion separate so setup does not wait for that operation to finish.
    await Promise.race([locked, transaction]);
    return { done: transaction };
  }

  describe("evaluateScheduledRetryGate", () => {
    it("maps a disabled on-demand wake into a blocked scheduled-retry gate decision", async () => {
      const { spaceId, agentId } = await seedSpaceAndAgent();
      await db
        .update(agents)
        .set({ runtimeConfig: { heartbeat: { wakeOnDemand: false } } })
        .where(eq(agents.id, agentId));

      const adapter = createPostgresRunDispatchAdapter(db);
      const now = new Date();
      const runId = await seedRun({ spaceId, agentId });
      const result = await adapter.evaluateScheduledRetryGate({
        runId,
        spaceId,
        retryReasonOverride: "other",
        now,
      });

      expect(result).toMatchObject({
        allowed: false,
        errorCode: "heartbeat_wake_on_demand_disabled",
      });
    });

    it("maps an active subtree pause hold into a blocked scheduled-retry gate decision", async () => {
      const { spaceId, agentId } = await seedSpaceAndAgent();
      const issueId = randomUUID();
      await seedIssue({ spaceId, issueId, status: "in_progress", assigneeAgentId: agentId });
      await db.insert(issueTreeHolds).values({
        spaceId,
        rootIssueId: issueId,
        mode: "pause",
        status: "active",
        reason: "manual pause for review",
        releasePolicy: { strategy: "manual" },
      });

      const adapter = createPostgresRunDispatchAdapter(db);
      const now = new Date();
      const runId = await seedRun({ spaceId, agentId, contextSnapshot: { issueId } });
      const result = await adapter.evaluateScheduledRetryGate({
        runId,
        spaceId,
        retryReasonOverride: "other",
        now,
      });

      expect(result).toMatchObject({
        allowed: false,
        errorCode: "issue_paused",
      });
    });

    it("maps an unresolved dependency blocker into a blocked scheduled-retry gate decision", async () => {
      const { spaceId, agentId } = await seedSpaceAndAgent();
      const issueId = randomUUID();
      const blockerId = randomUUID();
      await seedIssue({ spaceId, issueId, status: "blocked", assigneeAgentId: agentId });
      await seedIssue({ spaceId, issueId: blockerId, status: "todo" });
      await db.insert(issueRelations).values({
        spaceId,
        issueId: blockerId,
        relatedIssueId: issueId,
        type: "blocks",
      });

      const adapter = createPostgresRunDispatchAdapter(db);
      const now = new Date();
      const runId = await seedRun({ spaceId, agentId, contextSnapshot: { issueId } });
      const result = await adapter.evaluateScheduledRetryGate({
        runId,
        spaceId,
        retryReasonOverride: "other",
        now,
      });

      expect(result).toMatchObject({
        allowed: false,
        errorCode: "issue_dependencies_blocked",
        details: { unresolvedBlockerIssueIds: [blockerId] },
      });
    });

    it("maps a changed review participant into a blocked scheduled-retry gate decision", async () => {
      const { spaceId, agentId } = await seedSpaceAndAgent();
      const reviewerAgentId = randomUUID();
      await seedAgent({ id: reviewerAgentId, spaceId, name: "ReviewerAgent", role: "qa" });
      const issueId = randomUUID();
      await seedIssue({
        spaceId,
        issueId,
        status: "in_review",
        assigneeAgentId: agentId,
        executionState: {
          status: "pending",
          currentStageId: randomUUID(),
          currentStageIndex: 0,
          currentStageType: "review",
          currentParticipant: { type: "agent", agentId: reviewerAgentId, userId: null },
          returnAssignee: { type: "agent", agentId, userId: null },
          reviewRequest: null,
          completedStageIds: [],
          lastDecisionId: null,
          lastDecisionOutcome: null,
        },
      });

      const adapter = createPostgresRunDispatchAdapter(db);
      const now = new Date();
      const runId = await seedRun({ spaceId, agentId, contextSnapshot: { issueId } });
      const result = await adapter.evaluateScheduledRetryGate({
        runId,
        spaceId,
        retryReasonOverride: "other",
        now,
      });

      expect(result).toMatchObject({
        allowed: false,
        errorCode: "issue_review_participant_changed",
      });
    });

    it("maps a terminal issue status into a blocked scheduled-retry gate decision", async () => {
      const { spaceId, agentId } = await seedSpaceAndAgent();
      const issueId = randomUUID();
      await seedIssue({ spaceId, issueId, status: "done", assigneeAgentId: agentId });

      const adapter = createPostgresRunDispatchAdapter(db);
      const now = new Date();
      const runId = await seedRun({ spaceId, agentId, contextSnapshot: { issueId } });
      const result = await adapter.evaluateScheduledRetryGate({
        runId,
        spaceId,
        retryReasonOverride: "other",
        now,
      });

      expect(result).toMatchObject({
        allowed: false,
        errorCode: "issue_terminal_status",
      });
    });
  });

  describe("cancelStaleQueuedRun", () => {
    it.each([
      { label: "chat source", source: "chat:slack", expected: "chat:slack" },
      {
        label: "native status source",
        source: "native_status_decision",
        expected: "native_status_decision",
      },
      { label: "absent source", source: undefined, expected: null },
      { label: "null source", source: null, expected: null },
      { label: "blank source", source: "   ", expected: null },
      { label: "numeric source", source: 42, expected: null },
      { label: "object source", source: { type: "chat:slack" }, expected: null },
      { label: "array source", source: ["chat:slack"], expected: null },
    ])("projects only the committed $label into a cancellation effect", async ({ source, expected }) => {
      const { spaceId, agentId } = await seedSpaceAndAgent();
      const issueId = randomUUID();
      await seedIssue({ spaceId, issueId, status: "done", assigneeAgentId: agentId });
      const runId = await seedRun({
        spaceId,
        agentId,
        contextSnapshot: {
          issueId,
          wakeReason: "issue_assigned",
          ...(source === undefined ? {} : { source }),
          outpostWake: { privateTestMarker: "not-for-the-status-effect" },
        },
      });
      const outcome = await createPostgresRunDispatchAdapter(db).cancelStaleQueuedRun({
        runId,
        spaceId,
        expectedStatus: "queued",
        now: new Date(),
      });

      expect(outcome.outcome).toBe("cancelled");
      if (outcome.outcome !== "cancelled") throw new Error("expected stale run cancellation");
      expect(outcome.postCommitEffects).toHaveLength(1);
      const effect = outcome.postCommitEffects[0];
      expect(effect).toMatchObject({
        kind: "run_status_published",
        spaceId,
        runId,
        agentId,
        issueId,
        status: "cancelled",
        previousStatus: "queued",
        errorCode: "issue_terminal_status",
        contextSource: expected,
      });
      expect(effect).not.toHaveProperty("contextSnapshot");
      expect(JSON.stringify(effect)).not.toContain("not-for-the-status-effect");
      const persisted = await db
        .select({ status: heartbeatRuns.status, contextSnapshot: heartbeatRuns.contextSnapshot })
        .from(heartbeatRuns)
        .where(eq(heartbeatRuns.id, runId))
        .then((rows) => rows[0]);
      expect(persisted?.status).toBe("cancelled");
      expect(persisted?.contextSnapshot).toMatchObject({
        outpostWake: { privateTestMarker: "not-for-the-status-effect" },
      });
    });

    it("maps a reassigned issue into a stale queued-run decision", async () => {
      const { spaceId, agentId } = await seedSpaceAndAgent();
      const replacementAgentId = randomUUID();
      await seedAgent({ id: replacementAgentId, spaceId, name: "ReplacementCoder" });
      const issueId = randomUUID();
      await seedIssue({ spaceId, issueId, status: "in_progress", assigneeAgentId: replacementAgentId });

      const adapter = createPostgresRunDispatchAdapter(db);
      const now = new Date();
      const runId = await seedRun({
        spaceId,
        agentId,
        contextSnapshot: { issueId, wakeReason: "issue_assigned" },
      });
      const result = await adapter.cancelStaleQueuedRun({
        runId,
        spaceId,
        expectedStatus: "queued",
        now,
      });

      expect(result).toMatchObject({
        outcome: "cancelled",
        errorCode: "issue_assignee_changed",
      });
    });

    it(
      "reads the locked issue state and cancels in the same semantic transaction",
      async () => {
        const { spaceId, agentId } = await seedSpaceAndAgent();
        const replacementAgentId = randomUUID();
        await seedAgent({ id: replacementAgentId, spaceId, name: "ReplacementCoder" });
        const issueId = randomUUID();
        await seedIssue({ spaceId, issueId, status: "in_progress", assigneeAgentId: agentId });
        const runId = await seedRun({
          spaceId,
          agentId,
          contextSnapshot: { issueId, wakeReason: "issue_assigned" },
        });

        const { done: holderDone } = await reassignIssueAndLockRunOnceAConcurrentWaiterBlocks(
          issueId,
          runId,
          replacementAgentId,
        );
        const outcome = await createPostgresRunDispatchAdapter(db).cancelStaleQueuedRun({
          runId,
          spaceId,
          expectedStatus: "queued",
          now: new Date(),
        });
        await holderDone;

        expect(outcome).toMatchObject({
          outcome: "cancelled",
          errorCode: "issue_assignee_changed",
        });
        const persisted = await db
          .select({ status: heartbeatRuns.status })
          .from(heartbeatRuns)
          .where(eq(heartbeatRuns.id, runId))
          .then((rows) => rows[0]);
        expect(persisted?.status).toBe("cancelled");
      },
      15_000,
    );

    it("maps a review-parking continuation summary into a stale queued-run decision", async () => {
      const { spaceId, agentId } = await seedSpaceAndAgent();
      const issueId = randomUUID();
      await seedIssue({ spaceId, issueId, status: "in_progress", assigneeAgentId: agentId });
      await seedContinuationSummary({
        spaceId,
        issueId,
        agentId,
        body: [
          "# Continuation Summary",
          "",
          "## Next Action",
          "",
          "- Wait for reviewer feedback or approval before continuing executor work.",
        ].join("\n"),
      });

      const adapter = createPostgresRunDispatchAdapter(db);
      const now = new Date();
      const runId = await seedRun({
        spaceId,
        agentId,
        contextSnapshot: {
          issueId,
          wakeReason: "issue_continuation_needed",
          retryReason: "issue_continuation_needed",
        },
      });
      const result = await adapter.cancelStaleQueuedRun({
        runId,
        spaceId,
        expectedStatus: "queued",
        now,
      });

      expect(result).toMatchObject({
        outcome: "cancelled",
        errorCode: "issue_continuation_waiting_on_review",
      });
    });
  });

  describe("promoteOrCancelDueRetry", () => {
    async function seedScheduledRetryRun(input: {
      runId: string;
      spaceId: string;
      agentId: string;
      issueId: string;
      now: Date;
    }) {
      await db.insert(heartbeatRuns).values({
        id: input.runId,
        spaceId: input.spaceId,
        agentId: input.agentId,
        invocationSource: "retry",
        status: "scheduled_retry",
        scheduledRetryAttempt: 1,
        scheduledRetryAt: input.now,
        scheduledRetryReason: "max_turns_continuation",
        contextSnapshot: { issueId: input.issueId },
        updatedAt: input.now,
        createdAt: input.now,
      });
    }

    it("promotes an allowed due retry", async () => {
      const { spaceId, agentId } = await seedSpaceAndAgent();
      const issueId = randomUUID();
      const runId = randomUUID();
      const now = new Date();
      await seedIssue({ spaceId, issueId, status: "in_progress", assigneeAgentId: agentId });
      await seedScheduledRetryRun({ runId, spaceId, agentId, issueId, now });
      await db.update(issues).set({ executionRunId: runId }).where(eq(issues.id, issueId));

      const adapter = createPostgresRunDispatchAdapter(db);
      const outcome = await adapter.promoteOrCancelDueRetry({
        runId,
        spaceId,
        now,
      });

      expect(outcome.outcome).toBe("promoted");
      const [row] = await db.select({ status: heartbeatRuns.status }).from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
      expect(row?.status).toBe("queued");
    });

    it("cancels a due retry a pause hold blocks", async () => {
      const { spaceId, agentId } = await seedSpaceAndAgent();
      const issueId = randomUUID();
      const runId = randomUUID();
      const now = new Date();
      await seedIssue({ spaceId, issueId, status: "in_progress", assigneeAgentId: agentId });
      await db.insert(issueTreeHolds).values({
        spaceId,
        rootIssueId: issueId,
        mode: "pause",
        status: "active",
        reason: "manual pause for review",
        releasePolicy: { strategy: "manual" },
      });
      await seedScheduledRetryRun({ runId, spaceId, agentId, issueId, now });
      await db.update(issues).set({ executionRunId: runId }).where(eq(issues.id, issueId));

      const adapter = createPostgresRunDispatchAdapter(db);
      const outcome = await adapter.promoteOrCancelDueRetry({
        runId,
        spaceId,
        now,
      });

      expect(outcome.outcome).toBe("gate_suppressed");
      if (outcome.outcome === "gate_suppressed") {
        expect(outcome.errorCode).toBe("issue_paused");
      }
      const [row] = await db.select({ status: heartbeatRuns.status }).from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
      expect(row?.status).toBe("cancelled");
    });

    it(
      "locks the issue row for the whole decision, so a reassignment committed while it waits is not missed",
      async () => {
        const { spaceId, agentId: originalAgentId } = await seedSpaceAndAgent();
        const newAgentId = randomUUID();
        await seedAgent({ id: newAgentId, spaceId, name: "ReplacementCoder" });
        const issueId = randomUUID();
        const runId = randomUUID();
        const now = new Date();
        await seedIssue({ spaceId, issueId, status: "in_progress", assigneeAgentId: originalAgentId });
        await seedScheduledRetryRun({ runId, spaceId, agentId: originalAgentId, issueId, now });
        await db.update(issues).set({ executionRunId: runId }).where(eq(issues.id, issueId));

        // Acquire the issue row lock first and hold it until it observes a
        // concurrent `for update` waiter — the promote call below — proving
        // this is a real block, not a race the assertion got lucky on.
        const { done: holderDone } = await reassignIssueAndLockRunOnceAConcurrentWaiterBlocks(
          issueId,
          runId,
          newAgentId,
        );

        const adapter = createPostgresRunDispatchAdapter(db);
        const outcome = await adapter.promoteOrCancelDueRetry({
          runId,
          spaceId,
          now,
        });
        await holderDone;

        // Without the lock, this call would have read the ORIGINAL assignee
        // (captured before the concurrent reassignment committed) and
        // promoted the run. With the lock, it waits for the reassignment to
        // commit, then reads the NEW assignee and cancels instead.
        expect(outcome.outcome).toBe("gate_suppressed");
        if (outcome.outcome === "gate_suppressed") {
          expect(outcome.errorCode).toBe("issue_reassigned");
        }
        const [row] = await db.select({ status: heartbeatRuns.status }).from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
        expect(row?.status).toBe("cancelled");
      },
      15_000,
    );
  });
  it.each(["active", "resolved"])("blocks a generic retry after %s no-replay disposition", async status => {
    const { spaceId, agentId } = await seedSpaceAndAgent();
    const issueId = randomUUID(), runId = randomUUID();
    await db.insert(issues).values({ id: issueId, spaceId, title: "Uncertain email", status: "in_progress", assigneeAgentId: agentId });
    await db.insert(heartbeatRuns).values({ id: runId, spaceId, agentId, status: "queued", contextSnapshot: { issueId, wakeReason: "retry_failed_run" } });
    await db.insert(issueRecoveryActions).values({ spaceId, sourceIssueId: issueId, kind: "active_run_watchdog", ownerType: "operator", cause: "uncertain_external_action", status, evidence: status === "resolved" ? { automaticRecovery: { replay: "blocked" } } : {}, fingerprint: runId, nextAction: "Verify whether email-1 was sent before continuing." });
    expect(await getExecutionBlocker(db, spaceId, issueId)).toMatchObject({ cause: "uncertain_external_action", nextAction: "Verify whether email-1 was sent before continuing." });
    expect(await getExecutionBlocker(db, randomUUID(), issueId)).toBeNull();
    const adapter = createPostgresRunDispatchAdapter(db);
    await expect(adapter.cancelStaleQueuedRun({ spaceId, runId, expectedStatus: "queued", now: new Date() })).resolves.toMatchObject({ outcome: "cancelled", errorCode: "execution_reconciliation_required" });
  });

  it.each(["active", "resolved"])("allows a new message through a historical %s interruption hold", async status => {
    const { spaceId, agentId } = await seedSpaceAndAgent();
    await db.update(agents).set({ adapterType: "process" }).where(eq(agents.id, agentId));
    const issueId = randomUUID(), previousRunId = randomUUID(), runId = randomUUID();
    await seedIssue({ spaceId, issueId, status: "blocked", assigneeAgentId: agentId });
    await db.insert(heartbeatRuns).values([
      { id: previousRunId, spaceId, agentId, status: "interrupted", errorCode: "server_shutdown_interrupted", contextSnapshot: { issueId } },
      { id: runId, spaceId, agentId, status: "queued", contextSnapshot: { issueId, wakeReason: "issue_commented" } },
    ]);
    await db.insert(heartbeatRunEvents).values({ spaceId, agentId, runId: previousRunId,
      seq: 1, eventType: "adapter.invoke", payload: { adapterType: "codex_local" } });
    const [action] = await db.insert(issueRecoveryActions).values({ spaceId, sourceIssueId: issueId,
      kind: "active_run_watchdog", ownerType: "operator", cause: "legacy_execution_requires_reconciliation", status,
      evidence: { runId: previousRunId, automaticRecovery: { replay: "blocked", actionOutcome: "unknown" } },
      fingerprint: previousRunId, nextAction: "Automatic recovery stopped.",
    }).returning();
    expect(await getExecutionBlocker(db, spaceId, issueId)).toBeNull();
    const adapter = createPostgresRunDispatchAdapter(db);
    expect(await adapter.cancelStaleQueuedRun({ spaceId, runId, expectedStatus: "queued", now: new Date() })).toMatchObject({ outcome: "not_stale" });
    await settleUnrecoverableExecutions(db);
    const [resolved] = await db.select().from(issueRecoveryActions).where(eq(issueRecoveryActions.id, action!.id));
    expect(resolved).toMatchObject({ status: "resolved", outcome: "cancelled", evidence: { runId: previousRunId } });
    expect(resolved.evidence.automaticRecovery).toMatchObject({ replay: "conversation_continuation", actionOutcome: "unknown" });
    await settleUnrecoverableExecutions(db);
    const audit = await db.select().from(activityLog).where(eq(activityLog.entityId, issueId));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ spaceId, action: "issue.execution_recovery_settled" });
    expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.retryOfRunId, previousRunId))).toHaveLength(0);
    // The upgrade does not silently resume historical blocked work.
    expect((await db.select().from(issues).where(eq(issues.id, issueId)))[0].status).toBe("blocked");
  });

  it.each(["process", "http", null])("keeps a historical %s hold after switching to a conversation adapter", async historicalAdapter => {
    const { spaceId, agentId } = await seedSpaceAndAgent();
    await db.update(agents).set({ adapterType: "codex_local" }).where(eq(agents.id, agentId));
    const issueId = randomUUID(), previousRunId = randomUUID();
    await seedIssue({ spaceId, issueId, status: "blocked", assigneeAgentId: agentId });
    await db.insert(heartbeatRuns).values({ id: previousRunId, spaceId, agentId,
      status: "interrupted", errorCode: "server_shutdown_interrupted", contextSnapshot: { issueId } });
    if (historicalAdapter) await db.insert(heartbeatRunEvents).values({ spaceId, agentId, runId: previousRunId,
      seq: 1, eventType: "adapter.invoke", payload: { adapterType: historicalAdapter } });
    const [action] = await db.insert(issueRecoveryActions).values({ spaceId, sourceIssueId: issueId,
      kind: "active_run_watchdog", ownerType: "operator", cause: "legacy_execution_requires_reconciliation", status: "active",
      evidence: { runId: previousRunId, automaticRecovery: { replay: "blocked", actionOutcome: "unknown" } },
      fingerprint: previousRunId, nextAction: "Inspect previous execution.",
    }).returning();
    expect(await getExecutionBlocker(db, spaceId, issueId)).toMatchObject({ recoveryActionId: action!.id });
    await settleUnrecoverableExecutions(db);
    expect(await getExecutionBlocker(db, spaceId, issueId)).toMatchObject({ recoveryActionId: action!.id });
    const [retained] = await db.select().from(issueRecoveryActions).where(eq(issueRecoveryActions.id, action!.id));
    expect(retained.evidence.automaticRecovery).toMatchObject({ replay: "blocked", actionOutcome: "unknown" });
  });

  it("links the stopped run's agent instead of its return owner, within the same space", async () => {
    const { spaceId, agentId: ownerId } = await seedSpaceAndAgent();
    const reviewerId = randomUUID(), issueId = randomUUID(), runId = randomUUID();
    await seedAgent({ id: reviewerId, spaceId, name: "Reviewer" });
    await seedIssue({ spaceId, issueId, status: "in_review", assigneeAgentId: ownerId });
    await db.insert(heartbeatRuns).values({ id: runId, spaceId, agentId: reviewerId, status: "cancelled" });
    const [action] = await db.insert(issueRecoveryActions).values({
      spaceId, sourceIssueId: issueId, kind: "active_run_watchdog", ownerType: "operator",
      returnOwnerAgentId: ownerId, cause: "legacy_execution_requires_reconciliation", status: "active",
      evidence: { runId }, fingerprint: runId, nextAction: "Inspect the stopped reviewer.",
    }).returning();
    expect(await getExecutionBlocker(db, spaceId, issueId)).toMatchObject({ runId, agentId: reviewerId });
    const other = await seedSpaceAndAgent();
    const otherRunId = randomUUID();
    await db.insert(heartbeatRuns).values({ id: otherRunId, spaceId: other.spaceId, agentId: other.agentId, status: "cancelled" });
    await db.update(issueRecoveryActions).set({ evidence: { runId: otherRunId } }).where(eq(issueRecoveryActions.id, action!.id));
    expect(await getExecutionBlocker(db, spaceId, issueId)).toMatchObject({ agentId: null });
    await db.update(issueRecoveryActions).set({ evidence: { runId: "invalid" } }).where(eq(issueRecoveryActions.id, action!.id));
    expect(await getExecutionBlocker(db, spaceId, issueId)).toMatchObject({ runId: null, agentId: null });
  });

});
