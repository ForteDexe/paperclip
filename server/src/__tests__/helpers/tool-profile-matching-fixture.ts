import { randomUUID } from "node:crypto";
import { agents, spaces, toolApplications, toolCatalogEntries, toolConnections, toolProfileBindings, toolProfileEntries, toolProfiles, type Db } from "@outpost/db";

export async function createToolProfileMatchingFixture(db: Db) {
  const [space] = await db.insert(spaces).values({ name: "Synthetic profile matching", issuePrefix: `BM${randomUUID().slice(0, 6)}` }).returning();
  const spaceAgents = await db.insert(agents).values(Array.from({ length: 12 }, (_, i) => ({ spaceId: space.id, name: `Agent ${i}` }))).returning();
  const agent = spaceAgents[0]!;
  const [app] = await db.insert(toolApplications).values({ spaceId: space.id, name: "Synthetic app", type: "mcp_http" }).returning();
  const [connection] = await db.insert(toolConnections).values({ spaceId: space.id, applicationId: app.id, name: "Synthetic connection", uid: randomUUID(), transport: "mcp_remote" }).returning();
  const catalog = await db.insert(toolCatalogEntries).values(Array.from({ length: 1890 }, (_, i) => ({ spaceId: space.id, applicationId: app.id, connectionId: connection.id, name: `tool_${i}`, toolName: `tool_${i}`, versionHash: `v${i}`, riskLevel: "read" as const }))).returning();
  const [profile] = await db.insert(toolProfiles).values({ spaceId: space.id, profileKey: "selected", name: "Selected tools", defaultAction: "deny" }).returning();
  await db.insert(toolProfileBindings).values({ spaceId: space.id, profileId: profile.id, targetType: "agent", targetId: agent.id });
  await db.insert(toolProfileEntries).values(catalog.slice(0, 1575).map((entry, i) => ({ spaceId: space.id, profileId: profile.id, selectorType: "catalog_entry" as const, catalogEntryId: entry.id, effect: i % 5 === 0 ? "exclude" as const : "include" as const })));
  return { space, agent };
}
