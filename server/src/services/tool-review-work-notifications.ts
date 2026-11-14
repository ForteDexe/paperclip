import type { Db } from "@outpost/db";
import { DELIVERY_QUEUES, notifyDeliveryWork } from "./delivery-work-notifications.js";

export async function notifyToolReviewChange(transaction: object, spaceId: string) {
  await notifyDeliveryWork(transaction, DELIVERY_QUEUES.toolReviewExpiry, spaceId);
  await notifyDeliveryWork(transaction, DELIVERY_QUEUES.toolReviewRecovery, spaceId);
  await notifyDeliveryWork(transaction, DELIVERY_QUEUES.toolReviewInterruption, spaceId);
  await notifyDeliveryWork(transaction, DELIVERY_QUEUES.toolReviewProjection, spaceId);
}

export function writeToolReviewChange<T>(db: Db, spaceId: string, write: (transaction: Db) => Promise<T>): Promise<T> {
  return db.transaction(async transaction => {
    await notifyToolReviewChange(transaction, spaceId);
    return write(transaction as unknown as Db);
  });
}
