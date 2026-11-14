import { and, count, eq, isNotNull, sql } from "drizzle-orm";
import { toolActionRequests, toolCatalogEntries, toolConnections, toolInvocations, type Db } from "@outpost/db";
import type { ToolConnectionReviewCounts } from "@outpost/shared";

/** Counts for one already-authorized connection. Independent aggregates avoid catalog/request fanout. */
export async function getToolConnectionReviewCounts(
  db: Db,
  spaceId: string,
  connectionId: string,
): Promise<ToolConnectionReviewCounts> {
  const pending = db.select({ count: count() }).from(toolActionRequests)
    .innerJoin(toolInvocations, eq(toolInvocations.id, toolActionRequests.invocationId))
    .where(and(
      eq(toolActionRequests.spaceId, spaceId),
      eq(toolInvocations.spaceId, spaceId),
      eq(toolInvocations.connectionId, connectionId),
      eq(toolActionRequests.status, "pending"),
      isNotNull(toolActionRequests.signedArguments),
    ));
  const quarantined = db.select({ count: count() }).from(toolCatalogEntries).where(and(
    eq(toolCatalogEntries.spaceId, spaceId),
    eq(toolCatalogEntries.connectionId, connectionId),
    eq(toolCatalogEntries.status, "quarantined"),
  ));
  const [counts] = await db.select({
    pendingActionRequestCount: sql<number>`case when ${toolConnections.status} = 'archived' then 0 else (${pending}) end`.mapWith(Number),
    quarantinedCatalogEntryCount: sql<number>`case when ${toolConnections.status} = 'archived' then 0 else (${quarantined}) end`.mapWith(Number),
  }).from(toolConnections).where(and(
    eq(toolConnections.spaceId, spaceId), eq(toolConnections.id, connectionId),
  ));
  // Missing/hidden resources are rejected by route admission before this reader.
  return counts ?? { pendingActionRequestCount: 0, quarantinedCatalogEntryCount: 0 };
}
