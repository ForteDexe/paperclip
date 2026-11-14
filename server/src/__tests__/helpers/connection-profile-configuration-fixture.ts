import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { agents, toolConnections, toolProfileBindings, toolProfileEntries, toolProfiles, type Db } from "@outpost/db";
import type { ToolProfileConfiguration, ToolProfileWithDetails } from "@outpost/shared";
import { createProfileProjectionFixture } from "./tool-profile-projection-fixture.js";

export async function createConnectionProfileConfigurationFixture(db: Db, options: Parameters<typeof createProfileProjectionFixture>[1] = {}) {
  const f = await createProfileProjectionFixture(db, options);
  const spaceAgents = await db.select().from(agents).where(eq(agents.spaceId, f.space.id));
  const agentId = spaceAgents[0]!.id;
  const [sibling] = await db.insert(toolConnections).values({ spaceId: f.space.id, applicationId: f.application.id,
    name: "Sibling account", uid: randomUUID(), transport: "mcp_remote", status: "active" }).returning();
  await db.update(toolProfiles).set({ profileKey: `app:${f.connection.id}`, status: "disabled" }).where(eq(toolProfiles.id, f.profiles[0]!.id));
  const metadata = { source: "connection_intent", connectionId: f.connection.id, agentId };
  await db.update(toolProfiles).set({ profileKey: `connection-intent:${f.connection.id}:${agentId}`, metadata }).where(eq(toolProfiles.id, f.profiles[1]!.id));
  const rejected = await db.insert(toolProfiles).values([
    { profileKey: `app:${sibling.id}`, name: "Sibling app" },
    { profileKey: `connection-intent:${sibling.id}:${agentId}`, name: "Sibling intent", metadata: { ...metadata, connectionId: sibling.id } },
    { profileKey: `connection-intent:${f.connection.id}:wrong-key`, name: "Wrong key", metadata },
    { profileKey: `connection-intent:${f.connection.id}:${spaceAgents[1]!.id}`, name: "Wrong binding", metadata: { ...metadata, agentId: spaceAgents[1]!.id } },
    { profileKey: `connection-intent:${f.connection.id}:${spaceAgents[2]!.id}`, name: "Inactive intent", status: "disabled" as const, metadata: { ...metadata, agentId: spaceAgents[2]!.id } },
    { profileKey: `connection-intent:${f.connection.id}:123`, name: "Non-string agent", metadata: { ...metadata, agentId: 123 } },
    { profileKey: `connection-intent:${f.connection.id}:null`, name: "Null agent", metadata: { ...metadata, agentId: null } },
    { profileKey: "unmanaged", name: "Unmanaged", metadata },
    { profileKey: `connection-intent:${f.connection.id}:${spaceAgents[3]!.id}`, name: "Wrong source", metadata: { ...metadata, agentId: spaceAgents[3]!.id, source: "other" } },
    { profileKey: `connection-intent:${f.connection.id}:${spaceAgents[4]!.id}`, name: "No binding", metadata: { ...metadata, agentId: spaceAgents[4]!.id } },
  ].map(profile => ({ spaceId: f.space.id, ...profile }))).returning();
  const bindingAt = new Date("2026-01-01T00:00:00Z");
  await db.insert(toolProfileBindings).values([
    { profileId: f.profiles[0]!.id, targetType: "agent" as const, targetId: agentId, priority: 2 },
    { profileId: f.profiles[0]!.id, targetType: "agent" as const, targetId: spaceAgents[1]!.id, priority: 1 },
    { profileId: f.profiles[1]!.id, targetType: "agent" as const, targetId: agentId, priority: 0 },
    { profileId: f.profiles[1]!.id, targetType: "space" as const, targetId: f.space.id, priority: 3 },
    ...rejected.filter(p => p.name !== "No binding").map(p => ({ profileId: p.id, targetType: "agent" as const, targetId: agentId, priority: 0 })),
  ].map(binding => ({ spaceId: f.space.id, ...binding, createdAt: bindingAt })));
  // Selected profiles can carry selectors outside this account. Keep all rows.
  await db.insert(toolProfileEntries).values({ spaceId: f.space.id, profileId: f.profiles[0]!.id,
    selectorType: "connection", connectionId: sibling.id, effect: "exclude" });
  return { ...f, sibling, agentId, selectedIds: [f.profiles[0]!.id, f.profiles[1]!.id], rejected };
}

/** The old AppDetail/AgentConnectionAccess selection, with only unused derived fields removed. */
export function legacyConnectionConfiguration(profiles: ToolProfileWithDetails[], connectionId: string): ToolProfileConfiguration[] {
  return profiles.filter(profile => {
    const agentId = profile.metadata?.agentId;
    return profile.profileKey === `app:${connectionId}` || (profile.status === "active"
      && profile.metadata?.source === "connection_intent" && profile.metadata.connectionId === connectionId
      && typeof agentId === "string" && profile.profileKey === `connection-intent:${connectionId}:${agentId}`
      && profile.bindings.some(binding => binding.targetType === "agent" && binding.targetId === agentId));
  }).map(({ summary: _summary, newToolsPendingCount: _pending, ...configuration }) => configuration);
}
