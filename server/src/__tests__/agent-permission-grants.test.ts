import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { activityLog, agents, authUsers, spaces, spaceMemberships, createDb,
  principalPermissionGrants, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS } from "@outpost/db";
import { agentPermissionGrantRoutes } from "../routes/agent-permission-grants.js";
import { agentCommentaryRoutes } from "../routes/agent-commentary.js";
import { errorHandler } from "../middleware/error-handler.js";
import { startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import * as activityLogging from "../services/activity-log.js";

describe("Operator agent permission grants", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("agent-permission-grants-");
    db = createDb(database.connectionString);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => { await db?.$client.end(); await database?.cleanup(); });

  async function seed() {
    const spaceId = randomUUID(), agentId = randomUUID(), userId = randomUUID();
    await db.insert(spaces).values({ id: spaceId, name: "Permission grants", issuePrefix: `G${spaceId.slice(0, 6)}` });
    await db.insert(authUsers).values({ id: userId, name: "Owner", email: `${userId}@example.com`,
      createdAt: new Date(), updatedAt: new Date() });
    await db.insert(agents).values({ id: agentId, spaceId, name: "Reader", adapterType: "process", status: "idle" });
    await db.insert(spaceMemberships).values([
      { spaceId, principalType: "user", principalId: userId, membershipRole: "owner", status: "active" },
      { spaceId, principalType: "agent", principalId: agentId, membershipRole: "member", status: "active" },
    ]);
    await db.insert(principalPermissionGrants).values({ spaceId, principalType: "user",
      principalId: userId, permissionKey: "users:manage_permissions" });
    return { spaceId, agentId, userId };
  }
  type Fixture = Awaited<ReturnType<typeof seed>>;
  function app(actor: express.Request["actor"]) {
    const api = express();
    api.use(express.json());
    api.use((req, _res, next) => { req.actor = actor; next(); });
    api.use(agentPermissionGrantRoutes(db));
    api.use(agentCommentaryRoutes(db));
    api.use(errorHandler);
    return api;
  }
  function owner(f: Fixture) {
    return app({ type: "operator", source: "session", userId: f.userId, spaceIds: [f.spaceId],
      memberships: [{ spaceId: f.spaceId, membershipRole: "owner", status: "active" }] });
  }
  const path = (f: Fixture) => `/agents/${f.agentId}/permission-grants`;
  const grant = { permissionKey: "commentary:view", enabled: true };
  const grants = (f: Fixture) => db.select().from(principalPermissionGrants).where(and(
    eq(principalPermissionGrants.spaceId, f.spaceId), eq(principalPermissionGrants.principalType, "agent"),
    eq(principalPermissionGrants.principalId, f.agentId),
  ));

  it("grants and revokes commentary reads while preserving other grants and recording the operator", async () => {
    const f = await seed();
    await db.insert(principalPermissionGrants).values({ spaceId: f.spaceId, principalType: "agent",
      principalId: f.agentId, permissionKey: "tasks:assign", scope: { keep: true } });
    const reader = app({ type: "agent", source: "agent_key", spaceId: f.spaceId, agentId: f.agentId });
    const commentary = `/spaces/${f.spaceId}/agent-commentary`;
    expect((await request(reader).get(commentary)).status).toBe(403);
    const response = await request(owner(f)).patch(path(f)).send(grant);
    expect(response.status, response.text).toBe(200);
    expect(response.body).toEqual({ agentId: f.agentId, spaceId: f.spaceId, ...grant });
    expect((await request(reader).get(commentary)).status).toBe(200);
    expect(await grants(f)).toEqual(expect.arrayContaining([
      expect.objectContaining({ permissionKey: "tasks:assign", scope: { keep: true } }),
      expect.objectContaining({ permissionKey: "commentary:view", scope: null, grantedByUserId: f.userId }),
    ]));
    expect((await request(owner(f)).patch(path(f)).send({ ...grant, enabled: false })).status).toBe(200);
    expect((await request(reader).get(commentary)).status).toBe(403);
    expect(await grants(f)).toEqual([expect.objectContaining({ permissionKey: "tasks:assign", scope: { keep: true } })]);
    const audit = await db.select().from(activityLog).where(and(eq(activityLog.entityId, f.agentId),
      eq(activityLog.action, "agent.permission_grant_updated")));
    expect(audit).toHaveLength(2);
    expect(audit.map(row => row.details)).toEqual(expect.arrayContaining([grant, { ...grant, enabled: false }]));
    expect(audit.every(row => row.actorId === f.userId && row.spaceId === f.spaceId)).toBe(true);
  });

  it("denies agent self-grants, foreign-space owners, and users without permission-management authority", async () => {
    const f = await seed(), foreign = await seed();
    const self = app({ type: "agent", source: "agent_key", spaceId: f.spaceId, agentId: f.agentId });
    expect((await request(self).patch(path(f)).send(grant)).status).toBe(403);
    expect((await request(app({ type: "none", source: "none" })).patch(path(f)).send(grant)).status).toBe(401);
    expect((await request(owner(foreign)).patch(path(f)).send(grant)).status).toBe(404);
    await db.update(spaceMemberships).set({ membershipRole: "viewer" }).where(and(
      eq(spaceMemberships.spaceId, f.spaceId), eq(spaceMemberships.principalId, f.userId)));
    await db.delete(principalPermissionGrants).where(eq(principalPermissionGrants.principalId, f.userId));
    expect((await request(owner(f)).patch(path(f)).send(grant)).status).toBe(403);
    expect(await grants(f)).toEqual([]);
  });

  it("rejects invalid grants and inactive agents or memberships without reactivating them", async () => {
    const f = await seed(), api = owner(f);
    expect((await request(api).patch(path(f)).send({ ...grant, permissionKey: "invalid" })).status).toBe(400);
    expect((await request(api).patch(path(f)).send({ ...grant, scope: { spaceId: "foreign" } })).status).toBe(400);
    await db.update(agents).set({ status: "pending_approval" }).where(eq(agents.id, f.agentId));
    expect((await request(api).patch(path(f)).send(grant)).status).toBe(409);
    await db.update(agents).set({ status: "idle" }).where(eq(agents.id, f.agentId));
    await db.update(spaceMemberships).set({ status: "suspended" }).where(and(
      eq(spaceMemberships.spaceId, f.spaceId), eq(spaceMemberships.principalId, f.agentId)));
    expect((await request(api).patch(path(f)).send(grant)).status).toBe(409);
    expect(await grants(f)).toEqual([]);
    await db.delete(spaceMemberships).where(and(
      eq(spaceMemberships.spaceId, f.spaceId), eq(spaceMemberships.principalId, f.agentId)));
    expect((await request(api).patch(path(f)).send(grant)).status).toBe(409);
  });

  it("serializes concurrent additions of the same grant", async () => {
    const f = await seed(), api = owner(f);
    const responses = await Promise.all([request(api).patch(path(f)).send(grant), request(api).patch(path(f)).send(grant)]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(await grants(f)).toHaveLength(1);
  });

  it("rolls back the grant if its audit record cannot be saved", async () => {
    const f = await seed();
    const failure = vi.spyOn(activityLogging, "logActivity").mockRejectedValueOnce(new Error("Audit storage unavailable"));
    try {
      expect((await request(owner(f)).patch(path(f)).send(grant)).status).toBe(500);
      expect(await grants(f)).toEqual([]);
    } finally { failure.mockRestore(); }
  });
});
