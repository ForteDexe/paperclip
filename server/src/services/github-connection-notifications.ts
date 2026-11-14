import { toolConnections, chatEndpoints, type Db } from "@outpost/db";
import { and, eq, sql } from "drizzle-orm";
import { DELIVERY_QUEUES, notifyDeliveryWork } from "./delivery-work-notifications.js";
export async function notifyGitHubCredentialChange(transaction: object, connection: Pick<typeof toolConnections.$inferSelect, "config" | "spaceId">) {
  if (connection.config.sourceTemplateKey !== "github") return;
  await notifyDeliveryWork(transaction, DELIVERY_QUEUES.connectionContinuity, connection.spaceId);
  await notifyDeliveryWork(transaction, DELIVERY_QUEUES.connectionEvents, connection.spaceId);
}

/** Space lifecycle changes only activate owners with a supported registration. */
export async function notifyGitHubSpaceChange(transaction: object, spaceId: string) {
  const db = transaction as Db;
  const [connection] = await db.select({ id: toolConnections.id }).from(toolConnections).where(and(
    eq(toolConnections.spaceId, spaceId), sql`${toolConnections.config}->>'sourceTemplateKey' = 'github'`,
  )).limit(1);
  if (connection) {
    await notifyDeliveryWork(transaction, DELIVERY_QUEUES.connectionContinuity, spaceId);
    await notifyDeliveryWork(transaction, DELIVERY_QUEUES.connectionEvents, spaceId);
    return;
  }
  const [bot] = await db.select({ id: chatEndpoints.id }).from(chatEndpoints).where(and(
    eq(chatEndpoints.spaceId, spaceId), eq(chatEndpoints.provider, "github"),
    sql`${chatEndpoints.setup}->'github'->>'cloudRegistrationId' is not null`,
  )).limit(1);
  if (bot) await notifyDeliveryWork(transaction, DELIVERY_QUEUES.connectionEvents, spaceId);
}
