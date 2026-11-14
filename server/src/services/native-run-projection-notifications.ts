import { DELIVERY_QUEUES, notifyDeliveryWork } from "./delivery-work-notifications.js";

export type NativeRunProjectionScope = { spaceId: string; issueId?: string; runId?: string };

export async function notifyNativeRunProjection(tx: object, scope?: NativeRunProjectionScope) {
  await notifyDeliveryWork(tx, DELIVERY_QUEUES.issueMonitors);
  return notifyDeliveryWork(tx, DELIVERY_QUEUES.nativeRunProjection,
    scope ? JSON.stringify({ spaceId: scope.spaceId, issueId: scope.issueId, runId: scope.runId }) : "*");
}
