import { resourceLifecycleEvents, type Db } from "@outpost/db";
import { sql } from "drizzle-orm";
import { DELIVERY_QUEUES, notifyDeliveryWork } from "./delivery-work-notifications.js";

/** Call inside the transaction that creates the resource or approves the create. */
export async function recordResourceCreationEvent(
  db: Db,
  spaceId: string,
  resourceType: "agent" | "project",
  resourceId: string,
): Promise<void> {
  await notifyDeliveryWork(db, DELIVERY_QUEUES.pluginLifecycle);
  await db.insert(resourceLifecycleEvents).values({ spaceId, resourceType, resourceId, action: "create" }).onConflictDoNothing({
    target: [resourceLifecycleEvents.spaceId, resourceLifecycleEvents.resourceType, resourceLifecycleEvents.resourceId],
    where: sql`${resourceLifecycleEvents.action} = 'create'`,
  });
}

/** Call with the agent row locked, in the same transaction as the status change. */
export async function recordAgentStatusEvent(db: Db, spaceId: string, agentId: string, before: string, after: string): Promise<void> {
  if (before === after) return;
  const action = after === "terminated" ? "terminate"
    : after === "paused" ? "pause"
      : before === "paused" && ["active", "idle", "running", "error"].includes(after) ? "resume" : null;
  if (!action) return;
  await notifyDeliveryWork(db, DELIVERY_QUEUES.pluginLifecycle);
  await db.insert(resourceLifecycleEvents).values({ spaceId, resourceType: "agent", resourceId: agentId, action });
}

/** Call while holding the project row lock, in the mutation transaction. */
export async function recordProjectLifecycleEvent(db: Db, spaceId: string, projectId: string, action: "update" | "archive" | "delete" = "update"): Promise<void> {
  await notifyDeliveryWork(db, DELIVERY_QUEUES.pluginLifecycle);
  await db.insert(resourceLifecycleEvents).values({ spaceId, resourceType: "project", resourceId: projectId, action });
}
