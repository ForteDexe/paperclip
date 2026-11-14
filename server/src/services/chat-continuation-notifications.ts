import { DELIVERY_QUEUES, notifyDeliveryWork } from "./delivery-work-notifications.js";

export type ChatContinuationScope = { spaceId: string; issueId?: string; actionId?: string };

export async function notifyChatContinuationWork(tx: object, scope: ChatContinuationScope) {
  await notifyDeliveryWork(tx, DELIVERY_QUEUES.chatInteractionContinuations,
    JSON.stringify({ spaceId: scope.spaceId, issueId: scope.issueId, actionId: scope.actionId }));
}
