import { randomUUID } from "node:crypto";
import { agents, spaces, toolApplications, toolCatalogEntries, toolConnections, toolProfileEntries, toolProfiles, type Db } from "@outpost/db";

export async function createProfileProjectionFixture(db: Db, options: { profiles?: number; tools?: number; rules?: number } = {}) {
  const profileCount = options.profiles ?? 200, toolCount = options.tools ?? 1900, ruleCount = options.rules ?? 380, maxRuleCount = options.rules ?? 695;
  const [space] = await db.insert(spaces).values({ name: "Profile projection fixture", issuePrefix: `PP${randomUUID().slice(0, 6)}` }).returning();
  await db.insert(agents).values(Array.from({ length: 12 }, (_, i) => ({ spaceId: space.id, name: `Agent ${i}` })));
  const [application] = await db.insert(toolApplications).values({ spaceId: space.id, name: "Projection application", type: "mcp_http" }).returning();
  const [connection] = await db.insert(toolConnections).values({ spaceId: space.id, applicationId: application.id, name: "Projection connection", uid: randomUUID(), transport: "mcp_remote", status: "active", enabled: true, healthStatus: "ok" }).returning();
  const catalog = await db.insert(toolCatalogEntries).values(Array.from({ length: toolCount + maxRuleCount }, (_, i) => ({
    spaceId: space.id, applicationId: application.id, connectionId: connection.id,
    name: `tool_${i}`, toolName: `tool_${i}`, versionHash: `v${i}`, riskLevel: "read" as const,
    status: i < toolCount ? "active" as const : "removed" as const,
    firstSeenAt: new Date(i < toolCount ? "2026-01-03T00:00:00Z" : "2026-01-01T00:00:00Z"),
  }))).returning();
  const profiles = await db.insert(toolProfiles).values(Array.from({ length: profileCount }, (_, i) => ({
    spaceId: space.id, profileKey: `selected-${i}`, name: `Selected profile ${i}`, defaultAction: "deny" as const,
    createdAt: new Date("2026-01-02T00:00:00Z"),
  }))).returning();
  for (let i = 0; i < profiles.length; i++) {
    const count = i % 4 < 2 ? maxRuleCount : 2 * ruleCount - maxRuleCount;
    const rules = (i % 2 ? catalog.slice(toolCount, toolCount + count) : catalog.slice(0, count)).map(entry => ({
      spaceId: space.id, profileId: profiles[i]!.id, selectorType: "catalog_entry" as const,
      effect: "include" as const, catalogEntryId: entry.id,
    }));
    for (let offset = 0; offset < rules.length; offset += 500) await db.insert(toolProfileEntries).values(rules.slice(offset, offset + 500));
  }
  return { space, application, connection, catalog: catalog.slice(0, toolCount), profiles };
}
