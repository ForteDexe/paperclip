import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activityLog, spaces, spaceMemberships, instanceUserRoles } from "@outpost/db";
import {
  actorMiddleware,
  humanizeCloudStackSlug,
  isKnownBadCloudSpaceName,
} from "../middleware/auth.js";
import { errorHandler } from "../middleware/error-handler.js";
import { assertSpaceAccess } from "../routes/authz.js";

function queryResult<T>(rows: T) {
  return Object.assign(Promise.resolve(rows), {
    for: () => Promise.resolve(rows),
    orderBy: () => ({ limit: () => Promise.resolve(rows) }),
  });
}

function createSelectChain(rows: unknown[] | ((table: unknown) => unknown[])) {
  return {
    from(table: unknown) {
      const selected = typeof rows === "function" ? rows(table) : rows;
      const where = () => queryResult(selected);
      return { where, innerJoin: () => ({ where }) };
    },
  };
}

function createDb() {
  return {
    select: vi
      .fn()
      .mockImplementationOnce(() => createSelectChain([]))
      .mockImplementationOnce(() => createSelectChain([])),
  } as any;
}

describe("actorMiddleware authenticated session profile", () => {
  const originalCloudTenantToken = process.env.OUTPOST_CLOUD_TENANT_SERVER_TOKEN;

  afterEach(() => {
    if (originalCloudTenantToken === undefined) delete process.env.OUTPOST_CLOUD_TENANT_SERVER_TOKEN;
    else process.env.OUTPOST_CLOUD_TENANT_SERVER_TOKEN = originalCloudTenantToken;
  });

  it("preserves the signed-in user name and email on the operator actor", async () => {
    const app = express();
    app.use(
      actorMiddleware(createDb(), {
        deploymentMode: "authenticated",
        resolveSession: async () => ({
          session: { id: "session-1", userId: "user-1" },
          user: {
            id: "user-1",
            name: "User One",
            email: "user@example.com",
          },
        }),
      }),
    );
    app.get("/actor", (req, res) => {
      res.json(req.actor);
    });

    const res = await request(app).get("/actor");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      type: "operator",
      userId: "user-1",
      userName: "User One",
      userEmail: "user@example.com",
      source: "session",
      spaceIds: [],
      memberships: [],
      isInstanceAdmin: false,
    });
  });

  it("trusts Cloud tenant identity headers and seeds operator access", async () => {
    process.env.OUTPOST_CLOUD_TENANT_SERVER_TOKEN = "tenant-token";
    const inserts: Array<{ values: Record<string, unknown> }> = [];
    const db = {
      insert: vi.fn(() => {
        let own: { values: Record<string, unknown> } | undefined;
        const chain = {
          values(values: Record<string, unknown>) {
            own = { values };
            inserts.push(own);
            return chain;
          },
          onConflictDoUpdate() {
            return chain;
          },
          onConflictDoNothing() {
            return chain;
          },
          returning() {
            return Promise.resolve([{
              spaceId: own?.values.spaceId,
              membershipRole: own?.values.membershipRole,
              status: own?.values.status,
            }]);
          },
        };
        return chain;
      }),
      delete: vi.fn(() => ({ where: () => Promise.resolve(undefined) })),
      select: vi.fn(() => createSelectChain([])),
    } as any;
    db.transaction = vi.fn(async (run: (tx: typeof db) => Promise<unknown>) => run(db));
    const app = express();
    app.use(
      actorMiddleware(db, {
        deploymentMode: "authenticated",
        resolveSession: async () => null,
      }),
    );
    app.get("/actor", (req, res) => {
      res.json(req.actor);
    });

    const res = await request(app)
      .get("/actor")
      .set("x-outpost-cloud-tenant-token", "tenant-token")
      .set("x-outpost-cloud-user-id", "global-user-1")
      .set("x-outpost-cloud-user-email", "owner@example.com")
      .set("x-outpost-cloud-user-name", "Stack Owner")
      .set("x-outpost-cloud-stack-id", "stack-alpha")
      .set("x-outpost-cloud-outpost-space-id", "outpost-stack-alpha")
      .set("x-outpost-cloud-outpost-space-name", "Purple Rain")
      .set("x-outpost-cloud-stack-role", "owner");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      type: "operator",
      userId: "global-user-1",
      userName: "Stack Owner",
      userEmail: "owner@example.com",
      source: "cloud_tenant",
      isInstanceAdmin: false,
      memberships: [expect.objectContaining({ membershipRole: "owner", status: "active" })],
    });
    expect(res.body.spaceIds[0]).toMatch(/^[0-9a-f-]{36}$/);
    // authUsers, spaces, spaceMemberships, the role-default
    // principalPermissionGrants, and the lazily initialized instance setting.
    // The instance setting is read concurrently with the tenant sync, so
    // match inserts by content rather than position.
    expect(inserts).toHaveLength(5);
    expect(inserts.map((insert) => insert.values)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "global-user-1",
        email: "owner@example.com",
        emailVerified: true,
      }),
      expect.objectContaining({ name: "Purple Rain" }),
      expect.objectContaining({ singletonKey: "default" }),
    ]));
  });

  it("lets the cloud tenant actor through assertSpaceAccess for a space it holds a membership row in", async () => {
    process.env.OUTPOST_CLOUD_TENANT_SERVER_TOKEN = "tenant-token";
    // A space created on the instance after provisioning (e.g. by a space
    // import) — the user has a real membership row, but it is not the stack's
    // seeded primary space.
    const importedSpaceId = "33333333-3333-4333-8333-333333333333";
    const unrelatedSpaceId = "44444444-4444-4444-8444-444444444444";
    const insertChain = {
      values() {
        return insertChain;
      },
      onConflictDoUpdate() {
        return insertChain;
      },
      onConflictDoNothing() {
        return insertChain;
      },
      returning() {
        return Promise.resolve([{ spaceId: "space-1", membershipRole: "member", status: "active" }]);
      },
      then(resolve: (value: unknown) => unknown) {
        return Promise.resolve(undefined).then(resolve);
      },
    };
    const db = {
      select: vi.fn(() => ({
        from: (table: unknown) => ({
          where: () =>
            queryResult(
              table === spaceMemberships
                ? [{ spaceId: importedSpaceId, membershipRole: "member", status: "active" }]
                : [],
            ),
        }),
      })),
      insert: vi.fn(() => insertChain),
      delete: vi.fn(() => ({ where: () => Promise.resolve(undefined) })),
    } as any;
    db.transaction = vi.fn(async (run: (tx: typeof db) => Promise<unknown>) => run(db));
    const app = express();
    app.use(
      actorMiddleware(db, {
        deploymentMode: "authenticated",
        resolveSession: async () => null,
      }),
    );
    app.get("/spaces/:spaceId/resource", (req, res) => {
      assertSpaceAccess(req, req.params.spaceId);
      res.json({ ok: true, spaceIds: req.actor.spaceIds });
    });
    app.post("/spaces/:spaceId/resource", (req, res) => {
      assertSpaceAccess(req, req.params.spaceId);
      res.json({ ok: true });
    });
    app.use(errorHandler);

    const cloudHeaders = {
      "x-outpost-cloud-tenant-token": "tenant-token",
      "x-outpost-cloud-user-id": "global-user-1",
      "x-outpost-cloud-user-email": "owner@example.com",
      "x-outpost-cloud-stack-id": "stack-alpha",
      "x-outpost-cloud-stack-role": "member",
    };

    // Reads and writes both reach the imported space through the real
    // membership row (write access also consults actor.memberships).
    const read = await request(app).get(`/spaces/${importedSpaceId}/resource`).set(cloudHeaders);
    expect(read.status).toBe(200);
    expect(read.body.spaceIds).toContain(importedSpaceId);

    const write = await request(app).post(`/spaces/${importedSpaceId}/resource`).set(cloudHeaders);
    expect(write.status).toBe(200);

    // Spaces the user holds no membership row in stay unreachable.
    const denied = await request(app).get(`/spaces/${unrelatedSpaceId}/resource`).set(cloudHeaders);
    expect(denied.status).toBe(403);
  });

  it("repairs a legacy machine space name from the trusted human-name header", async () => {
    process.env.OUTPOST_CLOUD_TENANT_SERVER_TOKEN = "tenant-token";
    const updates: Array<Record<string, unknown>> = [];
    const activities: Array<Record<string, unknown>> = [];
    const insertChain = {
      values() {
        return insertChain;
      },
      onConflictDoUpdate() {
        return insertChain;
      },
      onConflictDoNothing() {
        return insertChain;
      },
      returning() {
        return Promise.resolve([
          { spaceId: "space-1", membershipRole: "owner", status: "active" },
        ]);
      },
      then(resolve: (value: unknown) => unknown) {
        return Promise.resolve(undefined).then(resolve);
      },
    };
    const db = {
      select: vi.fn(() => createSelectChain(table => table === spaces
        ? [{ name: "outpost-stack-purple-rain" }] : [])),
      insert: vi.fn((table: unknown) => {
        if (table !== activityLog) return insertChain;
        return {
          values(values: Record<string, unknown>) {
            activities.push(values);
            return Promise.resolve(undefined);
          },
        };
      }),
      update: vi.fn(() => ({
        set(values: Record<string, unknown>) {
          updates.push(values);
          return {
            where: () => ({
              returning: () => Promise.resolve([{ id: "space-1" }]),
            }),
          };
        },
      })),
      delete: vi.fn(() => ({ where: () => Promise.resolve(undefined) })),
    } as any;
    db.transaction = vi.fn(async (run: (tx: typeof db) => Promise<unknown>) => run(db));
    const app = express();
    app.use(
      actorMiddleware(db, {
        deploymentMode: "authenticated",
        resolveSession: async () => null,
      }),
    );
    app.get("/actor", (req, res) => res.json(req.actor));

    const res = await request(app)
      .get("/actor")
      .set("x-outpost-cloud-tenant-token", "tenant-token")
      .set("x-outpost-cloud-user-id", "global-user-1")
      .set("x-outpost-cloud-user-email", "owner@example.com")
      .set("x-outpost-cloud-stack-id", "stack-purple-rain")
      .set(
        "x-outpost-cloud-outpost-space-id",
        "outpost-stack-purple-rain",
      )
      .set("x-outpost-cloud-outpost-space-name", "Purple Rain")
      .set("x-outpost-cloud-stack-role", "owner");

    expect(res.status).toBe(200);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ name: "Purple Rain" });
    expect(activities).toEqual([
      expect.objectContaining({
        spaceId: expect.any(String),
        actorType: "system",
        actorId: "cloud-tenant-auth",
        action: "space.updated",
        entityType: "space",
        details: expect.objectContaining({
          reason: "legacy_machine_name_repair",
          previousName: "outpost-stack-purple-rain",
          name: "Purple Rain",
        }),
      }),
    ]);
  });

  it("purges a stale instance_admin row so the session path stops elevating the cloud-tenant user", async () => {
    process.env.OUTPOST_CLOUD_TENANT_SERVER_TOKEN = "tenant-token";
    // Simulates a deployment that previously ran the pre-hardening cloud_tenant
    // path: instance_user_roles still holds an instance_admin row for the
    // tenant user, who can also resolve a BetterAuth session for the same id.
    const state = { staleInstanceAdminRow: true };
    const insertChain = {
      values() {
        return insertChain;
      },
      onConflictDoUpdate() {
        return insertChain;
      },
      onConflictDoNothing() {
        return insertChain;
      },
      returning() {
        return Promise.resolve([{ spaceId: "space-1", membershipRole: "owner", status: "active" }]);
      },
      then(resolve: (value: unknown) => unknown) {
        return Promise.resolve(undefined).then(resolve);
      },
    };
    const db = {
      select: vi.fn(() => createSelectChain(table =>
        table === instanceUserRoles && state.staleInstanceAdminRow ? [{ id: "stale-role-row" }] : [])),
      insert: vi.fn(() => insertChain),
      delete: vi.fn((table: unknown) => ({
        where: () => {
          if (table === instanceUserRoles) state.staleInstanceAdminRow = false;
          return Promise.resolve(undefined);
        },
      })),
    } as any;
    db.transaction = vi.fn(async (run: (tx: typeof db) => Promise<unknown>) => run(db));
    const app = express();
    app.use(
      actorMiddleware(db, {
        deploymentMode: "authenticated",
        resolveSession: async () => ({
          session: { id: "session-1", userId: "global-user-1" },
          user: { id: "global-user-1", name: "Stack Owner", email: "owner@example.com" },
        }),
      }),
    );
    app.get("/actor", (req, res) => {
      res.json(req.actor);
    });

    // Control: while the stale row exists, the session path still elevates.
    const before = await request(app).get("/actor");
    expect(before.body).toMatchObject({ source: "session", isInstanceAdmin: true });

    // One trusted-header authentication purges the stale grant.
    const cloud = await request(app)
      .get("/actor")
      .set("x-outpost-cloud-tenant-token", "tenant-token")
      .set("x-outpost-cloud-user-id", "global-user-1")
      .set("x-outpost-cloud-user-email", "owner@example.com")
      .set("x-outpost-cloud-stack-id", "stack-alpha")
      .set("x-outpost-cloud-stack-role", "owner");
    expect(cloud.body).toMatchObject({ source: "cloud_tenant", isInstanceAdmin: false });
    expect(state.staleInstanceAdminRow).toBe(false);

    // The same user no longer gets instance admin via the session path.
    const after = await request(app).get("/actor");
    expect(after.body).toMatchObject({
      source: "session",
      userId: "global-user-1",
      isInstanceAdmin: false,
    });
  });
});

describe("Cloud tenant space naming", () => {
  const ids = {
    spaceId: "11111111-1111-4111-8111-111111111111",
    outpostSpaceId: "outpost-stack-purple-rain",
  };

  it.each([
    "outpost-stack-purple-rain",
    "stack-purple-rain Outpost",
    ids.spaceId,
  ])("repairs the known-bad machine name %s", (name) => {
    expect(isKnownBadCloudSpaceName(name, ids)).toBe(true);
  });

  it.each([
    "Purple Rain",
    "Outpost Stack Purple Rain",
    "The Purple Rain Outpost",
  ])("preserves the genuine space name %s", (name) => {
    expect(isKnownBadCloudSpaceName(name, ids)).toBe(false);
  });

  it("humanizes the stack slug for old harnesses without a name header", () => {
    expect(humanizeCloudStackSlug("stack-purple-rain")).toBe("Purple Rain");
    expect(humanizeCloudStackSlug("outpost-stack-purple-rain")).toBe(
      "Purple Rain",
    );
  });
});
