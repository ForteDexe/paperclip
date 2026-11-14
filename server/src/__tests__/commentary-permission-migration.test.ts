import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spaces, spaceMemberships, createDb, principalPermissionGrants } from "@outpost/db";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

describe("commentary permission upgrade", () => {
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    temporary = await startEmbeddedPostgresTestDatabase("outpost-commentary-permission-");
    db = createDb(temporary.connectionString);
  }, 90_000);

  afterAll(async () => { await temporary?.cleanup(); });

  it("grants existing active humans commentary access once without widening audit or existing scopes", async () => {
    const spaceId = randomUUID(), otherSpaceId = randomUUID();
    await db.insert(spaces).values([
      { id: spaceId, name: "Commentary upgrade", issuePrefix: "UPG" },
      { id: otherSpaceId, name: "Other space", issuePrefix: "OTH" },
    ]);
    const activeHumans = ["owner", "admin", "operator", "viewer", "member", null].map((membershipRole) => ({
      spaceId, principalType: "user", principalId: randomUUID(), membershipRole, status: "active",
    }));
    const excluded = [
      { spaceId, principalType: "user", principalId: randomUUID(), membershipRole: "viewer", status: "inactive" },
      { spaceId, principalType: "agent", principalId: randomUUID(), membershipRole: "member", status: "active" },
      { spaceId: otherSpaceId, principalType: "user", principalId: activeHumans[0].principalId, membershipRole: "owner", status: "inactive" },
    ];
    await db.insert(spaceMemberships).values([...activeHumans, ...excluded]);
    const [existing] = await db.insert(principalPermissionGrants).values({
      spaceId, principalType: "user", principalId: activeHumans[0].principalId,
      permissionKey: "commentary:view", scope: { agentIds: [randomUUID()] }, grantedByUserId: "custom-author",
    }).returning();
    const migration = await readFile(new URL(
      "../../../packages/db/src/migrations/0359_commentary_view_human_defaults.sql", import.meta.url,
    ), "utf8");
    await db.execute(sql.raw(migration));
    const first = await db.select().from(principalPermissionGrants).where(eq(principalPermissionGrants.spaceId, spaceId));
    expect(first).toHaveLength(activeHumans.length);
    expect(first.every((grant) => grant.permissionKey === "commentary:view")).toBe(true);
    expect(first.map((grant) => grant.principalId).sort()).toEqual(activeHumans.map((member) => member.principalId).sort());
    expect(first.find((grant) => grant.id === existing.id)).toEqual(existing);
    expect(await db.select().from(principalPermissionGrants).where(eq(principalPermissionGrants.spaceId, otherSpaceId))).toEqual([]);

    await db.execute(sql.raw(migration));
    const second = await db.select().from(principalPermissionGrants).where(eq(principalPermissionGrants.spaceId, spaceId));
    expect(second.sort((a, b) => a.id.localeCompare(b.id))).toEqual(first.sort((a, b) => a.id.localeCompare(b.id)));
  });
});
