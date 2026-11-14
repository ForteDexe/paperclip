import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  agents,
  agentWakeupRequests,
  authUsers,
  spaceMemberships,
  spaces,
  createDb,
  environmentLeases,
  environments,
  heartbeatRunEvents,
  heartbeatRuns,
  issueRecoveryActions,
  issues,
  workspaceOperations,
} from "@outpost/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { getExecutionBlocker } from "../services/execution-blocker.js";
import { heartbeatService } from "../services/heartbeat.js";
import { requestTaskRetry } from "../services/task-retry.js";

const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe : describe.skip;

/**
 * Daytona storage baseline w-20261109T154810-s9911, task t06: a follow-up was
 * restoring the saved remote workspace when a graceful shutdown interrupted it.
 * No provider ran. Restore recovery saved the files, but the same agent stayed
 * held, so a Retry was accepted and parked behind the hold with no run.
 */
suite("Retry after a shutdown interrupted workspace restore before provider work", () => {
  let db!: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let spaceId = "", agentId = "", environmentId = "";

  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("outpost-restore-retry-");
    db = createDb(temporary.connectionString);
    spaceId = randomUUID(); agentId = randomUUID(); environmentId = randomUUID();
    await db.insert(spaces).values({ id: spaceId, name: "Outpost", issuePrefix: "RRT",
      requireOperatorApprovalForNewAgents: false });
    await db.insert(agents).values({ id: agentId, spaceId, name: "Coder", role: "engineer", status: "idle",
      adapterType: "outpost_runner", adapterConfig: {}, runtimeConfig: {}, permissions: {} });
    await db.insert(environments).values({ id: environmentId, name: "Sandbox", driver: "sandbox", status: "active",
      config: { provider: "fake" } });
    await db.insert(authUsers).values({ id: "local-operator", name: "Local operator", email: "local-operator@example.invalid",
      createdAt: new Date(), updatedAt: new Date() }).onConflictDoNothing();
    await db.insert(spaceMemberships).values({ spaceId, principalType: "user", principalId: "local-operator", membershipRole: "owner" });
  }, 30_000);

  afterAll(async () => { await temporary?.cleanup(); });

  async function interruptedRestore(options: { cancellationSource?: string; terminationReceipt?: boolean;
    controllerLeaseExpiresAt?: Date; recoveredSnapshotId?: string } = {}) {
    const issueId = randomUUID(), runId = randomUUID(), leaseId = randomUUID(), providerLeaseId = `sandbox-${leaseId}`;
    const finishedAt = new Date(Date.now() - 30_000);
    const restoreRecovery = { schema: "outpost.workspace-restore-recovery.v1", leaseIds: [leaseId] };
    const snapshotId = randomUUID();
    await db.insert(issues).values({ id: issueId, spaceId, title: "Follow-up", status: "blocked",
      assigneeAgentId: agentId, statusVersion: 5 });
    await db.insert(heartbeatRuns).values({ id: runId, spaceId, agentId, invocationSource: "automation",
      issueId, status: "interrupted", errorCode: "server_shutdown_interrupted", runtimeMode: "legacy",
      executionStage: "preparing", startedAt: new Date(finishedAt.getTime() - 3_000), finishedAt, nextEventSeq: 1,
      contextSnapshot: { issueId, wakeReason: "issue_commented" },
      controllerLeaseExpiresAt: options.controllerLeaseExpiresAt ?? null,
      runnerProfileJson: { adapterDispatch: { adapterType: "outpost_runner" },
        remoteWorkspace: { schema: "outpost.remote-workspace-run.v1", state: "saved", epoch: 2, leaseId, providerLeaseId,
          snapshotId, workspaceId: randomUUID(), remoteCwd: "/home/daytona/workspace" } },
      resultJson: { stopReason: "interrupted", workspaceRestoreFailure: "restore_failed", workspaceRestoreRecovery: restoreRecovery,
        cancellation: { reason: "Server shutdown interrupted execution", source: options.cancellationSource ?? "shutdown",
          expected: true, initiator: { type: "system" }, recordedAt: finishedAt.toISOString() } } });
    await db.insert(environmentLeases).values({ id: leaseId, spaceId, environmentId, issueId, heartbeatRunId: runId,
      status: "expired", cleanupStatus: "success", leasePolicy: "reuse_by_environment", provider: "fake", providerLeaseId,
      releasedAt: new Date(finishedAt.getTime() + 2_000),
      metadata: options.terminationReceipt === false ? {} : { remoteExecutionTermination: { schema: "outpost.remote-termination.v1",
        spaceId, runId, leaseId, provider: "fake", providerLeaseId, state: "destroyed", confirmedAt: finishedAt.toISOString() } } });
    const holdId = randomUUID(), preservationId = randomUUID();
    await db.insert(workspaceOperations).values([
      { id: preservationId, spaceId, issueId, heartbeatRunId: runId, phase: "workspace_recovery", status: "succeeded",
        metadata: { recoveryActionId: holdId, storage: "remote_workspace", leaseId, providerLeaseId,
          snapshotId: options.recoveredSnapshotId ?? snapshotId } },
      { spaceId, issueId, heartbeatRunId: runId, phase: "workspace_finalize", status: "succeeded",
        metadata: { owningService: "workspace_recovery", preservationOperationIds: [preservationId] } },
    ]);
    await db.insert(issueRecoveryActions).values({ id: holdId, spaceId, sourceIssueId: issueId,
      kind: "active_run_watchdog", cause: "legacy_execution_requires_reconciliation",
      fingerprint: `legacy-execution:${runId}`, status: "resolved", outcome: "blocked", ownerType: "system",
      nextAction: "Verify the stop receipt and record workspace repair evidence.", resolvedAt: finishedAt,
      evidence: { runId, attempt: 1, originalFailureCode: "server_shutdown_interrupted", continuationDelivery: "invalidated",
        workspaceRestoreFailure: "restore_failed", workspaceRestoreRecovery: restoreRecovery,
        automaticRecovery: { policy: "preserve_without_replay_v1", runId, replay: "blocked", actionOutcome: "unknown" },
        nativeBootstrapFailureBlock: { runId, previousStatus: "in_progress", statusVersion: 5 },
        systemRecovery: { schema: "outpost.system-recovery.v1", policyVersion: 1, sourceRunId: runId, state: "complete",
          phase: "reconcile_effects", attempts: 1, retriesUsed: 0, preservationOperationIds: [preservationId] },
        workspaceRecovery: { schema: "outpost.workspace-recovery.v1", runId, status: "recovered", stage: "saving_receipts",
          attempt: 1, attemptLimit: 6, retryable: true, requestIds: [] } } });
    return { issueId, runId, holdId };
  }

  const retry = (f: { issueId: string; runId: string }) => requestTaskRetry({ db, spaceId, issueId: f.issueId,
    actorId: "local-operator", actorSource: "local_implicit", idempotencyKey: randomUUID(), observedRunId: f.runId });
  const successors = (f: { issueId: string; runId: string }) => db.select().from(heartbeatRuns).where(and(
    eq(heartbeatRuns.spaceId, spaceId), eq(heartbeatRuns.issueId, f.issueId),
    inArray(heartbeatRuns.status, ["queued", "running", "scheduled_retry"])));

  it("starts the Retry because no provider work can have an unknown outcome", async () => {
    const heartbeat = heartbeatService(db);
    const f = await interruptedRestore();
    expect(await getExecutionBlocker(db, spaceId, f.issueId)).toBeNull();
    const receipt = await retry(f);
    expect(receipt).toMatchObject({ accepted: true });
    await heartbeat.resumeTaskRetry(spaceId, receipt.requestId!);
    const [wake] = await db.select().from(agentWakeupRequests).where(eq(agentWakeupRequests.id, receipt.requestId!));
    expect(wake?.status).not.toBe("deferred_issue_execution");
    const [started] = await successors(f);
    expect(started).toBeDefined();
    await vi.waitFor(async () => {
      const [run] = await db.select({ status: heartbeatRuns.status }).from(heartbeatRuns).where(eq(heartbeatRuns.id, started!.id));
      expect(["queued", "running"]).not.toContain(run?.status);
    }, { timeout: 30_000, interval: 200 });
    expect((await db.select().from(issueRecoveryActions).where(eq(issueRecoveryActions.id, f.holdId)))[0])
      .toMatchObject({ status: "resolved", outcome: "blocked", evidence: { automaticRecovery: { replay: "blocked" } } });
  }, 60_000);

  it.each([
    ["a provider turn started", async () => {
      const f = await interruptedRestore();
      await db.insert(heartbeatRunEvents).values({ spaceId, runId: f.runId, agentId, seq: 1, eventType: "turn.started",
        stream: "system", level: "info", message: "turn started" });
      return f;
    }],
    ["a runner event was recorded", async () => {
      const f = await interruptedRestore();
      await db.insert(heartbeatRunEvents).values({ spaceId, runId: f.runId, agentId, seq: 1, eventType: "harness.ready",
        stream: "system", level: "info", message: "harness ready", sourceEventId: randomUUID() });
      return f;
    }],
    ["an operator stopped it", () => interruptedRestore({ cancellationSource: "operator" })],
    ["its sandbox has no stop receipt", () => interruptedRestore({ terminationReceipt: false })],
    ["its controller may still be live", () => interruptedRestore({ controllerLeaseExpiresAt: new Date(Date.now() + 60_000) })],
    ["recovery saved a different snapshot", () => interruptedRestore({ recoveredSnapshotId: randomUUID() })],
  ] as const)("keeps the hold when %s", async (_label, arrange) => {
    const f = await arrange();
    expect(await getExecutionBlocker(db, spaceId, f.issueId)).toMatchObject({ recoveryActionId: f.holdId, runId: f.runId });
  }, 60_000);
});
