import { resolveExternalTestDatabaseUrl } from "./helpers/external-test-database.js";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agents,
  agentWakeupRequests,
  spaces,
  createDb,
  environmentLeases,
  heartbeatRunEvents,
  heartbeatRunWatchdogDecisions,
  heartbeatRuns,
  issueComments,
  issueRecoveryActions,
  issueRelations,
  issues,
  workspaceOperations,
} from "@outpost/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { truncateTablesWithDeadlockRetry } from "./helpers/truncate-with-deadlock-retry.js";
import { appendHeartbeatRunEvent } from "../services/heartbeat-run-events.js";
import { createPostgresWatchdogAdapter } from "../modules/active-run-watchdog/adapters/postgres.js";
import {
  ACTIVE_RUN_OUTPUT_CONTINUE_REARM_MS,
  ACTIVE_RUN_OUTPUT_CRITICAL_THRESHOLD_MS,
  ACTIVE_RUN_OUTPUT_SUSPICION_THRESHOLD_MS,
  recoveryService,
} from "../services/recovery/service.js";

vi.mock("../services/heartbeat-run-events.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/heartbeat-run-events.js")>();
  return { ...actual, appendHeartbeatRunEvent: vi.fn(actual.appendHeartbeatRunEvent) };
});

const mockedAppendHeartbeatRunEvent = vi.mocked(appendHeartbeatRunEvent);

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const external = resolveExternalTestDatabaseUrl("OUTPOST_OUTPUT_WATCHDOG_TEST_DATABASE_URL");
const describeEmbeddedPostgres = external || embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres active-run output watchdog tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("active-run output watchdog", () => {
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    if (!external) tempDb = await startEmbeddedPostgresTestDatabase("outpost-active-run-output-watchdog-");
    db = createDb(external ?? tempDb!.connectionString);
    if (external) await db.execute(sql`truncate spaces cascade`);
  }, 30_000);

  afterEach(async () => {
    mockedAppendHeartbeatRunEvent.mockClear();
    await truncateTablesWithDeadlockRetry(db, `TRUNCATE TABLE "spaces" CASCADE`, {
      attempts: 5,
      delayMs: (attempt) => 50 * (attempt + 1),
    });
  });

  afterAll(async () => {
    await db?.$client.end({ timeout: 1 });
    await tempDb?.cleanup();
  });

  async function seedRunningRun(opts: {
    now: Date;
    ageMs: number;
    withOutput?: boolean;
    sourceStatus?: "in_progress" | "blocked" | "done" | "cancelled";
    sourceOriginKind?: string;
    sameRunTerminalEvidence?: boolean;
  }) {
    const spaceId = randomUUID();
    const managerId = randomUUID();
    const coderId = randomUUID();
    const issueId = randomUUID();
    const runId = randomUUID();
    const issuePrefix = `W${spaceId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
    const startedAt = new Date(opts.now.getTime() - opts.ageMs);
    const lastOutputAt = opts.withOutput ? new Date(opts.now.getTime() - 5 * 60 * 1000) : null;
    const sourceStatus = opts.sourceStatus ?? "in_progress";
    const terminalEvidenceAt = new Date(startedAt.getTime() + 10 * 60 * 1000);

    await db.insert(spaces).values({
      id: spaceId,
      name: "Watchdog Co",
      issuePrefix,
      defaultResponsibleUserId: "responsible-user",
      requireOperatorApprovalForNewAgents: false,
    });
    await db.insert(agents).values([
      {
        id: managerId,
        spaceId,
        name: "Engineering Lead",
        role: "engineering_lead",
        status: "idle",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: coderId,
        spaceId,
        name: "Coder",
        role: "engineer",
        status: "running",
        reportsTo: managerId,
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);
    await db.insert(issues).values({
      id: issueId,
      spaceId,
      title: "Long running implementation",
      status: sourceStatus,
      priority: "medium",
      assigneeAgentId: coderId,
      issueNumber: 1,
      identifier: `${issuePrefix}-1`,
      originKind: opts.sourceOriginKind ?? "manual",
      completedAt: sourceStatus === "done" ? terminalEvidenceAt : null,
      cancelledAt: sourceStatus === "cancelled" ? terminalEvidenceAt : null,
      updatedAt: startedAt,
      createdAt: startedAt,
    });
    await db.insert(heartbeatRuns).values({
      id: runId,
      spaceId,
      agentId: coderId,
      status: "running",
      invocationSource: "assignment",
      triggerDetail: "system",
      startedAt,
      processStartedAt: startedAt,
      lastOutputAt,
      lastOutputSeq: opts.withOutput ? 3 : 0,
      lastOutputStream: opts.withOutput ? "stdout" : null,
      contextSnapshot: { issueId },
      logBytes: 0,
    });
    await db.update(issues).set({ executionRunId: runId }).where(eq(issues.id, issueId));

    if (opts.sameRunTerminalEvidence) {
      await db.insert(activityLog).values({
        spaceId,
        actorType: "agent",
        actorId: coderId,
        agentId: coderId,
        runId,
        action: "issue.updated",
        entityType: "issue",
        entityId: issueId,
        details: {
          identifier: `${issuePrefix}-1`,
          status: sourceStatus,
          _previous: { status: "in_progress" },
        },
        createdAt: terminalEvidenceAt,
      });
    }

    return { spaceId, managerId, coderId, issueId, runId, issuePrefix, startedAt };
  }

  function createRecovery() {
    const enqueueWakeup = vi.fn();
    return { enqueueWakeup, recovery: recoveryService(db, { enqueueWakeup }) };
  }

  async function buildSummary(runId: string, now: Date) {
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, runId));
    if (!run) throw new Error(`Missing test run ${runId}`);
    return recoveryService(db, { enqueueWakeup: vi.fn() }).buildRunOutputSilence(run, now);
  }

  async function expectNoReviewArtifacts(input: {
    spaceId: string;
    issueId: string;
    coderId: string;
    managerId: string;
  }) {
    const [evaluations, comments, relations, actions, wakes, source, coder, manager] = await Promise.all([
      db.select().from(issues).where(and(
        eq(issues.spaceId, input.spaceId),
        eq(issues.originKind, "stale_active_run_evaluation"),
      )),
      db.select().from(issueComments).where(eq(issueComments.issueId, input.issueId)),
      db.select().from(issueRelations).where(eq(issueRelations.spaceId, input.spaceId)),
      db.select().from(issueRecoveryActions).where(eq(issueRecoveryActions.spaceId, input.spaceId)),
      db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.spaceId, input.spaceId)),
      db.select().from(issues).where(eq(issues.id, input.issueId)).then((rows) => rows[0]),
      db.select().from(agents).where(eq(agents.id, input.coderId)).then((rows) => rows[0]),
      db.select().from(agents).where(eq(agents.id, input.managerId)).then((rows) => rows[0]),
    ]);

    expect(evaluations).toHaveLength(0);
    expect(comments).toHaveLength(0);
    expect(relations).toHaveLength(0);
    expect(actions).toHaveLength(0);
    expect(wakes).toHaveLength(0);
    expect(source?.assigneeAgentId).toBe(input.coderId);
    expect(coder?.status).toBe("running");
    expect(manager?.status).toBe("idle");
  }

  it("warns after five silent minutes and escalates after fifteen without changing active work", async () => {
    const now = new Date("2026-04-22T20:00:00.000Z");
    const seeded = await seedRunningRun({ now, ageMs: 0 });
    const summaryAt = (elapsedMs: number) => buildSummary(seeded.runId, new Date(now.getTime() + elapsedMs));
    await expect(summaryAt(5 * 60_000 - 1)).resolves.toMatchObject({ level: "ok" });
    await expect(summaryAt(5 * 60_000)).resolves.toMatchObject({ level: "suspicious" });
    await expect(summaryAt(15 * 60_000 - 1)).resolves.toMatchObject({ level: "suspicious" });
    await expect(summaryAt(15 * 60_000)).resolves.toMatchObject({ level: "critical" });
    const { recovery, enqueueWakeup } = createRecovery();
    await recovery.scanSilentActiveRuns({ now: new Date(now.getTime() + 35 * 60_000), spaceId: seeded.spaceId });
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
    expect(run?.status).toBe("running");
    expect(enqueueWakeup).not.toHaveBeenCalled();
    await expectNoReviewArtifacts(seeded);

    // Fresh output clears the warning even on a long-running task.
    await db.update(heartbeatRuns).set({ lastOutputAt: new Date(now.getTime() + 35 * 60_000) })
      .where(eq(heartbeatRuns.id, seeded.runId));
    await expect(summaryAt(36 * 60_000)).resolves.toMatchObject({ level: "ok" });
  });

  it.each(["stale_active_run_evaluation", "issue_productivity_review"])("keeps blocked and %s sources artifact-free", async (originKind) => {
    const now = new Date("2026-04-22T20:00:00.000Z");
    const blocked = await seedRunningRun({
      now,
      ageMs: ACTIVE_RUN_OUTPUT_CRITICAL_THRESHOLD_MS + 60_000,
      sourceStatus: "blocked",
    });
    const recursive = await seedRunningRun({
      now,
      ageMs: ACTIVE_RUN_OUTPUT_CRITICAL_THRESHOLD_MS + 60_000,
      sourceOriginKind: originKind,
    });
    const { enqueueWakeup, recovery } = createRecovery();

    await expect(recovery.scanSilentActiveRuns({ now, spaceId: blocked.spaceId }))
      .resolves.toMatchObject({ created: 0, skipped: 1 });
    await expect(recovery.scanSilentActiveRuns({ now, spaceId: recursive.spaceId }))
      .resolves.toMatchObject({ created: 0, skipped: 1 });
    await expectNoReviewArtifacts(blocked);

    const recursiveIssues = await db.select().from(issues).where(eq(issues.spaceId, recursive.spaceId));
    expect(recursiveIssues).toHaveLength(1);
    expect(recursiveIssues[0]?.id).toBe(recursive.issueId);
    expect(await db.select().from(issueComments).where(eq(issueComments.issueId, recursive.issueId))).toHaveLength(0);
    expect(await db.select().from(issueRecoveryActions).where(eq(issueRecoveryActions.spaceId, recursive.spaceId))).toHaveLength(0);
    expect(await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.spaceId, recursive.spaceId))).toHaveLength(0);
    expect(enqueueWakeup).not.toHaveBeenCalled();
  });

  it("scopes candidates, readers, and writers to one space", async () => {
    const now = new Date("2026-04-22T20:00:00.000Z");
    const spaceA = await seedRunningRun({ now, ageMs: ACTIVE_RUN_OUTPUT_CRITICAL_THRESHOLD_MS + 60_000 });
    const spaceB = await seedRunningRun({ now, ageMs: ACTIVE_RUN_OUTPUT_CRITICAL_THRESHOLD_MS + 60_000 });
    const healthyRunId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: healthyRunId,
      spaceId: spaceA.spaceId,
      agentId: spaceA.coderId,
      status: "running",
      invocationSource: "assignment",
      triggerDetail: "system",
      startedAt: now,
      processStartedAt: now,
      lastOutputAt: now,
      lastOutputSeq: 1,
      lastOutputStream: "stdout",
      contextSnapshot: {},
      logBytes: 0,
    });
    const { recovery } = createRecovery();

    const result = await recovery.scanSilentActiveRuns({ now, spaceId: spaceA.spaceId });

    // The space filter, the SQL timestamp expression, and the healthy-run
    // exclusion together keep the scan to the one silent run in space A.
    expect(result.scanned).toBe(1);

    const evaluationIssueIdInSpaceB = randomUUID();
    await db.insert(issues).values({
      id: evaluationIssueIdInSpaceB,
      spaceId: spaceB.spaceId,
      title: "Evaluation issue in the other space",
      status: "todo",
      priority: "medium",
      assigneeAgentId: spaceB.managerId,
      issueNumber: 2,
      identifier: `${spaceB.issuePrefix}-2`,
      originKind: "stale_active_run_evaluation",
      originId: spaceB.runId,
      originRunId: spaceB.runId,
      originFingerprint: `stale_active_run:${spaceB.spaceId}:${spaceB.runId}`,
    });

    await expect(recovery.recordWatchdogDecision({
      runId: spaceA.runId,
      actor: { type: "agent", agentId: spaceA.managerId },
      decision: "continue",
      evaluationIssueId: evaluationIssueIdInSpaceB,
      reason: "Cross-space evaluation issue must be rejected",
      now,
    })).rejects.toMatchObject({ status: 404 });

    await expect(recovery.recordWatchdogDecision({
      runId: spaceA.runId,
      actor: { type: "operator" },
      decision: "continue",
      reason: "Cross-space createdByRunId must be rejected",
      createdByRunId: spaceB.runId,
      now,
    })).rejects.toMatchObject({ status: 403 });
  });

  it("leaves no partial state when the fold transaction fails", async () => {
    const now = new Date("2026-04-22T20:00:00.000Z");
    const seeded = await seedRunningRun({
      now,
      ageMs: ACTIVE_RUN_OUTPUT_CRITICAL_THRESHOLD_MS + 60_000,
      sourceStatus: "done",
      sameRunTerminalEvidence: true,
    });
    const evaluationIssueId = randomUUID();
    await db.insert(issues).values({
      id: evaluationIssueId,
      spaceId: seeded.spaceId,
      title: "Existing stale evaluation",
      status: "todo",
      priority: "high",
      assigneeAgentId: seeded.managerId,
      issueNumber: 2,
      identifier: `${seeded.issuePrefix}-2`,
      originKind: "stale_active_run_evaluation",
      originId: seeded.runId,
      originRunId: seeded.runId,
      originFingerprint: `stale_active_run:${seeded.spaceId}:${seeded.runId}`,
    });
    await db.insert(issueRecoveryActions).values({
      spaceId: seeded.spaceId,
      sourceIssueId: seeded.issueId,
      recoveryIssueId: evaluationIssueId,
      kind: "active_run_watchdog",
      status: "active",
      ownerType: "agent",
      ownerAgentId: seeded.managerId,
      cause: "active_run_watchdog",
      fingerprint: `active-run-watchdog:${seeded.spaceId}:${seeded.runId}:${seeded.issueId}`,
      evidence: { runId: seeded.runId },
      nextAction: "Review stale active run",
    });
    const { recovery } = createRecovery();
    mockedAppendHeartbeatRunEvent.mockRejectedValueOnce(new Error("injected fold transaction fault"));

    await expect(recovery.scanSilentActiveRuns({ now, spaceId: seeded.spaceId }))
      .rejects.toThrow("injected fold transaction fault");

    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
    expect(run?.status).toBe("running");
    expect(await db.select().from(heartbeatRunWatchdogDecisions).where(eq(
      heartbeatRunWatchdogDecisions.runId,
      seeded.runId,
    ))).toHaveLength(0);
    expect(await db.select().from(heartbeatRunEvents).where(eq(heartbeatRunEvents.runId, seeded.runId))).toHaveLength(0);
    // The seed itself planted one activity-log row as the fake same-run
    // terminal evidence; the fold must not add a second one.
    expect(await db.select().from(activityLog).where(eq(activityLog.runId, seeded.runId))).toHaveLength(1);
    const [source] = await db.select().from(issues).where(eq(issues.id, seeded.issueId));
    const [evaluation] = await db.select().from(issues).where(eq(issues.id, evaluationIssueId));
    const [action] = await db
      .select()
      .from(issueRecoveryActions)
      .where(eq(issueRecoveryActions.sourceIssueId, seeded.issueId));
    expect(source?.executionRunId).toBe(seeded.runId);
    expect(evaluation?.status).toBe("todo");
    expect(await db.select().from(issueComments).where(eq(issueComments.issueId, evaluationIssueId))).toHaveLength(0);
    expect(action).toMatchObject({ status: "active", outcome: null });
    const [agent] = await db.select().from(agents).where(eq(agents.id, seeded.coderId));
    expect(agent?.status).toBe("running");
  });


  it("folds a terminal source with same-run evidence without creating review work", async () => {
    const now = new Date("2026-04-22T20:00:00.000Z");
    const seeded = await seedRunningRun({
      now,
      ageMs: ACTIVE_RUN_OUTPUT_CRITICAL_THRESHOLD_MS + 60_000,
      sourceStatus: "done",
      sameRunTerminalEvidence: true,
    });
    const { enqueueWakeup, recovery } = createRecovery();

    const result = await recovery.scanSilentActiveRuns({ now, spaceId: seeded.spaceId });
    expect(result).toMatchObject({ created: 0, folded: 1, skipped: 0 });
    expect(enqueueWakeup).not.toHaveBeenCalled();

    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
    const [source] = await db.select().from(issues).where(eq(issues.id, seeded.issueId));
    const [agent] = await db.select().from(agents).where(eq(agents.id, seeded.coderId));
    expect(run?.status).toBe("succeeded");
    expect(run?.resultJson).toMatchObject({
      sourceResolvedWatchdogFold: {
        sourceIssueId: seeded.issueId,
        sourceIssueStatus: "done",
        evaluationIssueId: null,
        cleanup: { outcome: "no_process_metadata" },
      },
    });
    expect(source?.executionRunId).toBeNull();
    expect(agent?.status).toBe("idle");
    expect(await db.select().from(issues).where(and(
      eq(issues.spaceId, seeded.spaceId),
      eq(issues.originKind, "stale_active_run_evaluation"),
    ))).toHaveLength(0);
    expect(await db.select().from(issueRecoveryActions).where(eq(issueRecoveryActions.spaceId, seeded.spaceId))).toHaveLength(0);
  });

  it("does not fold or create review work for a terminal source without same-run evidence", async () => {
    const now = new Date("2026-04-22T20:00:00.000Z");
    const seeded = await seedRunningRun({
      now,
      ageMs: ACTIVE_RUN_OUTPUT_CRITICAL_THRESHOLD_MS + 60_000,
      sourceStatus: "done",
    });
    const { enqueueWakeup, recovery } = createRecovery();

    await expect(recovery.scanSilentActiveRuns({ now, spaceId: seeded.spaceId }))
      .resolves.toMatchObject({ created: 0, folded: 0, skipped: 1 });
    const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
    expect(run?.status).toBe("running");
    expect(enqueueWakeup).not.toHaveBeenCalled();
    expect(await db.select().from(issues).where(and(
      eq(issues.spaceId, seeded.spaceId),
      eq(issues.originKind, "stale_active_run_evaluation"),
    ))).toHaveLength(0);
  });

  it.each(["remote_lease", "workspace_finalize", "failed_finalize", "native_owner", "restore_failed"])(
    "leaves a terminal task's run with its lifecycle owner while %s is unsettled",
    async pending => {
      const now = new Date("2026-04-22T20:00:00.000Z");
      const seeded = await seedRunningRun({ now, ageMs: ACTIVE_RUN_OUTPUT_CRITICAL_THRESHOLD_MS + 60_000,
        sourceStatus: "done", sameRunTerminalEvidence: true });
      if (pending === "remote_lease") {
        await db.insert(environmentLeases).values({ spaceId: seeded.spaceId, heartbeatRunId: seeded.runId,
          issueId: seeded.issueId, status: "active", provider: "daytona", providerLeaseId: "sandbox-with-unsaved-files" });
      } else if (pending === "workspace_finalize" || pending === "failed_finalize") {
        await db.insert(workspaceOperations).values({ spaceId: seeded.spaceId, heartbeatRunId: seeded.runId,
          issueId: seeded.issueId, phase: "workspace_finalize", status: pending === "failed_finalize" ? "failed" : "running" });
      } else if (pending === "native_owner") {
        await db.update(heartbeatRuns).set({ runtimeMode: "native" }).where(eq(heartbeatRuns.id, seeded.runId));
      } else {
        await db.update(heartbeatRuns).set({ resultJson: { workspaceRestoreFailure: "restore_failed" } })
          .where(eq(heartbeatRuns.id, seeded.runId));
      }
      const { recovery, enqueueWakeup } = createRecovery();
      expect(await recovery.scanSilentActiveRuns({ now, spaceId: seeded.spaceId }))
        .toMatchObject({ folded: 0, created: 0, skipped: 1 });
      const [run] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
      const [task] = await db.select().from(issues).where(eq(issues.id, seeded.issueId));
      const [agent] = await db.select().from(agents).where(eq(agents.id, seeded.coderId));
      expect(run.status).toBe("running");
      expect(task).toMatchObject({ status: "done", executionRunId: seeded.runId });
      expect(agent.status).toBe("running");
      expect(enqueueWakeup).not.toHaveBeenCalled();
      expect(await db.select().from(heartbeatRunWatchdogDecisions).where(eq(heartbeatRunWatchdogDecisions.runId, seeded.runId)))
        .toHaveLength(0);
    },
  );

  it("folds stale bookkeeping after remote release and successful workspace finalization", async () => {
    const now = new Date("2026-04-22T20:00:00.000Z");
    const seeded = await seedRunningRun({ now, ageMs: ACTIVE_RUN_OUTPUT_CRITICAL_THRESHOLD_MS + 60_000,
      sourceStatus: "done", sameRunTerminalEvidence: true });
    await db.insert(environmentLeases).values({ spaceId: seeded.spaceId, heartbeatRunId: seeded.runId,
      issueId: seeded.issueId, status: "released", releasedAt: now, cleanupStatus: "success",
      provider: "daytona", providerLeaseId: "finished-sandbox" });
    await db.insert(workspaceOperations).values({ spaceId: seeded.spaceId, heartbeatRunId: seeded.runId,
      issueId: seeded.issueId, phase: "workspace_finalize", status: "succeeded", finishedAt: now });
    expect(await createRecovery().recovery.scanSilentActiveRuns({ now, spaceId: seeded.spaceId }))
      .toMatchObject({ folded: 1, created: 0 });
  });

  it("rechecks remote ownership when a lease appears after the initial fold check", async () => {
    const now = new Date("2026-04-22T20:00:00.000Z");
    const seeded = await seedRunningRun({ now, ageMs: ACTIVE_RUN_OUTPUT_CRITICAL_THRESHOLD_MS + 60_000,
      sourceStatus: "done", sameRunTerminalEvidence: true });
    const adapter = createPostgresWatchdogAdapter(db);
    const run = await adapter.findRunForSpace(seeded.spaceId, seeded.runId);
    expect(await adapter.isRuntimeSettlementPending(seeded.spaceId, seeded.runId)).toBe(false);
    await db.insert(environmentLeases).values({ spaceId: seeded.spaceId, heartbeatRunId: seeded.runId,
      issueId: seeded.issueId, status: "active", provider: "daytona", providerLeaseId: "late-owned-sandbox" });
    expect(await adapter.foldSourceResolvedRun(seeded.spaceId, {
      run: run!, sourceIssue: { id: seeded.issueId, identifier: `${seeded.issuePrefix}-1`, status: "done",
        originKind: "manual", isRecoveryOriginKind: false },
      evidence: { kind: "activity", id: randomUUID(), action: "issue.updated", createdAt: now },
      existingEvaluation: null, silenceStartedAt: seeded.startedAt, silenceAgeMs: 16 * 60 * 1000,
      cleanup: { attempted: false, outcome: "no_process_metadata", adapterType: "grok_local" }, now,
    })).toEqual({ kind: "stale" });
    const [persisted] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, seeded.runId));
    expect(persisted.status).toBe("running");
    expect(persisted.resultJson).toBeNull();
    expect(await db.select().from(heartbeatRunWatchdogDecisions).where(eq(heartbeatRunWatchdogDecisions.runId, seeded.runId)))
      .toHaveLength(0);
  });

  it("folds existing legacy evaluation and recovery rows idempotently", async () => {
    const now = new Date("2026-04-22T20:00:00.000Z");
    const seeded = await seedRunningRun({
      now,
      ageMs: ACTIVE_RUN_OUTPUT_CRITICAL_THRESHOLD_MS + 60_000,
      sourceStatus: "done",
      sameRunTerminalEvidence: true,
    });
    const evaluationIssueId = randomUUID();
    await db.insert(issues).values({
      id: evaluationIssueId,
      spaceId: seeded.spaceId,
      title: "Existing stale evaluation",
      status: "todo",
      priority: "high",
      assigneeAgentId: seeded.managerId,
      issueNumber: 2,
      identifier: `${seeded.issuePrefix}-2`,
      originKind: "stale_active_run_evaluation",
      originId: seeded.runId,
      originRunId: seeded.runId,
      originFingerprint: `stale_active_run:${seeded.spaceId}:${seeded.runId}`,
    });
    await db.insert(issueRelations).values({
      spaceId: seeded.spaceId,
      issueId: evaluationIssueId,
      relatedIssueId: seeded.issueId,
      type: "blocks",
    });
    await db.insert(issueRecoveryActions).values({
      spaceId: seeded.spaceId,
      sourceIssueId: seeded.issueId,
      recoveryIssueId: evaluationIssueId,
      kind: "active_run_watchdog",
      status: "active",
      ownerType: "agent",
      ownerAgentId: seeded.managerId,
      cause: "active_run_watchdog",
      fingerprint: `active-run-watchdog:${seeded.spaceId}:${seeded.runId}:${seeded.issueId}`,
      evidence: { runId: seeded.runId },
      nextAction: "Review stale active run",
    });
    const { recovery } = createRecovery();

    await expect(recovery.scanSilentActiveRuns({ now, spaceId: seeded.spaceId }))
      .resolves.toMatchObject({ created: 0, folded: 1 });
    await expect(recovery.scanSilentActiveRuns({ now, spaceId: seeded.spaceId }))
      .resolves.toMatchObject({ scanned: 0, created: 0, folded: 0 });
    const [evaluation] = await db.select().from(issues).where(eq(issues.id, evaluationIssueId));
    const [action] = await db.select().from(issueRecoveryActions).where(eq(issueRecoveryActions.sourceIssueId, seeded.issueId));
    expect(evaluation?.status).toBe("done");
    expect(action).toMatchObject({ status: "resolved", outcome: "false_positive" });
    expect(await db.select().from(heartbeatRunWatchdogDecisions).where(eq(
      heartbeatRunWatchdogDecisions.runId,
      seeded.runId,
    ))).toHaveLength(1);
    expect(await db.select().from(heartbeatRunEvents).where(eq(heartbeatRunEvents.runId, seeded.runId))).toHaveLength(1);
  });

  it("keeps open legacy evaluations readable without refreshing or reprioritizing them", async () => {
    const now = new Date("2026-04-22T20:00:00.000Z");
    const seeded = await seedRunningRun({
      now,
      ageMs: ACTIVE_RUN_OUTPUT_CRITICAL_THRESHOLD_MS + 60_000,
    });
    const evaluationIssueId = randomUUID();
    const evaluationUpdatedAt = new Date("2026-04-20T12:00:00.000Z");
    await db.insert(issues).values({
      id: evaluationIssueId,
      spaceId: seeded.spaceId,
      title: "Legacy silent-run evaluation",
      status: "todo",
      priority: "medium",
      assigneeAgentId: seeded.managerId,
      issueNumber: 2,
      identifier: `${seeded.issuePrefix}-2`,
      originKind: "stale_active_run_evaluation",
      originId: seeded.runId,
      originRunId: seeded.runId,
      originFingerprint: `stale_active_run:${seeded.spaceId}:${seeded.runId}`,
      updatedAt: evaluationUpdatedAt,
    });
    const { enqueueWakeup, recovery } = createRecovery();

    await expect(buildSummary(seeded.runId, now)).resolves.toMatchObject({
      level: "critical",
      evaluationIssueId,
      evaluationIssueIdentifier: `${seeded.issuePrefix}-2`,
      evaluationIssueAssigneeAgentId: seeded.managerId,
    });
    await expect(recovery.scanSilentActiveRuns({ now, spaceId: seeded.spaceId }))
      .resolves.toMatchObject({ created: 0, existing: 1, escalated: 0 });
    const [evaluation] = await db.select().from(issues).where(eq(issues.id, evaluationIssueId));
    expect(evaluation).toMatchObject({ status: "todo", priority: "medium", assigneeAgentId: seeded.managerId });
    expect(evaluation?.updatedAt.toISOString()).toBe(evaluationUpdatedAt.toISOString());
    expect(await db.select().from(issueComments).where(eq(issueComments.issueId, evaluationIssueId))).toHaveLength(0);
    expect(await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.spaceId, seeded.spaceId))).toHaveLength(0);
    expect(enqueueWakeup).not.toHaveBeenCalled();

    await expect(recovery.recordWatchdogDecision({
      runId: seeded.runId,
      actor: { type: "agent", agentId: seeded.managerId },
      decision: "continue",
      evaluationIssueId,
      reason: "Resolve through the legacy review",
      now,
    })).resolves.toMatchObject({ evaluationIssueId, createdByAgentId: seeded.managerId });
    await expect(recovery.recordWatchdogDecision({
      runId: seeded.runId,
      actor: { type: "agent", agentId: randomUUID() },
      decision: "continue",
      evaluationIssueId,
      reason: "Not assigned",
      now,
    })).rejects.toMatchObject({ status: 403 });
  });

  it("does not recreate or auto-dismiss a closed legacy evaluation", async () => {
    const now = new Date("2026-04-22T20:00:00.000Z");
    const seeded = await seedRunningRun({
      now,
      ageMs: ACTIVE_RUN_OUTPUT_SUSPICION_THRESHOLD_MS + 60_000,
    });
    const evaluationIssueId = randomUUID();
    await db.insert(issues).values({
      id: evaluationIssueId,
      spaceId: seeded.spaceId,
      title: "Closed legacy evaluation",
      status: "done",
      priority: "medium",
      assigneeAgentId: seeded.managerId,
      issueNumber: 2,
      identifier: `${seeded.issuePrefix}-2`,
      originKind: "stale_active_run_evaluation",
      originId: seeded.runId,
      originRunId: seeded.runId,
      originFingerprint: `stale_active_run:${seeded.spaceId}:${seeded.runId}`,
    });
    const { recovery } = createRecovery();

    await expect(recovery.scanSilentActiveRuns({ now, spaceId: seeded.spaceId }))
      .resolves.toMatchObject({ created: 0, existing: 0, skipped: 1 });
    expect(await db.select().from(issues).where(eq(issues.spaceId, seeded.spaceId))).toHaveLength(2);
    expect(await db.select().from(heartbeatRunWatchdogDecisions).where(eq(
      heartbeatRunWatchdogDecisions.runId,
      seeded.runId,
    ))).toHaveLength(0);
  });

});
