import { DELIVERY_QUEUES, notifyDeliveryWork } from "./delivery-work-notifications.js";

export type MergeConfirmationScope = { spaceId: string; issueId?: string; interactionId?: string };

export function notifyMergeConfirmationWork(tx: object, scope: MergeConfirmationScope) {
  return notifyDeliveryWork(tx, DELIVERY_QUEUES.mergedPullRequestConfirmations, JSON.stringify({ spaceId: scope.spaceId, issueId: scope.issueId, interactionId: scope.interactionId }));
}
