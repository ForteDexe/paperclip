import { agentWakeupRequests, type Db } from "@outpost/db";
import { and, eq, sql } from "drizzle-orm";
import { DELIVERY_QUEUES, notifyDeliveryWork } from "./delivery-work-notifications.js";

export type DeferredExecutionScope = { spaceId: string; requestId?: string };
export type DeferredReceiptRecoveryOptions = {
  spaceId?: string;
  requestId?: string;
  onError?: (error: unknown) => void;
};

function hint(scope: DeferredExecutionScope) {
  return JSON.stringify({ spaceId: scope.spaceId, requestId: scope.requestId });
}

export async function notifyDeferredExecutionWork(tx: object, scope: DeferredExecutionScope) {
  await notifyDeliveryWork(tx, DELIVERY_QUEUES.deferredExecutionReceipts, hint(scope));
}

/** The last gate holding one issue's saved wakes cleared (its run reached a
 * terminal status or released its environment). Hint each saved wake by id: a
 * space hint can wait out the worker's reconstruction interval, which left
 * a delivered-looking task with an unread message. */
export async function notifyDeferredWakesForIssue(tx: object, scope: { spaceId: string; issueId: string }) {
  const wakes = await (tx as Pick<Db, "select">).select({ id: agentWakeupRequests.id }).from(agentWakeupRequests).where(and(
    eq(agentWakeupRequests.spaceId, scope.spaceId), eq(agentWakeupRequests.status, "deferred_issue_execution"),
    sql`${agentWakeupRequests.payload}->>'issueId' = ${scope.issueId}`,
  )).limit(25);
  for (const wake of wakes) await notifyDeferredExecutionWork(tx, { spaceId: scope.spaceId, requestId: wake.id });
}

export async function notifyNativeStatusWakeWork(tx: object, scope: DeferredExecutionScope) {
  await notifyDeliveryWork(tx, DELIVERY_QUEUES.nativeStatusWakeIntents, hint(scope));
}

export async function notifyTaskRetrySettlement(tx: object, scope: DeferredExecutionScope) {
  await notifyDeliveryWork(tx, DELIVERY_QUEUES.taskRetryReceiptSettlement, hint(scope));
}

export async function notifyDeferredExecutionEligibility(tx: object, scope?: { spaceId: string }) {
  // Only an actual continuation obligation may wake this passive worker.
  // Empty eligibility hints during idle drain must not keep maintenance active.
  const pending = await (tx as Pick<Db, "execute">).execute<{ pendingPreparationContinuation: boolean }>(sql`
    select exists (select 1 from issue_recovery_actions
      where evidence ? 'systemRecovery' and evidence#>>'{systemRecovery,state}' = 'complete'
        and evidence->>'bootstrapPreparationSettledAt' is not null
        and coalesce(evidence->>'bootstrapPreparationContinuation', 'pending') in ('pending', 'deferred')
        ${scope ? sql`and space_id = ${scope.spaceId}::uuid` : sql``}
    ) as "pendingPreparationContinuation"`);
  if (pending[0]?.pendingPreparationContinuation === true)
    await notifyDeliveryWork(tx, DELIVERY_QUEUES.workspaceRecovery, scope ? JSON.stringify({ spaceId: scope.spaceId }) : "*");
  await notifyDeliveryWork(tx, DELIVERY_QUEUES.nativeProcessSessions, scope ? JSON.stringify({ spaceId: scope.spaceId }) : "*");
  if (scope) {
    await notifyDeferredExecutionWork(tx, scope);
    await notifyNativeStatusWakeWork(tx, scope);
  } else {
    await notifyDeliveryWork(tx, DELIVERY_QUEUES.deferredExecutionReceipts, "*");
    await notifyDeliveryWork(tx, DELIVERY_QUEUES.nativeStatusWakeIntents, "*");
  }
}
