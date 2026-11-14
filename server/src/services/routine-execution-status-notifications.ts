import { DELIVERY_QUEUES, notifyDeliveryWork } from "./delivery-work-notifications.js";

export type RoutineExecutionStatusScope = { issueId?: string; spaceId?: string };

export function notifyRoutineExecutionStatus(tx: object, issueId?: string, spaceId?: string) {
  return notifyDeliveryWork(tx, DELIVERY_QUEUES.routineExecutionStatus,
    issueId || spaceId ? JSON.stringify({ issueId, spaceId } satisfies RoutineExecutionStatusScope) : "*");
}
