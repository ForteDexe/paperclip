import { hasCommittedNativeControllerContainment } from "../native-runtime/native-failed-run-owner-release.js";
import { and, eq, sql } from "drizzle-orm";
import { agentWakeupRequests, environmentLeases, heartbeatRuns, issueRecoveryActions, nativeRunFinalizations, nativeRunResults, issues, type Db } from "@outpost/db";
import { buildExecutionContinuation } from "../execution-continuation.js";
import { readTaskRetryIntent } from "../task-retry.js";
import { hasNativeLocalProcessStop, hasHistoricalSuspendedNativeSession, recordedLocalExecutionStopped } from "../native-local-process-stop.js";
import { hasRecoveredCleanupStopReceipt, hasRemoteTerminationReceipt } from "../remote-execution-termination.js";
import { adapterExecutionControls } from "../adapter-execution-control.js";
import { getExecutionBlocker, hasPendingRunCleanup } from "../execution-blocker.js";
import { readSystemRecovery } from "../system-recovery-state.js";

/** This receipt changes the workspace strategy, never the external principal,
 * accepted inbound batch, publication scope, or current conversation access. */
export async function readTaskChatRetryIntent(db: Db, input: {
  spaceId: string; issueId: string; agentId: string; sourceRunId: string;
  intentId: string; chatActionId?: string;
}) {
  const [wake] = await db.select().from(agentWakeupRequests).where(and(
    eq(agentWakeupRequests.spaceId, input.spaceId), eq(agentWakeupRequests.id, input.intentId),
    eq(agentWakeupRequests.agentId, input.agentId), eq(agentWakeupRequests.reason, "task_retry"),
    eq(agentWakeupRequests.requestedByActorType, "user"),
    sql`${agentWakeupRequests.payload}->>'issueId' = ${input.issueId}`,
    sql`${agentWakeupRequests.idempotencyKey} like 'task-retry:%'`,
  ));
  const intent = readTaskRetryIntent(wake?.payload);
  return wake && intent && intent.generationId === wake.id && !intent.canonicalIntentId &&
    intent.sourceRunId === input.sourceRunId && intent.actorId === wake.requestedByActorId &&
    (!input.chatActionId || intent.chatActionId === input.chatActionId)
    ? { wake, intent } : null;
}

/** An unusable checkpoint does not prevent an isolated attempt. The old
 * executor must still be contained; a terminal database row is insufficient. */
export async function taskChatRetryExecutionStopped(db: Db, run: typeof heartbeatRuns.$inferSelect) {
  return taskChatRetryExecutionContained(db, run, false);
}

export async function taskChatRetrySourceCleanupPending(db: Db, run: typeof heartbeatRuns.$inferSelect, issueId: string) {
  const hint = run.contextSnapshot?.chatFailedRunRetry as Record<string, unknown> | undefined;
  const intentId = run.contextSnapshot?.taskRetryRequestId;
  if (typeof intentId !== "string" || !run.retryOfRunId || !run.wakeupRequestId ||
      run.contextSnapshot?.issueId !== issueId || hint?.version !== 1 ||
      hint.actionId !== run.wakeupRequestId || hint.failedRunId !== run.retryOfRunId) return false;
  const retry = await readTaskChatRetryIntent(db, { spaceId: run.spaceId, issueId, agentId: run.agentId,
    sourceRunId: run.retryOfRunId, intentId, chatActionId: run.wakeupRequestId });
  if (retry?.wake.status !== "coalesced" || retry.wake.runId !== run.id) return false;
  const [source] = await db.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(and(
    eq(heartbeatRuns.spaceId, run.spaceId), eq(heartbeatRuns.agentId, run.agentId),
    eq(heartbeatRuns.nativeIssueId, issueId), eq(heartbeatRuns.id, run.retryOfRunId),
    eq(heartbeatRuns.runtimeMode, "native"),
  ));
  return Boolean(source && await hasPendingRunCleanup(db, run.spaceId, source.id));
}

async function taskChatRetryExecutionContained(db: Db, run: typeof heartbeatRuns.$inferSelect, admittedFailure: boolean) {
  if (adapterExecutionControls.has(run.id) ||
      (run.controllerLeaseExpiresAt && run.controllerLeaseExpiresAt > new Date())) return false;
  const [coordinator] = await db.select().from(nativeRunFinalizations).where(and(
    eq(nativeRunFinalizations.spaceId, run.spaceId), eq(nativeRunFinalizations.runId, run.id),
  )).for("share", { noWait: true });
  if (coordinator && (coordinator.leaseOwner || coordinator.failureDetail?.successorRunId ||
      !["terminal_failure", "committed"].includes(coordinator.phase))) return false;
  if (coordinator?.resultId) {
    if (!admittedFailure || run.runtimeMode !== "native" || run.status !== "failed" ||
        run.nativePhase !== "committed" || !run.completionContractId || coordinator.phase !== "committed" ||
        coordinator.issueId !== run.nativeIssueId) return false;
    const [failedResult] = await db.select({ id: nativeRunResults.id }).from(nativeRunResults).where(and(
      eq(nativeRunResults.spaceId, run.spaceId), eq(nativeRunResults.runId, run.id),
      eq(nativeRunResults.issueId, run.nativeIssueId!), eq(nativeRunResults.id, coordinator.resultId),
      eq(nativeRunResults.schemaStatus, "accepted"), eq(nativeRunResults.completionContractId, run.completionContractId),
      sql`${nativeRunResults.resultJson}#>>'{terminal,runTerminalState}' = 'failed'`,
    )).limit(1);
    if (!failedResult) return false;
  }
  const leases = await db.select().from(environmentLeases).where(and(
    eq(environmentLeases.spaceId, run.spaceId), eq(environmentLeases.heartbeatRunId, run.id),
  )).for("share", { noWait: true });
  if (leases.some(lease => lease.provider !== "local")) {
    return leases.every(lease => hasRemoteTerminationReceipt(lease) || hasRecoveredCleanupStopReceipt(lease));
  }
  return await hasCommittedNativeControllerContainment(db, run, run.nativeIssueId ?? "") ||
    await recordedLocalExecutionStopped(db, run) ||
    await hasNativeLocalProcessStop(db, run.spaceId, run.id) ||
    await hasHistoricalSuspendedNativeSession(db, run);
}

