import { and, eq } from "drizzle-orm";
import type { Db } from "@outpost/db";
import { toolCatalogEntries, toolConnections, toolProfiles, toolProfileEntries, toolPolicies, toolProfileBindings } from "@outpost/db";
import type { ConnectionIntentInteraction } from "@outpost/shared";
import { conflict } from "../errors.js";
import { toolAccessPolicyService } from "./tool-access-policy.js";
import { logActivity } from "./activity-log.js";

type AccessTools = NonNullable<ConnectionIntentInteraction["payload"]["accessRequest"]>["tools"];

/** Called inside the caller's transaction after identity and installation checks. */
export async function grantConnectionAgentTools(db: Db, input: {
  connection: Pick<typeof toolConnections.$inferSelect, "id" | "spaceId" | "applicationId">;
  agentId: string;
  userId: string;
  tools: AccessTools;
  interactionId?: string;
  context?: { issueId: string; projectId: string | null };
}) {
  const { connection, agentId, userId, tools, interactionId, context } = input;
  const catalog = await db.select().from(toolCatalogEntries).where(and(
    eq(toolCatalogEntries.spaceId, connection.spaceId), eq(toolCatalogEntries.connectionId, connection.id),
  )).for("update");
  for (const requested of tools) {
    const tool = catalog.find(entry => entry.id === requested.catalogEntryId);
    if (!tool || tool.status !== "active" || tool.entryKind !== "tool" || tool.toolName !== requested.toolName
      || tool.versionHash !== requested.versionHash || (requested.permission === "allowed" && tool.riskLevel !== "read")) {
      throw conflict("The requested tools changed. Ask the agent for a new access request.");
    }
    const decision = await toolAccessPolicyService(db).decide({
      spaceId: connection.spaceId,
      actor: { actorType: "agent", actorId: agentId, agentId: agentId },
      runContext: context ?? {},
      request: { connectionId: connection.id, catalogEntryId: tool.id, toolName: tool.toolName, arguments: {} },
    });
    if (decision.decision === "deny" && decision.reasonCode !== "deny_default") {
      throw conflict("An existing policy blocks this tool. Review the connection's permissions before granting access.");
    }
  }
  // An additive, agent-scoped profile leaves other connection permissions
  // and space-wide assignments intact. The caller supplies the exact reviewed tool set.
  const profileKey = `connection-intent:${connection.id}:${agentId}`;
  const [profile] = await db.insert(toolProfiles).values({
    spaceId: connection.spaceId, profileKey, name: profileKey, defaultAction: "deny",
    metadata: { source: "connection_intent", connectionId: connection.id, agentId: agentId },
  }).onConflictDoUpdate({ target: [toolProfiles.spaceId, toolProfiles.profileKey], set: { status: "active", updatedAt: new Date() } }).returning();
  const entries = await db.select().from(toolProfileEntries).where(and(
    eq(toolProfileEntries.spaceId, connection.spaceId), eq(toolProfileEntries.profileId, profile.id),
  ));
  for (const tool of tools) {
    if (!entries.some(entry => entry.catalogEntryId === tool.catalogEntryId && entry.effect === "include")) {
      await db.insert(toolProfileEntries).values({ spaceId: connection.spaceId, profileId: profile.id,
        selectorType: "catalog_entry", effect: "include", catalogEntryId: tool.catalogEntryId,
        connectionId: connection.id, applicationId: connection.applicationId });
    }
    if (tool.permission === "ask_first") {
      const name = `connection-intent:${agentId}:${tool.catalogEntryId}`;
      await db.insert(toolPolicies).values({ spaceId: connection.spaceId, name, policyType: "require_approval", priority: 0,
        selectors: { connectionId: connection.id, catalogEntryId: tool.catalogEntryId },
        conditions: { actor: { agentId: agentId } },
        config: { source: "connection_intent", connectionId: connection.id, agentId: agentId },
        createdByUserId: userId,
      }).onConflictDoUpdate({ target: [toolPolicies.spaceId, toolPolicies.name], set: { enabled: true, updatedAt: new Date() } });
    }
  }
  await db.insert(toolProfileBindings).values({ spaceId: connection.spaceId, profileId: profile.id,
    targetType: "agent", targetId: agentId, priority: 100, createdByUserId: userId,
    metadata: { source: "connection_intent", connectionId: connection.id },
  }).onConflictDoNothing();
  await logActivity(db, { spaceId: connection.spaceId, actorType: "user", actorId: userId,
    action: "tool_connection.agent_access_granted", entityType: "tool_connection", entityId: connection.id,
    details: { ...(interactionId ? { interactionId } : {}), agentId, profileId: profile.id, tools: tools } });
}
