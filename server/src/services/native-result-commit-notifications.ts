import { DELIVERY_QUEUES, notifyDeliveryWork } from "./delivery-work-notifications.js";

export type NativeResultCommitScope = { spaceId: string; runId?: string; issueId?: string };

export function notifyNativeResultCommit(tx: object, scope?: NativeResultCommitScope) {
  return notifyDeliveryWork(tx, DELIVERY_QUEUES.nativeResultCommit,
    scope ? JSON.stringify({ spaceId: scope.spaceId, runId: scope.runId, issueId: scope.issueId }) : "*");
}
