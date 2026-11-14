import { currentPluginInteractionOrigin } from "../plugin-interaction-context.js";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { agents, toolApplications, toolCatalogEntries, toolConnections, toolPolicies, toolProfiles } from "@outpost/db";
import type { CreateToolProfileEntryForProfile } from "@outpost/shared";
import type { ToolAccessMutationDb } from "./types.js";
export async function lockManagedAppPolicies(client: ToolAccessMutationDb, spaceId: string, connectionId: string) {
  await client.select({ id: toolPolicies.id }).from(toolPolicies).where(and(
    eq(toolPolicies.spaceId, spaceId), eq(toolPolicies.policyType, "require_approval"),
    sql`${toolPolicies.config}->>'source' = 'app_gallery_finish'`,
    sql`${toolPolicies.config}->>'connectionId' = ${connectionId}`,
  )).orderBy(toolPolicies.id).for("no key update");
}

export async function lockToolAssignmentAgents(client: ToolAccessMutationDb, spaceId: string, targets: ReadonlyArray<{ targetType: string; targetId: string }>, actorAgentId?: string | null) {
  const allAgents = targets.some(target => target.targetType === "space" && target.targetId === spaceId);
  const ids = targets.filter(target => target.targetType === "agent").map(target => target.targetId);
  const sourceAgentId = currentPluginInteractionOrigin()?.agentId ?? actorAgentId;
  if (sourceAgentId) ids.push(sourceAgentId);
  if (!allAgents && !ids.length) return;
  await client.select({ id: agents.id }).from(agents)
    .where(and(eq(agents.spaceId, spaceId), or(sql`${agents.status} NOT IN ('pending_approval', 'terminated')`, ids.length ? inArray(agents.id, ids) : undefined),
      allAgents ? undefined : inArray(agents.id, ids)))
    .orderBy(agents.id).for("no key update");
}

export async function lockToolConnectionRuntimeInputs(client: ToolAccessMutationDb, spaceId: string, connectionId: string) {
  await client.select({ id: toolApplications.id }).from(toolApplications)
    .innerJoin(toolConnections, and(eq(toolConnections.applicationId, toolApplications.id), eq(toolConnections.spaceId, toolApplications.spaceId)))
    .where(and(eq(toolConnections.id, connectionId), eq(toolConnections.spaceId, spaceId)))
    .for("update", { of: toolApplications });
  await client.select({ id: toolConnections.id }).from(toolConnections)
    .where(and(eq(toolConnections.id, connectionId), eq(toolConnections.spaceId, spaceId))).for("update");
  await client.select({ id: toolProfiles.id }).from(toolProfiles)
    .where(and(eq(toolProfiles.spaceId, spaceId), eq(toolProfiles.profileKey, `app:${connectionId}`)))
    .for("no key update");
  await lockManagedAppPolicies(client, spaceId, connectionId);
}

export async function lockProfileEntryReferences(client: ToolAccessMutationDb, spaceId: string, entries: Pick<CreateToolProfileEntryForProfile, "applicationId" | "connectionId" | "catalogEntryId">[]) {
  const applicationIds = [...new Set(entries.flatMap(entry => entry.applicationId ? [entry.applicationId] : []))];
  const connectionIds = [...new Set(entries.flatMap(entry => entry.connectionId ? [entry.connectionId] : []))];
  const catalogIds = [...new Set(entries.flatMap(entry => entry.catalogEntryId ? [entry.catalogEntryId] : []))];
  if (applicationIds.length) await client.select({ id: toolApplications.id }).from(toolApplications)
    .where(and(eq(toolApplications.spaceId, spaceId), inArray(toolApplications.id, applicationIds))).orderBy(toolApplications.id).for("key share");
  if (connectionIds.length) await client.select({ id: toolConnections.id }).from(toolConnections)
    .where(and(eq(toolConnections.spaceId, spaceId), inArray(toolConnections.id, connectionIds))).orderBy(toolConnections.id).for("key share");
  if (catalogIds.length) await client.select({ id: toolCatalogEntries.id }).from(toolCatalogEntries)
    .where(and(eq(toolCatalogEntries.spaceId, spaceId), inArray(toolCatalogEntries.id, catalogIds))).orderBy(toolCatalogEntries.id).for("key share");
}
