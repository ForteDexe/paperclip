import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  agents, applyPendingMigrations, authUsers, spaces, spaceMemberships, createDb, instanceSettings,
  instanceUserRoles, principalPermissionGrants, resourceLifecycleEvents, type Db,
} from "@outpost/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../__tests__/helpers/embedded-postgres.js";
import { cloudActorHeaderSourceFromHeaders, resolveCloudTenantActor } from "./auth.js";
import { errorHandler } from "./error-handler.js";
import { userProfileRoutes } from "../routes/user-profiles.js";

const support = await getEmbeddedPostgresTestSupport();
const aliasFields = ["name", "email-local", "email", "principal"] as const;
(support.supported ? describe : describe.skip)("Cloud membership synchronization with PostgreSQL", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: Db;
  const clients: Db[] = [];

  function freshDb() {
    const client = createDb(database.connectionString);
    clients.push(client);
    return client;
  }

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("cloud-membership-sync-");
    db = freshDb();
    // Count actual tuple changes, including updates whose values are unchanged.
    await db.execute(sql`create table cloud_sync_write_probe (relation text, operation text)`);
    await db.execute(sql`create function cloud_sync_probe() returns trigger language plpgsql as $$
      begin insert into cloud_sync_write_probe values (TG_TABLE_NAME, TG_OP); return NEW; end $$`);
    await db.execute(sql`create trigger cloud_sync_probe after insert or update on space_memberships
      for each row execute function cloud_sync_probe()`);
    await db.execute(sql`create trigger cloud_sync_probe after insert or update on "user"
      for each row execute function cloud_sync_probe()`);
  }, 90_000);
  afterAll(async () => {
    await Promise.all(clients.map(client => client.$client.end({ timeout: 0 })));
    await database?.cleanup();
  }, 60_000);
  beforeEach(() => {
    process.env.OUTPOST_CLOUD_TENANT_SERVER_TOKEN = "synthetic-cloud-sync-token";
  });
  afterEach(() => {
    delete process.env.OUTPOST_CLOUD_TENANT_SERVER_TOKEN;
    delete process.env.OUTPOST_MANAGED_CONFIG;
  });

  function headers(userId: string = randomUUID(), role = "owner", stackId = `stack-${randomUUID()}`) {
    return {
      "x-outpost-cloud-tenant-token": "synthetic-cloud-sync-token",
      "x-outpost-cloud-user-id": userId,
      "x-outpost-cloud-user-email": `${userId}@example.test`,
      "x-outpost-cloud-stack-id": stackId,
      "x-outpost-cloud-stack-role": role,
    };
  }

  function resolve(client: Db, value: Record<string, string>) {
    return resolveCloudTenantActor(client, cloudActorHeaderSourceFromHeaders(value));
  }

  function profileApp(actor: Express.Request["actor"], client: Db = db) {
    const lookups: Array<{ sql: string; params: unknown[]; returnedRows: number }> = [];
    const observed = new Proxy(client, { get(target, key) {
      if (key !== "select") return Reflect.get(target, key);
      return (...fields: Parameters<Db["select"]>) => {
        const builder = target.select(...fields);
        const from = builder.from.bind(builder);
        builder.from = ((...args: Parameters<typeof from>) => {
          const query = from(...args);
          if (args[0] === spaceMemberships) {
            const execute = query.execute.bind(query);
            query.execute = (async () => {
              const rows = await execute();
              lookups.push({ ...query.toSQL(), returnedRows: rows.length });
              return rows;
            }) as typeof query.execute;
          }
          return query;
        }) as typeof builder.from;
        return builder;
      };
    } });
    const app = express();
    app.use((req, _res, next) => { req.actor = actor; next(); });
    app.use("/api", userProfileRoutes(observed));
    app.use(errorHandler);
    return { app, lookups };
  }

  async function expectProfileAliases(client: Db, field: typeof aliasFields[number], cases: string[]) {
    const actor = await resolve(client, headers());
    const spaceId = actor!.spaceIds![0]!;
    const { app, lookups } = profileApp(actor!, client);
    for (const [index, edge] of cases.entries()) {
      const identity = field === "principal" ? `Case${index}:${edge}` : randomUUID();
      if (field !== "principal") await client.insert(authUsers).values({
        id: identity,
        name: field === "name" ? `Case${index}:${edge}` : "",
        email: field === "email-local" ? `Case${index}:${edge}@example.test`
          : field === "email" ? `@Case${index}:${edge}` : `${identity}@example.test`,
        createdAt: new Date(), updatedAt: new Date(),
      });
      await client.insert(spaceMemberships).values({ spaceId, principalType: "user", principalId: identity });
      const exact = await request(app).get(`/api/spaces/${spaceId}/users/${encodeURIComponent(identity)}/profile`);
      expect(exact.status).toBe(200);
      // The actual response canonical slug is produced by userSlugCandidates;
      // use it as the oracle instead of duplicating its JavaScript regex here.
      const canonicalSlug = exact.body.user.slug;
      lookups.length = 0;
      const fallback = await request(app).get(`/api/spaces/${spaceId}/users/${canonicalSlug}/profile`);
      expect(fallback.status, `${field}: ${JSON.stringify(edge)}`).toBe(200);
      expect(fallback.body.user.id, `${field}: ${JSON.stringify(edge)}`).toBe(identity);
      expect(lookups).toHaveLength(2);
    }
  }

  it("does not update unchanged tuples, returns the input role on an empty RETURNING result, and repairs missing grants", async () => {
    const value = headers();
    const actor = await resolve(db, value);
    const spaceId = actor!.spaceIds![0]!;
    const userId = value["x-outpost-cloud-user-id"];
    const membershipWhere = and(eq(spaceMemberships.spaceId, spaceId), eq(spaceMemberships.principalId, userId));
    const oldUpdatedAt = new Date("2020-01-01T00:00:00Z");
    await db.update(authUsers).set({ updatedAt: oldUpdatedAt }).where(eq(authUsers.id, userId));
    await db.update(spaceMemberships).set({ updatedAt: oldUpdatedAt }).where(membershipWhere);
    const [beforeUser] = await db.select().from(authUsers).where(eq(authUsers.id, userId));
    const [beforeMembership] = await db.select().from(spaceMemberships).where(membershipWhere);
    await db.delete(principalPermissionGrants).where(and(eq(principalPermissionGrants.spaceId, spaceId), eq(principalPermissionGrants.principalId, userId)));
    await db.execute(sql`truncate cloud_sync_write_probe`);
    const second = await resolve(freshDb(), value); // bypass process-local debounce
    expect(second?.memberships?.[0]).toEqual({ spaceId, membershipRole: "owner", status: "active" });
    expect(await db.select().from(authUsers).where(eq(authUsers.id, userId))).toEqual([beforeUser]);
    expect(await db.select().from(spaceMemberships).where(membershipWhere)).toEqual([beforeMembership]);
    expect(await db.execute(sql`select * from cloud_sync_write_probe`)).toEqual([]);
    expect((await db.select().from(principalPermissionGrants).where(and(eq(principalPermissionGrants.spaceId, spaceId), eq(principalPermissionGrants.principalId, userId)))).length).toBeGreaterThan(0);
    await resolve(freshDb(), { ...value, "x-outpost-cloud-user-name": "Changed profile", "x-outpost-cloud-stack-role": "member" });
    const [changedUser] = await db.select().from(authUsers).where(eq(authUsers.id, userId));
    const [changedMembership] = await db.select().from(spaceMemberships).where(membershipWhere);
    expect(changedUser.name).toBe("Changed profile");
    expect(changedUser.updatedAt.getTime()).toBeGreaterThan(oldUpdatedAt.getTime());
    expect(changedMembership.membershipRole).toBe("member");
    expect(changedMembership.updatedAt.getTime()).toBeGreaterThan(oldUpdatedAt.getTime());
  });

  it("preserves runtime invalidation on real membership changes while no-op conflicts produce no invalidation", async () => {
    const value = headers();
    const actor = await resolve(db, value);
    const spaceId = actor!.spaceIds![0]!;
    await db.insert(agents).values({ spaceId, name: "Synthetic sync observer", adapterType: "codex_local" });
    await db.delete(resourceLifecycleEvents).where(eq(resourceLifecycleEvents.spaceId, spaceId));
    await resolve(freshDb(), value);
    expect(await db.select().from(resourceLifecycleEvents).where(eq(resourceLifecycleEvents.spaceId, spaceId))).toEqual([]);
    const demoted = await resolve(db, { ...value, "x-outpost-cloud-stack-role": "member" });
    expect(demoted?.memberships?.[0]?.membershipRole).toBe("member");
    const events = await db.select().from(resourceLifecycleEvents).where(eq(resourceLifecycleEvents.spaceId, spaceId));
    expect(events.some(event => event.resourceType === "agent_runtime" && event.action === "update")).toBe(true);
  });

  it("rechecks imported memberships, stale admin rows and the owner flag inside the write debounce", async () => {
    const value = headers();
    const actor = await resolve(db, value);
    const userId = value["x-outpost-cloud-user-id"];
    const imported = await resolve(db, headers(userId, "member"));
    const importedSpaceId = imported!.spaceIds![0]!;
    await resolve(db, value);
    await db.insert(instanceUserRoles).values({ userId, role: "instance_admin" });
    await db.update(spaceMemberships).set({ status: "inactive" }).where(and(eq(spaceMemberships.spaceId, importedSpaceId), eq(spaceMemberships.principalId, userId)));
    await db.insert(instanceSettings).values({ singletonKey: "default", experimental: { enableOwnerInstanceAdmin: true } })
      .onConflictDoUpdate({ target: instanceSettings.singletonKey, set: { experimental: { enableOwnerInstanceAdmin: true } } });
    const elevated = await resolve(db, value);
    expect(elevated?.isInstanceAdmin).toBe(true);
    expect(elevated?.spaceIds).toEqual(actor!.spaceIds);
    expect(await db.select().from(instanceUserRoles).where(eq(instanceUserRoles.userId, userId))).toEqual([]);
    await db.update(instanceSettings).set({ experimental: { enableOwnerInstanceAdmin: false } });
    expect((await resolve(db, value))?.isInstanceAdmin).toBe(false);
  });

  it("bounds old non-UUID profile and missing-slug lookups to two statements regardless of space size", async () => {
    const userId = `outpost-id:TLqGPuleJpjX:${randomUUID()}`;
    const value = headers(userId);
    const first = await resolve(db, value);
    const spaceId = first!.spaceIds![0]!;
    const oldUpdatedAt = new Date("2020-01-01T00:00:00Z");
    await db.update(spaceMemberships).set({ updatedAt: oldUpdatedAt }).where(and(
      eq(spaceMemberships.spaceId, spaceId), eq(spaceMemberships.principalId, userId),
    ));
    const newerUsers = Array.from({ length: 600 }, () => {
      const id = randomUUID();
      return { id, name: `Newer ${id}`, email: `${id}@example.test`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() };
    });
    await db.insert(authUsers).values(newerUsers);
    await db.insert(spaceMemberships).values(newerUsers.map(user => ({
      spaceId, principalType: "user", principalId: user.id, status: "active", membershipRole: "member",
    })));
    // Retain the former cursor regression fixture: membership order differs
    // within a millisecond, and the target remains beyond the first 200 rows.
    await db.execute(sql`update space_memberships set updated_at = case
      when principal_id = ${userId} then '2020-01-01 00:00:00.000100+00'::timestamptz
      else '2020-01-01 00:00:00.000200+00'::timestamptz end
      where space_id = ${spaceId}`);

    const actor = await resolve(freshDb(), value);
    const [unchanged] = await db.select({ updatedAt: spaceMemberships.updatedAt }).from(spaceMemberships).where(and(
      eq(spaceMemberships.spaceId, spaceId), eq(spaceMemberships.principalId, userId),
    ));
    expect(unchanged.updatedAt).toEqual(oldUpdatedAt);
    const { app, lookups } = profileApp(actor!);
    const response = await request(app).get(`/api/spaces/${spaceId}/users/${encodeURIComponent(userId)}/profile`);
    expect(response.status).toBe(200);
    expect(response.body.user.id).toBe(userId);
    expect(response.body.user.membershipRole).toBe("owner");
    expect(lookups).toHaveLength(1);
    expect(lookups[0].returnedRows).toBe(1);

    lookups.length = 0;
    // userProfilePath normalizes even a non-UUID principal ID before linking.
    const normalizedId = `outpost-id-tlqgpulejpjx-${userId.split(":").at(-1)}`;
    const normalized = await request(app).get(`/api/spaces/${spaceId}/users/${normalizedId}/profile`);
    expect(normalized.status).toBe(200);
    expect(normalized.body.user.id).toBe(userId);
    expect(lookups).toHaveLength(2);
    expect(lookups.every(query => query.returnedRows <= 1 && query.params.at(-1) === 1)).toBe(true);

    lookups.length = 0;
    expect((await request(app).get(`/api/spaces/${spaceId}/users/missing-${randomUUID()}/profile`)).status).toBe(404);
    expect(lookups).toHaveLength(2);
    expect(lookups.every(query => query.returnedRows === 0 && query.params.at(-1) === 1)).toBe(true);

    const outsideSpaceId = randomUUID();
    const outsideUserId = randomUUID();
    await db.insert(spaces).values({ id: outsideSpaceId, name: "Other profile tenant", issuePrefix: `X${outsideSpaceId.slice(0, 7)}` });
    await db.insert(authUsers).values({ id: outsideUserId, name: "Outside user", email: `${outsideUserId}@example.test`, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(spaceMemberships).values({ spaceId: outsideSpaceId, principalType: "user", principalId: outsideUserId });
    lookups.length = 0;
    expect((await request(app).get(`/api/spaces/${spaceId}/users/${outsideUserId}/profile`)).status).toBe(404);
    expect(lookups).toHaveLength(2);
    lookups.length = 0;
    expect((await request(app).get(`/api/spaces/${randomUUID()}/users/${userId}/profile`)).status).toBe(403);
    expect(lookups).toHaveLength(0);
  });

  it("prefers an exact principal ID over a newer namesake and keeps fallback aliases ordered", async () => {
    const actor = await resolve(db, headers());
    const spaceId = actor!.spaceIds![0]!;
    const userId = actor!.userId!;
    const newerId = randomUUID();
    await db.update(spaceMemberships).set({ updatedAt: new Date("2020-01-01T00:00:00Z") }).where(and(
      eq(spaceMemberships.spaceId, spaceId), eq(spaceMemberships.principalId, userId),
    ));
    await db.insert(authUsers).values({ id: newerId, name: userId, email: `${newerId}@example.test`, createdAt: new Date(), updatedAt: new Date() });
    await db.insert(spaceMemberships).values({ spaceId, principalType: "user", principalId: newerId });
    const { app, lookups } = profileApp(actor!);
    expect((await request(app).get(`/api/spaces/${spaceId}/users/${userId}/profile`)).body.user.id).toBe(userId);
    expect(lookups).toHaveLength(1);
    await db.update(authUsers).set({ name: "Shared profile alias" }).where(eq(authUsers.id, userId));
    await db.update(authUsers).set({ name: "Shared profile alias" }).where(eq(authUsers.id, newerId));
    lookups.length = 0;
    expect((await request(app).get(`/api/spaces/${spaceId}/users/shared-profile-alias/profile`)).body.user.id).toBe(newerId);
    expect(lookups).toHaveLength(2);
  });

  it("returns a missing profile's 404 after exactly two membership statements with 601 members", async () => {
    const actor = await resolve(db, headers());
    const spaceId = actor!.spaceIds![0]!;
    await db.insert(spaceMemberships).values(Array.from({ length: 600 }, () => ({
      spaceId, principalType: "user", principalId: randomUUID(),
    })));
    const { app, lookups } = profileApp(actor!);
    expect((await request(app).get(`/api/spaces/${spaceId}/users/missing-${randomUUID()}/profile`)).status).toBe(404);
    expect(lookups).toHaveLength(2);
    expect(lookups.every(query => query.returnedRows === 0 && query.params.at(-1) === 1)).toBe(true);
  });

  it("exhaustively accounts for non-ASCII characters that JavaScript lowercases to ASCII", () => {
    const mappings: Array<[string, string]> = [];
    for (let codePoint = 128; codePoint <= 0x10ffff; codePoint += 1) {
      const character = String.fromCodePoint(codePoint);
      const lowered = character.toLowerCase();
      if (/[a-z]/.test(lowered)) mappings.push([character, lowered]);
    }
    expect(mappings).toEqual([["İ", "i\u0307"], ["K", "k"]]);
  });

  it.each(aliasFields)("matches the route's JavaScript slug oracle for %s aliases", async field => {
    const cases = [" A'B\"C ", "İ", "xİy", "K", "xKy", "I\u0307", "İİ", "AİKB", "Å", "ΣΟΣ", "USER_with:ID", "\uFEFF A\u00A0B \t", "o'reilly", "a\"b", "@example.test", "a@@example.test", "---", "", "👩‍💻"];
    await expectProfileAliases(db, field, cases);
  });

  it("matches JavaScript aliases on SQL_ASCII without corrupting neighboring UTF-8 byte sequences", async () => {
    const databaseName = `cloud_slug_ascii_${randomUUID().replace(/-/g, "")}`;
    const connectionString = new URL(database.connectionString);
    connectionString.pathname = `/${databaseName}`;
    let client: Db | undefined;
    let created = false;
    try {
      await db.$client.unsafe(`CREATE DATABASE ${databaseName} TEMPLATE template0 ENCODING 'SQL_ASCII' LC_COLLATE 'C' LC_CTYPE 'C'`);
      created = true;
      await applyPendingMigrations(connectionString.toString());
      client = createDb(connectionString.toString());
      const [encoding] = await client.$client.unsafe("SHOW server_encoding");
      expect(encoding.server_encoding).toBe("SQL_ASCII");
      const cases = ["A–B", "A—B", "A€B", "AÅB", "A℩B", "A\u2AAAB", "AİB", "AKB", "AİKB", " A'K\"İ B "];
      for (const field of aliasFields) await expectProfileAliases(client, field, cases);

      const actor = await resolve(client, headers());
      const spaceId = actor!.spaceIds![0]!;
      const identity = randomUUID();
      await client.insert(authUsers).values({ id: identity, name: "€", email: "", createdAt: new Date(), updatedAt: new Date() });
      await client.insert(spaceMemberships).values({ spaceId, principalType: "user", principalId: identity });
      const { app, lookups } = profileApp(actor!, client);
      expect((await request(app).get(`/api/spaces/${spaceId}/users/k/profile`)).status).toBe(404);
      expect(lookups).toHaveLength(2);
    } finally {
      await client?.$client.end({ timeout: 0 });
      if (created) await db.$client.unsafe(`DROP DATABASE ${databaseName} WITH (FORCE)`);
    }
  }, 90_000);
});
