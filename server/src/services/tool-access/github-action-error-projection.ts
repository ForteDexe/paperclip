import { and, eq, inArray } from "drizzle-orm";
import { toolApplications, toolConnections, type Db } from "@outpost/db";
import type { IssueThreadInteraction, RequestConfirmationInteraction } from "@outpost/shared";
import { projectGitHubActionResult } from "./github-access-errors.js";
import { toolSourceTemplateKeySql } from "./source-template-key.js";

/** Read-only enrichment of historical errors. Resolve provider identity in one
 * space-scoped batch without reading credentials or relying on mutable names. */
export async function projectGitHubInteractionErrors(
  db: Pick<Db, "select">,
  interactions: IssueThreadInteraction[],
): Promise<IssueThreadInteraction[]> {
  const candidates = interactions.filter((interaction): interaction is RequestConfirmationInteraction =>
    interaction.kind === "request_confirmation"
    && Boolean(interaction.payload.toolAction?.connectionId)
    && projectGitHubActionResult("github", interaction.result) !== interaction.result,
  );
  if (candidates.length === 0) return interactions;

  const connections = await db.select({
    id: toolConnections.id,
    spaceId: toolConnections.spaceId,
    applicationId: toolConnections.applicationId,
    sourceTemplateKey: toolSourceTemplateKeySql,
  }).from(toolConnections).innerJoin(toolApplications, and(
    eq(toolApplications.id, toolConnections.applicationId),
    eq(toolApplications.spaceId, toolConnections.spaceId),
  )).where(and(
    inArray(toolConnections.id, [...new Set(candidates.map(item => item.payload.toolAction!.connectionId!))]),
    inArray(toolConnections.spaceId, [...new Set(candidates.map(item => item.spaceId))]),
  ));
  const bySpaceAndId = new Map(connections.map(connection => [`${connection.spaceId}:${connection.id}`, connection]));
  const projected = new Map(candidates.flatMap(interaction => {
    const action = interaction.payload.toolAction!;
    const connection = bySpaceAndId.get(`${interaction.spaceId}:${action.connectionId}`);
    if (!connection || (action.applicationId && action.applicationId !== connection.applicationId)) return [];
    return [[interaction.id, {
      ...interaction, result: projectGitHubActionResult(connection.sourceTemplateKey, interaction.result),
    }] as const];
  }));
  return interactions.map(interaction => projected.get(interaction.id) ?? interaction);
}
