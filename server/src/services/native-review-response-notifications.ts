import { DELIVERY_QUEUES, notifyDeliveryWork } from "./delivery-work-notifications.js";

export type NativeReviewResponseScope = { spaceId: string; issueId?: string; runId?: string; agentId?: string };

export function notifyNativeReviewResponse(tx: object, scope: NativeReviewResponseScope) {
  return notifyDeliveryWork(tx, DELIVERY_QUEUES.nativeReviewResponse,
    JSON.stringify({ spaceId: scope.spaceId, issueId: scope.issueId, runId: scope.runId, agentId: scope.agentId }));
}
