import type { Db } from "@outpost/db";
import { DELIVERY_QUEUES, notifyDeliveryWork } from "./delivery-work-notifications.js";

type HealthChange = string | { spaceId: string; id: string } | { spaceId: string; applicationId: string };
export type HealthScope = { spaceId?: string; connectionId?: string; applicationId?: string };

export function healthScope(hint: string): HealthScope {
  if (hint === "*") return {};
  const [spaceId, kind, id, extra] = hint.split(":");
  if (spaceId && kind === undefined) return { spaceId };
  if (spaceId && id && extra === undefined) {
    if (kind === "connection") return { spaceId, connectionId: id };
    if (kind === "application") return { spaceId, applicationId: id };
  }
  throw new Error("Invalid tool connection health scope");
}

export const notifyToolConnectionHealth = async (transaction: object, target: HealthChange) => {
  await notifyDeliveryWork(transaction, DELIVERY_QUEUES.toolReviewRecovery, typeof target === "string" ? target : target.spaceId);
  await notifyDeliveryWork(transaction, DELIVERY_QUEUES.toolConnectionHealth, typeof target === "string" ? target
    : "id" in target ? `${target.spaceId}:connection:${target.id}` : `${target.spaceId}:application:${target.applicationId}`);
};

export function writeToolConnectionHealthChange<T>(db: Db, target: HealthChange, write: (transaction: Db) => Promise<T>): Promise<T> {
  return db.transaction(async tx => {
    await notifyToolConnectionHealth(tx, target);
    return write(tx as unknown as Db);
  });
}
