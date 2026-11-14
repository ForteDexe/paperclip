import { and, eq, or } from "drizzle-orm";
import { toolConnections, toolConnectionInstalls, toolProfiles, toolProfileBindings, type Db } from "@outpost/db";
import type { PluginAgentConnectionAssignments } from "@outpost/plugin-sdk";
import { unprocessable } from "../errors.js";

export async function pluginAgentConnectionAssignments(db: Db, spaceId: string, agentId: string, features: PluginAgentConnectionAssignments["features"]): Promise<PluginAgentConnectionAssignments> {
  const [connections, profiles] = await Promise.all([
    db.selectDistinct({ id: toolConnections.id, name: toolConnections.name, transport: toolConnections.transport,
      enabled: toolConnections.enabled, status: toolConnections.status })
      .from(toolConnectionInstalls).innerJoin(toolConnections, and(eq(toolConnections.id, toolConnectionInstalls.connectionId), eq(toolConnections.spaceId, spaceId)))
      .where(and(eq(toolConnectionInstalls.spaceId, spaceId), or(
        and(eq(toolConnectionInstalls.targetType, "agent"), eq(toolConnectionInstalls.targetId, agentId)),
        and(eq(toolConnectionInstalls.targetType, "space"), eq(toolConnectionInstalls.targetId, spaceId)))))
      .orderBy(toolConnections.id).limit(513),
    db.selectDistinct({ id: toolProfiles.id }).from(toolProfileBindings)
      .innerJoin(toolProfiles, and(eq(toolProfiles.id, toolProfileBindings.profileId), eq(toolProfiles.spaceId, spaceId), eq(toolProfiles.status, "active")))
      .where(and(eq(toolProfileBindings.spaceId, spaceId), or(
        and(eq(toolProfileBindings.targetType, "agent"), eq(toolProfileBindings.targetId, agentId)),
        and(eq(toolProfileBindings.targetType, "space"), eq(toolProfileBindings.targetId, spaceId)))))
      .orderBy(toolProfiles.id).limit(129),
  ]);
  if (connections.length > 512 || profiles.length > 128) throw unprocessable("Agent connection assignments exceed the synchronization limit");
  return { features, connections, profileIds: profiles.map(profile => profile.id) };
}
