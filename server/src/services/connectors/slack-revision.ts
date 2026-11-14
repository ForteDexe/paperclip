import { and, eq, getTableColumns, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  chatEndpointResources,
  chatIdentityLinks,
  connectionGrants,
  toolCatalogEntries,
  toolPolicies,
  toolProfileBindings,
  toolProfileEntries,
  toolProfiles,
  type Db,
} from "@outpost/db";

function revisionColumns(columns: Record<string, AnyPgColumn>) {
  return Object.fromEntries(Object.entries(columns).map(([name, column]) => [
    name,
    column.dataType === "date" ? sql`extract(epoch from ${column})`.as(name) : column,
  ]));
}

/** Only authorization fields participate: receiving messages must not reset sessions. */
export async function slackAuthorizationRevision(
  db: Db,
  spaceId: string,
  endpointId: string,
  connectionId: string,
  agentId: string,
  userId: string,
) {
  const queries = [
    db
      .select(revisionColumns({
        id: chatEndpointResources.id,
        available: chatEndpointResources.availability,
        enabled: chatEndpointResources.enabled,
      }))
      .from(chatEndpointResources)
      .where(
        and(
          eq(chatEndpointResources.spaceId, spaceId),
          eq(chatEndpointResources.endpointId, endpointId),
        ),
      )
      .orderBy(chatEndpointResources.id),
    db
      .select(revisionColumns({
        id: chatIdentityLinks.id,
        status: chatIdentityLinks.status,
        user: chatIdentityLinks.outpostUserId,
        updatedAt: chatIdentityLinks.updatedAt,
      }))
      .from(chatIdentityLinks)
      .where(
        and(
          eq(chatIdentityLinks.spaceId, spaceId),
          eq(chatIdentityLinks.endpointId, endpointId),
          eq(chatIdentityLinks.outpostUserId, userId),
        ),
      )
      .orderBy(chatIdentityLinks.id),
    db
      .select(revisionColumns({
        id: connectionGrants.id,
        status: connectionGrants.status,
        updatedAt: connectionGrants.updatedAt,
      }))
      .from(connectionGrants)
      .where(
        and(
          eq(connectionGrants.spaceId, spaceId),
          eq(connectionGrants.connectionId, connectionId),
          eq(connectionGrants.subjectUserId, userId),
        ),
      )
      .orderBy(connectionGrants.id),
    db
      .select(revisionColumns({
        id: toolCatalogEntries.id,
        hash: toolCatalogEntries.versionHash,
        status: toolCatalogEntries.status,
        quarantine: toolCatalogEntries.quarantinedAt,
      }))
      .from(toolCatalogEntries)
      .where(
        and(
          eq(toolCatalogEntries.spaceId, spaceId),
          eq(toolCatalogEntries.connectionId, connectionId),
        ),
      )
      .orderBy(toolCatalogEntries.id),
    db
      .select(revisionColumns(getTableColumns(toolPolicies)))
      .from(toolPolicies)
      .where(eq(toolPolicies.spaceId, spaceId))
      .orderBy(toolPolicies.id),
    db
      .select(revisionColumns(getTableColumns(toolProfiles)))
      .from(toolProfiles)
      .where(eq(toolProfiles.spaceId, spaceId))
      .orderBy(toolProfiles.id),
    db
      .select(revisionColumns(getTableColumns(toolProfileEntries)))
      .from(toolProfileEntries)
      .where(eq(toolProfileEntries.spaceId, spaceId))
      .orderBy(toolProfileEntries.id),
    db
      .select(revisionColumns(getTableColumns(toolProfileBindings)))
      .from(toolProfileBindings)
      .where(
        and(
          eq(toolProfileBindings.spaceId, spaceId),
          eq(toolProfileBindings.targetId, agentId),
        ),
      )
      .orderBy(toolProfileBindings.id),
  ];
  const digests = queries.map(query => sql`(
    select encode(sha256(convert_to(coalesce(string_agg(
      encode(sha256(convert_to(row_to_json(revision_row)::text, 'UTF8')), 'hex'),
      '' order by revision_row.id
    ), ''), 'UTF8')), 'hex')
    from (${query.getSQL()}) as revision_row
  )`);
  const [result] = await db.select({
    revision: sql<string>`encode(sha256(convert_to(
      concat(${sql.join(digests, sql`, `)}), 'UTF8'
    )), 'hex')`,
  }).from(sql`(values (1)) as revision_scope(value)`);
  return result!.revision;
}
