import { DELIVERY_QUEUES, notifyDeliveryWork } from "./delivery-work-notifications.js";

export type NativeRecoveryNoticeScope = { spaceId: string; issueId?: string; runId?: string };

export function notifyNativeRecoveryNotices(tx: object, scope?: NativeRecoveryNoticeScope) {
  return notifyDeliveryWork(tx, DELIVERY_QUEUES.nativeRecoveryNotices,
    scope ? JSON.stringify({ spaceId: scope.spaceId, issueId: scope.issueId, runId: scope.runId }) : "*");
}
