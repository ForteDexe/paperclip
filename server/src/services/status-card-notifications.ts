import { DELIVERY_QUEUES, notifyDeliveryWork } from "./delivery-work-notifications.js";

/** Card/settings changes reconstruct deadlines; issue changes also evaluate reactive scope. */
export function notifyStatusCardEvaluation(transaction: object, spaceId?: string) {
  return notifyDeliveryWork(transaction, DELIVERY_QUEUES.statusCardEvaluation, spaceId ? `cards:${spaceId}` : "*");
}

export function notifyStatusCardIssueChange(transaction: object, spaceId?: string) {
  return notifyDeliveryWork(transaction, DELIVERY_QUEUES.statusCardEvaluation, spaceId ? `changes:${spaceId}` : "changes:*");
}