/** Dispatch revalidates the canonical admission receipt, not an admission which
 * has already resolved its recovery holds. This exception certifies only the
 * exact current successor; it never makes the failed result replayable. */
export async function taskChatRetryAdmittedContinuationStopped(db: Db, run: typeof heartbeatRuns.$inferSelect,
  input: { issueId: string; intentId: string; successorRunId: string; commentId: string }) {
  if (run.nativeIssueId !== input.issueId) return false;
  const retry = await readTaskChatRetryIntent(db, { spaceId: run.spaceId, issueId: input.issueId,
    agentId: run.agentId, sourceRunId: run.id, intentId: input.intentId });
  if (!retry?.intent.chatActionId) return false;
  const [task] = await db.select({ assignee: issues.assigneeAgentId, executionRunId: issues.executionRunId })
    .from(issues).where(and(eq(issues.spaceId, run.spaceId), eq(issues.id, input.issueId)));
  const [successor] = await db.select().from(heartbeatRuns).where(and(eq(heartbeatRuns.spaceId, run.spaceId),
    eq(heartbeatRuns.id, input.successorRunId), eq(heartbeatRuns.agentId, run.agentId))).for("share", { noWait: true });
  const [receipt] = await db.select({ runId: agentWakeupRequests.runId, status: agentWakeupRequests.status })
    .from(agentWakeupRequests).where(and(eq(agentWakeupRequests.spaceId, run.spaceId),
      eq(agentWakeupRequests.id, retry.intent.chatActionId), eq(agentWakeupRequests.agentId, run.agentId)));
  const explicit = successor?.contextSnapshot?.explicitUserContinuation as Record<string, unknown> | undefined;
  if (!successor || task?.assignee !== run.agentId || task.executionRunId !== successor.id ||
      successor.contextSnapshot?.issueId !== input.issueId ||
      (successor.nativeIssueId !== null && successor.nativeIssueId !== input.issueId) ||
      successor.status !== "running" || successor.wakeupRequestId !== retry.intent.chatActionId ||
      successor.retryOfRunId !== run.id || receipt?.runId !== successor.id || receipt.status !== "claimed" ||
      successor.contextSnapshot?.taskRetryRequestId !== input.intentId ||
      explicit?.previousRunId !== run.id || explicit.commentId !== input.commentId ||
      explicit.taskRetryRequestId !== input.intentId || await getExecutionBlocker(db, run.spaceId, input.issueId)) return false;
  try {
    await buildExecutionContinuation({ db, spaceId: run.spaceId, issueId: input.issueId,
      agentId: run.agentId, runId: successor.id, context: successor.contextSnapshot!, summary: null, exposeLowTrustRaw: false });
  } catch (error) {
    if (error instanceof Error && ["continuation_user_authorization_missing", "continuation_source_context_missing",
      "continuation_task_ownership_changed"].includes(error.message)) return false;
    throw error;
  }
  return taskChatRetryExecutionContained(db, run, true);
}

/** Admission may persist a wait for the exact recovery this user requested.
 * This grants no execution authority: promotion and execution still require
 * containment, and the queue retains the source's current execution blocker. */
export async function taskChatRetryCanAwaitRecovery(db: Db, run: typeof heartbeatRuns.$inferSelect,
  issueId: string, intentId: string) {
  const retry = await readTaskChatRetryIntent(db, { spaceId: run.spaceId, issueId,
    agentId: run.agentId, sourceRunId: run.id, intentId });
  if (!retry || retry.wake.status !== "deferred_issue_execution" || retry.wake.runId) return false;
  const blocker = await getExecutionBlocker(db, run.spaceId, issueId);
  if (blocker?.runId !== run.id || !blocker.recoveryActionId) return false;
  const [action] = await db.select({ evidence: issueRecoveryActions.evidence }).from(issueRecoveryActions).where(and(
    eq(issueRecoveryActions.spaceId, run.spaceId), eq(issueRecoveryActions.sourceIssueId, issueId),
    eq(issueRecoveryActions.id, blocker.recoveryActionId),
  )).for("share", { noWait: true });
  const recovery = readSystemRecovery(action?.evidence);
  // Attaching Retry to active automatic recovery preserves that recovery's
  // generation and budget. Its current intentId binds this user request; the
  // Retry receipt's generation is a different identity.
  return Boolean(recovery && recovery.sourceRunId === run.id && recovery.intentId === intentId &&
    ["scheduled", "running", "awaiting_evidence"].includes(recovery.state));
}
