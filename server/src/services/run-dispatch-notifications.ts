import { notifyIssueRecovery } from "./issue-recovery-notifications.js";
import { DELIVERY_QUEUES, notifyDeliveryWork } from "./delivery-work-notifications.js";

export type RunDispatchScope = { spaceId: string };

export async function notifyQueuedRunDispatch(transaction: object, scope?: RunDispatchScope) {
  await notifyDeliveryWork(transaction, DELIVERY_QUEUES.queuedRunDispatch,
    scope ? JSON.stringify({ spaceId: scope.spaceId }) : "*");
}

export async function notifyRunDispatch(transaction: object, scope?: RunDispatchScope) {
  await notifyIssueRecovery(transaction, scope ? { spaceId: scope.spaceId } : undefined);
  const hint = scope ? JSON.stringify({ spaceId: scope.spaceId }) : "*";
  await notifyDeliveryWork(transaction, DELIVERY_QUEUES.nativeProcessSessions, hint);
  await notifyDeliveryWork(transaction, DELIVERY_QUEUES.executionReplacement, hint);
  await notifyQueuedRunDispatch(transaction, scope);
}

/** Only a retry row or deadline change needs to re-read the saved retry schedule. */
export async function notifyScheduledRetryDispatch(transaction: object, scope?: RunDispatchScope) {
  await notifyRunDispatch(transaction, scope);
  await notifyDeliveryWork(transaction, DELIVERY_QUEUES.scheduledRetryDispatch);
}
