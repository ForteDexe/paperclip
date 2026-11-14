import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInviteRateLimiter } from "./invite-rate-limit.js";
import { eq, sql } from "drizzle-orm";
import { activityLog, authUsers, operatorApiKeys, cliAuthChallenges, spaces, spaceMemberships, createDb, getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "@outpost/db";
import type { Db } from "@outpost/db";
import { operatorAuthService } from "./operator-auth.js";
import { subscribeSpaceLiveEvents } from "./live-events.js";

describe("operatorAuthService touchOperatorApiKey", () => {
  it("retries the audit write after a transient failure", async () => {
    const writes = [Promise.reject(new Error("transient")), Promise.resolve([])];
    const update = vi.fn(() => ({
      set: () => ({
        where: () => writes.shift(),
      }),
    }));
    const service = operatorAuthService({ update } as unknown as Db);

    await expect(service.touchOperatorApiKey("key-1")).rejects.toThrow("transient");
    await expect(service.touchOperatorApiKey("key-1")).resolves.toBeUndefined();

    expect(update).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight audit write across concurrent touches", async () => {
    let releaseWrite: (() => void) | undefined;
    const write = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const update = vi.fn(() => ({
      set: () => ({
        where: () => write,
      }),
    }));
    const service = operatorAuthService({ update } as unknown as Db);

    const first = service.touchOperatorApiKey("key-1");
    const second = service.touchOperatorApiKey("key-1");
    releaseWrite?.();
    await Promise.all([first, second]);

    expect(update).toHaveBeenCalledTimes(1);
  });
});

const external = process.env.OUTPOST_TEST_DATABASE_URL;
const support = external ? { supported: true } : await getEmbeddedPostgresTestSupport();
const databaseSuite = support.supported ? describe : describe.skip;

databaseSuite("CLI challenge authority and transitions (real PostgreSQL)", () => {
  let db: ReturnType<typeof createDb>;
  let temporary: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | undefined;
  beforeAll(async () => {
    if (external) db = createDb(external);
    else {
      temporary = await startEmbeddedPostgresTestDatabase("operator-cli-challenge-");
      db = createDb(temporary.connectionString);
    }
  }, 60_000);
  afterAll(async () => {
    await db?.$client.end();
    await temporary?.cleanup();
  });

  async function fixture() {
    const spaceId = randomUUID(), userId = randomUUID(), otherUserId = randomUUID();
    const now = new Date();
    await db.insert(authUsers).values([userId, otherUserId].map(id => ({
      id, name: "CLI approver", email: `${id}@example.invalid`, createdAt: now, updatedAt: now,
    })));
    await db.insert(spaces).values({ id: spaceId, name: "Private CLI organization", issuePrefix: `C${spaceId.slice(0, 7)}` });
    await db.insert(spaceMemberships).values([userId, otherUserId].map(principalId => ({
      spaceId, principalType: "user", principalId, status: "active", membershipRole: "owner",
    })));
    const service = operatorAuthService(db);
    const created = await service.createCliAuthChallenge({ command: "outpost auth login", requestedAccess: "operator", requestedSpaceId: spaceId });
    return { spaceId, userId, otherUserId, service, ...created };
  }

  async function waitForChallengeLock() {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const rows = await db.execute<{ waiting: boolean }>(sql`
        select exists(select 1 from pg_stat_activity where datname = current_database()
          and pid <> pg_backend_pid() and wait_event_type = 'Lock'
          and query ilike '%cli_auth_challenges%') as waiting
      `);
      if (rows[0]?.waiting) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error("CLI challenge contender did not reach the held database lock");
  }

  it("keeps pending tokens unusable and stores only independent secret digests", async () => {
    const f = await fixture();
    expect(f.challenge.secretHash).not.toBe(f.challenge.pendingKeyHash);
    expect(f.challenge.secretHash).not.toContain(f.challengeSecret);
    expect(f.challenge.pendingKeyHash).not.toContain(f.pendingOperatorToken);
    expect(await f.service.findOperatorApiKeyByToken(f.pendingOperatorToken)).toBeNull();
    expect(await f.service.getCliAuthChallengeBySecret(f.challenge.id, "wrong-secret")).toBeNull();
    await db.update(cliAuthChallenges).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(cliAuthChallenges.id, f.challenge.id));
    expect((await f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userId)).status).toBe("expired");
    expect(await f.service.findOperatorApiKeyByToken(f.pendingOperatorToken)).toBeNull();
  });

  it("retains the first key owner and approver on same-user and competing-user replay", async () => {
    const f = await fixture();
    const first = await f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userId);
    await expect(f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.otherUserId)).rejects.toThrow("another user");
    const repeat = await f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userId);
    expect(repeat.challenge).toEqual(first.challenge);
    const [stored] = await db.select().from(cliAuthChallenges).where(eq(cliAuthChallenges.id, f.challenge.id));
    expect(stored).toEqual(first.challenge);
    const key = await f.service.findOperatorApiKeyByToken(f.pendingOperatorToken);
    expect(key?.userId).toBe(f.userId);
    expect(stored.approvedByUserId).toBe(key?.userId);
    expect(await db.select().from(operatorApiKeys).where(eq(operatorApiKeys.keyHash, f.challenge.pendingKeyHash))).toHaveLength(1);
  });

  it("denies an inaccessible requested space before key creation or audit fallback", async () => {
    const f = await fixture();
    await db.delete(spaceMemberships).where(eq(spaceMemberships.principalId, f.otherUserId));
    await expect(f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.otherUserId)).rejects.toThrow("requested organization");
    expect(await f.service.findOperatorApiKeyByToken(f.pendingOperatorToken)).toBeNull();
    expect(await f.service.resolveOperatorActivitySpaceIds({ userId: f.otherUserId, requestedSpaceId: f.spaceId })).toEqual([]);
  });

  it("rechecks space membership after waiting for the approval lock", async () => {
    const f = await fixture();
    let release!: () => void, locked!: () => void;
    const held = new Promise<void>(resolve => { locked = resolve; });
    const unlock = new Promise<void>(resolve => { release = resolve; });
    const holder = db.transaction(async tx => {
      await tx.execute(sql`select id from cli_auth_challenges where id = ${f.challenge.id} for update`);
      locked(); await unlock;
    });
    await held;
    const approval = f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userId);
    const outcome = approval.then(value => ({ value }), error => ({ error }));
    try {
      await waitForChallengeLock();
      await db.update(spaceMemberships).set({ status: "suspended" }).where(eq(spaceMemberships.principalId, f.userId));
    } finally { release(); await holder; }
    const result = await outcome;
    expect(result).toHaveProperty("error");
    expect("error" in result ? String(result.error) : "").toContain("requested organization");
    expect(await f.service.findOperatorApiKeyByToken(f.pendingOperatorToken)).toBeNull();
  });

  it("serializes cancellation behind an actual approval transaction without cancelling its live key", async () => {
    const f = await fixture();
    let release!: () => void, prepared!: () => void;
    const ready = new Promise<void>(resolve => { prepared = resolve; });
    const unlock = new Promise<void>(resolve => { release = resolve; });
    const gated = Object.create(db) as Db;
    gated.transaction = ((callback: Parameters<Db["transaction"]>[0]) => db.transaction(async tx => {
      const result = await callback(tx);
      prepared(); await unlock;
      return result;
    })) as Db["transaction"];
    const approval = operatorAuthService(gated).approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userId);
    await ready;
    const cancellation = f.service.cancelCliAuthChallenge(f.challenge.id, f.challengeSecret);
    const outcome = cancellation.then(value => ({ value }), error => ({ error }));
    try { await waitForChallengeLock(); }
    finally { release(); await approval; }
    const result = await outcome;
    expect(result).toHaveProperty("value.status", "approved");
    const [stored] = await db.select().from(cliAuthChallenges).where(eq(cliAuthChallenges.id, f.challenge.id));
    expect(stored.cancelledAt).toBeNull();
    expect(stored.approvedByUserId).toBe(f.userId);
    expect(await f.service.findOperatorApiKeyByToken(f.pendingOperatorToken)).toMatchObject({ userId: f.userId });
  });

  it("publishes approval activity only after key, challenge and audit rows commit", async () => {
    const f = await fixture();
    const events: string[] = [];
    const unsubscribe = subscribeSpaceLiveEvents(f.spaceId, event => {
      if (event.payload.action === "operator_api_key.created") events.push(event.payload.actorId as string);
    });
    let release!: () => void, prepared!: () => void;
    const ready = new Promise<void>(resolve => { prepared = resolve; });
    const unlock = new Promise<void>(resolve => { release = resolve; });
    const gated = Object.create(db) as Db;
    gated.transaction = ((callback: Parameters<Db["transaction"]>[0]) => db.transaction(async tx => {
      const result = await callback(tx); prepared(); await unlock; return result;
    })) as Db["transaction"];
    const service = operatorAuthService(gated);
    const approval = service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userId);
    try {
      await ready;
      expect(events).toEqual([]);
      expect(await f.service.findOperatorApiKeyByToken(f.pendingOperatorToken)).toBeNull();
      expect(await db.select().from(activityLog).where(eq(activityLog.actorId, f.userId))).toHaveLength(0);
      release(); await approval;
      expect(events).toEqual([f.userId]);
      expect(await db.select().from(activityLog).where(eq(activityLog.actorId, f.userId))).toHaveLength(1);
      await service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userId);
      expect(events).toEqual([f.userId]);
    } finally { release(); await approval; unsubscribe(); }
  });

  it("never grants a key after cancellation and keeps duplicate cancellation stable", async () => {
    const f = await fixture();
    const first = await f.service.cancelCliAuthChallenge(f.challenge.id, f.challengeSecret);
    expect((await f.service.cancelCliAuthChallenge(f.challenge.id, f.challengeSecret)).challenge).toEqual(first.challenge);
    expect((await f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userId)).status).toBe("cancelled");
    expect(await f.service.findOperatorApiKeyByToken(f.pendingOperatorToken)).toBeNull();
  });

  it("shows the requested space name only to a currently authorized viewer", async () => {
    const f = await fixture();
    expect(await f.service.describeCliAuthChallenge(f.challenge.id, f.challengeSecret, { viewerUserId: f.userId }))
      .toMatchObject({ requestedSpaceName: "Private CLI organization", approvedByUser: null });
    await db.update(spaceMemberships).set({ status: "suspended" }).where(eq(spaceMemberships.principalId, f.otherUserId));
    expect(await f.service.describeCliAuthChallenge(f.challenge.id, f.challengeSecret, { viewerUserId: f.otherUserId }))
      .toMatchObject({ requestedSpaceName: null, approvedByUser: null });
  });

  it("keeps instance-admin approval and current full-Operator key authentication compatible", async () => {
    const f = await fixture();
    const { instanceUserRoles } = await import("@outpost/db");
    await db.delete(spaceMemberships).where(eq(spaceMemberships.principalId, f.userId));
    await db.insert(instanceUserRoles).values({ userId: f.userId, role: "instance_admin" });
    const created = await f.service.createCliAuthChallenge({ command: "outpost auth login", requestedAccess: "instance_admin_required", requestedSpaceId: f.spaceId });
    await expect(f.service.approveCliAuthChallenge(created.challenge.id, created.challengeSecret, f.otherUserId)).rejects.toThrow("Instance admin required");
    const approved = await f.service.approveCliAuthChallenge(created.challenge.id, created.challengeSecret, f.userId);
    expect(approved.status).toBe("approved");
    expect(await f.service.findOperatorApiKeyByToken(created.pendingOperatorToken)).toMatchObject({ userId: f.userId });
    expect((await f.service.resolveOperatorAccess(f.userId)).isInstanceAdmin).toBe(true);
  });

  it("authenticates the real pending, approved and revoked HTTP handshake without synthesizing an anonymous actor", async () => {
    const f = await fixture();
    const [{ default: express }, { default: request }, { actorMiddleware }, { accessRoutes }, { errorHandler }] = await Promise.all([
      import("express"), import("supertest"), import("../middleware/auth.js"), import("../routes/access.js"), import("../middleware/error-handler.js"),
    ]);
    const app = express();
    app.use(express.json());
    app.use(actorMiddleware(db, { deploymentMode: "authenticated", resolveSession: async req => (req.header("X-Test-Session") === f.userId || req.header("X-Test-Session") === f.otherUserId)
      ? { session: { id: "isolated-cli-session" }, user: { id: req.header("X-Test-Session"), name: "CLI approver", email: "synthetic-session@example.invalid" } } as any
      : null }));
    app.use("/api", accessRoutes(db, { deploymentMode: "authenticated", deploymentExposure: "private", bindHost: "127.0.0.1", allowedHostnames: [] }));
    app.use(errorHandler);
    const created = await request(app).post("/api/cli-auth/challenges")
      .send({ command: "outpost auth login", requestedSpaceId: f.spaceId });
    expect(created.status).toBe(201);
    const { id, token, operatorApiToken } = created.body;
    const secondSpaceId = randomUUID();
    await db.insert(spaces).values({ id: secondSpaceId, name: "Second CLI organization", issuePrefix: `S${secondSpaceId.slice(0, 7)}` });
    await db.insert(spaceMemberships).values({ spaceId: secondSpaceId, principalType: "user", principalId: f.userId, status: "active", membershipRole: "owner" });
    expect((await request(app).get("/api/cli-auth/me").set("Authorization", `Bearer ${operatorApiToken}`)).status).toBe(401);
    const anonymous = await request(app).get(`/api/cli-auth/challenges/${id}?token=${token}`);
    expect(anonymous.body).toMatchObject({ status: "pending", canApprove: false, requestedSpaceName: null, approvedByUser: null });
    expect((await request(app).post(`/api/cli-auth/challenges/${id}/approve`).send({ token })).status).toBe(401);
    await db.delete(spaceMemberships).where(eq(spaceMemberships.principalId, f.otherUserId));
    expect((await request(app).post(`/api/cli-auth/challenges/${id}/approve`).set("X-Test-Session", f.otherUserId).send({ token })).status).toBe(403);
    expect(await f.service.findOperatorApiKeyByToken(operatorApiToken)).toBeNull();
    expect(await db.select().from(activityLog).where(eq(activityLog.actorId, f.otherUserId))).toHaveLength(0);
    const browser = await request(app).get(`/api/cli-auth/challenges/${id}?token=${token}`).set("X-Test-Session", f.userId);
    expect(browser.body).toMatchObject({ canApprove: true, requestedSpaceName: "Private CLI organization" });
    await db.execute(sql.raw(`alter table activity_log add constraint operator_cli_audit_failure check (action != 'operator_api_key.created' or space_id != '${secondSpaceId}')`));
    try {
      const failed = await request(app).post(`/api/cli-auth/challenges/${id}/approve`).set("X-Test-Session", f.userId).send({ token });
      expect(failed.status).toBe(500);
      expect(await f.service.findOperatorApiKeyByToken(operatorApiToken)).toBeNull();
      const [pending] = await db.select().from(cliAuthChallenges).where(eq(cliAuthChallenges.id, id));
      expect(pending.approvedAt).toBeNull();
      expect(pending.operatorApiKeyId).toBeNull();
      expect(await db.select().from(activityLog).where(eq(activityLog.actorId, f.userId))).toHaveLength(0);
    } finally { await db.execute(sql`alter table activity_log drop constraint operator_cli_audit_failure`); }
    const unsubscribeFailure = subscribeSpaceLiveEvents(f.spaceId, event => {
      if (event.payload.action === "operator_api_key.created") throw new Error("Synthetic publication failure");
    });
    const secondPublications: string[] = [];
    const unsubscribeSecond = subscribeSpaceLiveEvents(secondSpaceId, event => {
      if (event.payload.action === "operator_api_key.created") secondPublications.push(event.payload.actorId as string);
    });
    try {
      expect((await request(app).post(`/api/cli-auth/challenges/${id}/approve`).set("X-Test-Session", f.userId).send({ token })).status).toBe(200);
      expect(secondPublications).toEqual([f.userId]);
    } finally { unsubscribeFailure(); unsubscribeSecond(); }

    expect((await request(app).post(`/api/cli-auth/challenges/${id}/approve`).set("X-Test-Session", f.userId).send({ token })).status).toBe(200);
    const audit = await db.select().from(activityLog).where(eq(activityLog.actorId, f.userId));
    expect(audit.filter(row => row.action === "operator_api_key.created")).toHaveLength(2);
    expect(new Set(audit.map(row => row.spaceId))).toEqual(new Set([f.spaceId, secondSpaceId]));
    expect(JSON.stringify(audit)).not.toContain(operatorApiToken);
    expect(JSON.stringify(audit)).not.toContain(token);
    const identity = await request(app).get("/api/cli-auth/me").set("Authorization", `Bearer ${operatorApiToken}`);
    expect(identity.body).toMatchObject({ userId: f.userId, source: "operator_key" });
    expect(new Set(identity.body.spaceIds)).toEqual(new Set([f.spaceId, secondSpaceId]));
    expect((await request(app).post("/api/cli-auth/revoke-current").set("Authorization", `Bearer ${operatorApiToken}`)).status).toBe(200);
    expect((await request(app).get("/api/cli-auth/me").set("Authorization", `Bearer ${operatorApiToken}`)).status).toBe(401);
  });

  it.each(["cli_auth_logout", "operator_api_key_lifecycle"])("keeps owner-bound historical revocation audit after membership loss through %s", async revokedVia => {
    const f = await fixture();
    const approved = await f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userId);
    const keyId = approved.challenge.operatorApiKeyId!;
    const foreign = await fixture();
    await db.update(cliAuthChallenges).set({ operatorApiKeyId: keyId, approvedByUserId: foreign.userId, approvedAt: new Date() })
      .where(eq(cliAuthChallenges.id, foreign.challenge.id));
    await db.update(spaceMemberships).set({ status: "suspended" }).where(eq(spaceMemberships.principalId, f.userId));
    expect(await f.service.resolveOperatorActivitySpaceIds({ userId: f.userId, requestedSpaceId: foreign.spaceId })).toEqual([]);
    const [{ default: express }, { default: request }, { actorMiddleware }, { accessRoutes }, { errorHandler }, { activityRoutes }] = await Promise.all([
      import("express"), import("supertest"), import("../middleware/auth.js"), import("../routes/access.js"), import("../middleware/error-handler.js"), import("../routes/activity.js"),
    ]);
    const app = express(); app.use(express.json());
    app.use(actorMiddleware(db, { deploymentMode: "authenticated", resolveSession: async req => (req.header("X-Test-Session") === f.userId || req.header("X-Test-Session") === foreign.userId)
      ? { session: { id: "synthetic-session" }, user: { id: req.header("X-Test-Session"), name: "CLI owner", email: "owner@example.invalid" } } as any : null }));
    app.use("/api", accessRoutes(db, { deploymentMode: "authenticated", deploymentExposure: "private", bindHost: "127.0.0.1", allowedHostnames: [] })); app.use("/api", activityRoutes(db)); app.use(errorHandler);
    const foreignKey = await f.service.createNamedOperatorApiKey({ userId: foreign.userId, name: "Synthetic foreign operator" });
    const forged = await request(app).post(`/api/spaces/${foreign.spaceId}/activity`).set("Authorization", `Bearer ${foreignKey.token}`).send({
      actorType: "user", actorId: f.userId, action: "operator_api_key.created", entityType: "user", entityId: f.userId,
      responsibleUserId: f.userId, responsible_user_id: f.userId, details: { operatorApiKeyId: keyId, responsibleUserId: f.userId },
    });
    expect(forged.status).toBe(201);
    expect(forged.body.responsibleUserId).toBeNull();
    expect(await f.service.revokeOperatorApiKey(keyId, { userId: foreign.userId, revokedVia: "operator_api_key_lifecycle" })).toBeNull();
    const denied = await request(app).delete(`/api/operator-api-keys/${keyId}`).set("X-Test-Session", foreign.userId);
    expect(denied.status).toBe(404);
    expect(await f.service.findOperatorApiKeyByToken(f.pendingOperatorToken)).not.toBeNull();
    const response = revokedVia === "cli_auth_logout"
      ? await request(app).post("/api/cli-auth/revoke-current").set("Authorization", `Bearer ${f.pendingOperatorToken}`).send({ requestedSpaceId: foreign.spaceId })
      : await request(app).delete(`/api/operator-api-keys/${keyId}`).set("X-Test-Session", f.userId);
    expect(response.status).toBe(200);
    expect(await f.service.findOperatorApiKeyByToken(f.pendingOperatorToken)).toBeNull();
    const rows = await db.select().from(activityLog).where(eq(activityLog.action, "operator_api_key.revoked"));
    const matching = rows.filter(row => row.details?.operatorApiKeyId === keyId);
    expect(matching).toHaveLength(1);
    expect(matching[0]).toMatchObject({ spaceId: f.spaceId, actorId: f.userId, details: { operatorApiKeyId: keyId, revokedVia } });
  });

  it("retains server-derived named-key creation context while rejecting public same-owner audit forgeries", async () => {
    const f = await fixture(), foreign = await fixture();
    await f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userId);
    const [{ default: express }, { default: request }, { actorMiddleware }, { accessRoutes }, { activityRoutes }, { errorHandler }] = await Promise.all([
      import("express"), import("supertest"), import("../middleware/auth.js"), import("../routes/access.js"), import("../routes/activity.js"), import("../middleware/error-handler.js"),
    ]);
    const app = express(); app.use(express.json()); app.use(actorMiddleware(db, { deploymentMode: "authenticated", resolveSession: async () => null }));
    app.use("/api", accessRoutes(db, { deploymentMode: "authenticated", deploymentExposure: "private", bindHost: "127.0.0.1", allowedHostnames: [] }));
    app.use("/api", activityRoutes(db)); app.use(errorHandler);
    const created = await request(app).post("/api/operator-api-keys").set("Authorization", `Bearer ${f.pendingOperatorToken}`)
      .send({ name: "Synthetic named key", requestedSpaceId: f.spaceId });
    expect(created.status).toBe(201);
    expect(await db.select().from(cliAuthChallenges).where(eq(cliAuthChallenges.operatorApiKeyId, created.body.id))).toHaveLength(0);
    const foreignKey = await f.service.createNamedOperatorApiKey({ userId: foreign.userId, name: "Synthetic foreign operator" });
    const forged = await request(app).post(`/api/spaces/${foreign.spaceId}/activity`).set("Authorization", `Bearer ${foreignKey.token}`).send({
      actorType: "user", actorId: f.userId, action: "operator_api_key.created", entityType: "user", entityId: f.userId,
      responsibleUserId: f.userId, details: { operatorApiKeyId: created.body.id, responsibleUserId: f.userId },
    });
    expect(forged.status).toBe(201); expect(forged.body.responsibleUserId).toBeNull();
    await db.update(spaceMemberships).set({ status: "suspended" }).where(eq(spaceMemberships.principalId, f.userId));
    expect((await request(app).post("/api/cli-auth/revoke-current").set("Authorization", `Bearer ${created.body.token}`)).status).toBe(200);
    const rows = (await db.select().from(activityLog).where(eq(activityLog.action, "operator_api_key.revoked")))
      .filter(row => row.details?.operatorApiKeyId === created.body.id);
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ spaceId: f.spaceId, actorId: f.userId });
  });

  it("rolls back revocation when a second space audit fails and retries first-only", async () => {
    const f = await fixture();
    const secondSpaceId = randomUUID();
    await db.insert(spaces).values({ id: secondSpaceId, name: "Second revocation context", issuePrefix: `R${secondSpaceId.slice(0, 7)}` });
    await db.insert(spaceMemberships).values({ spaceId: secondSpaceId, principalType: "user", principalId: f.userId, status: "active", membershipRole: "owner" });
    const approved = await f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userId);
    const keyId = approved.challenge.operatorApiKeyId!;
    const [{ default: express }, { default: request }, { actorMiddleware }, { accessRoutes }, { errorHandler }] = await Promise.all([
      import("express"), import("supertest"), import("../middleware/auth.js"), import("../routes/access.js"), import("../middleware/error-handler.js"),
    ]);
    const app = express(); app.use(express.json()); app.use(actorMiddleware(db, { deploymentMode: "authenticated", resolveSession: async () => null }));
    app.use("/api", accessRoutes(db, { deploymentMode: "authenticated", deploymentExposure: "private", bindHost: "127.0.0.1", allowedHostnames: [] })); app.use(errorHandler);
    await db.execute(sql.raw(`alter table activity_log add constraint operator_cli_revoke_failure check (action != 'operator_api_key.revoked' or space_id != '${secondSpaceId}')`));
    try {
      expect((await request(app).post("/api/cli-auth/revoke-current").set("Authorization", `Bearer ${f.pendingOperatorToken}`)).status).toBe(500);
      expect(await f.service.findOperatorApiKeyByToken(f.pendingOperatorToken)).not.toBeNull();
      expect((await db.select().from(activityLog).where(eq(activityLog.actorId, f.userId))).filter(row => row.action === "operator_api_key.revoked")).toHaveLength(0);
    } finally { await db.execute(sql`alter table activity_log drop constraint operator_cli_revoke_failure`); }
    expect((await request(app).post("/api/cli-auth/revoke-current").set("Authorization", `Bearer ${f.pendingOperatorToken}`)).status).toBe(200);
    const revoked = (await db.select().from(activityLog).where(eq(activityLog.actorId, f.userId))).filter(row => row.action === "operator_api_key.revoked");
    expect(new Set(revoked.map(row => row.spaceId))).toEqual(new Set([f.spaceId, secondSpaceId]));
    expect(revoked).toHaveLength(2);
    expect((await request(app).post("/api/cli-auth/revoke-current").set("Authorization", `Bearer ${f.pendingOperatorToken}`)).status).toBe(401);
    expect((await db.select().from(activityLog).where(eq(activityLog.action, "operator_api_key.revoked"))).filter(row => row.details?.operatorApiKeyId === keyId)).toHaveLength(2);
  });

  it("finishes three real CLI logins sharing one limited IP without changing their challenges", async () => {
    const f = await fixture();
    const [{ default: express }, { default: request }, { actorMiddleware }, { accessRoutes }, { errorHandler }] = await Promise.all([
      import("express"), import("supertest"), import("../middleware/auth.js"), import("../routes/access.js"), import("../middleware/error-handler.js"),
    ]);
    const clockStart = Date.now(); let clock = clockStart;
    const limiter = createInviteRateLimiter({ maxRequests: 120, now: () => clock });
    const created: Array<{ id: string; token: string; operatorApiToken: string; expiresAt: string }> = [];
    let throttled = 0, releaseThrottles!: () => void;
    const allThrottled = new Promise<void>(resolve => { releaseThrottles = resolve; });
    const app = express(); app.use(express.json());
    app.use(actorMiddleware(db, { deploymentMode: "authenticated", resolveSession: async req => req.header("X-Test-Session") === f.userId
      ? { session: { id: "synthetic-shared-session" }, user: { id: f.userId, name: "CLI owner", email: "owner@example.invalid" } } as any : null }));
    app.use((req, res, next) => {
      const original = res.json.bind(res);
      res.json = body => { if (req.method === "POST" && req.originalUrl.split("?", 1)[0] === "/api/cli-auth/challenges" && res.statusCode === 201) created.push(body); return original(body); };
      res.on("finish", () => { if (req.method === "GET" && res.statusCode === 429) { throttled++; if (throttled === 3) releaseThrottles(); } }); next();
    });
    app.use("/api", accessRoutes(db, { deploymentMode: "authenticated", deploymentExposure: "private", bindHost: "127.0.0.1", allowedHostnames: [], cliAuthPollRateLimiter: limiter })); app.use(errorHandler);
    const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Synthetic CLI server has no port");
    const apiBase = `http://127.0.0.1:${address.port}`;
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "operator-cli-shared-ip-"));
    const children: Array<ReturnType<typeof spawn>> = [];
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      for (let i = 0; i < 120; i++) expect((await fetch(`${apiBase}/api/cli-auth/challenges/${f.challenge.id}?token=${f.challengeSecret}`)).status).toBe(200);
      clock = clockStart + 59_900;
      const module = new URL("../../../cli/src/client/operator-auth.ts", import.meta.url).href;
      const loader = new URL("../../node_modules/tsx/dist/loader.mjs", import.meta.url).href;
      const outcomes = [0, 1, 2].map(i => {
        const worker = path.join(folder, `client-${i}.mjs`);
        fs.writeFileSync(worker, `import { loginOperatorCli } from ${JSON.stringify(module)}; await loginOperatorCli(${JSON.stringify({ apiBase, requestedAccess: "operator", requestedSpaceId: f.spaceId, storePath: path.join(folder, `auth-${i}.json`), openBrowser: false, print: false })});`, { mode: 0o600 });
        const child = spawn(process.execPath, ["--import", loader, worker], { cwd: folder, stdio: ["ignore", "ignore", "pipe"] }); children.push(child);
        let errors = ""; child.stderr?.on("data", chunk => { errors += chunk.toString(); });
        return new Promise<{ code: number | null; errors: string }>(resolve => child.once("exit", code => resolve({ code, errors })));
      });
      await Promise.race([allThrottled, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Three CLI workers did not reach the real shared-IP limit")), 5000); })]);
      clearTimeout(timeout); expect(created).toHaveLength(3);
      for (const challenge of created) expect((await request(app).post(`/api/cli-auth/challenges/${challenge.id}/approve`).set("X-Test-Session", f.userId).send({ token: challenge.token })).status).toBe(200);
      clock = clockStart + 60_001;
      expect(await Promise.all(outcomes)).toEqual([0, 1, 2].map(() => ({ code: 0, errors: "" })));
      expect(created).toHaveLength(3); expect(throttled).toBe(3);
      for (let i = 0; i < 3; i++) {
        const store = JSON.parse(fs.readFileSync(path.join(folder, `auth-${i}.json`), "utf8"));
        const saved = store.credentials[apiBase];
        expect(created.some(challenge => challenge.operatorApiToken === saved.token)).toBe(true);
        expect(saved.userId).toBe(f.userId);
      }
      for (const challenge of created) {
        const [stored] = await db.select().from(cliAuthChallenges).where(eq(cliAuthChallenges.id, challenge.id));
        expect(stored.expiresAt.toISOString()).toBe(challenge.expiresAt); expect(stored.approvedByUserId).toBe(f.userId);
      }
    } finally {
      clearTimeout(timeout);
      for (const child of children) if (child.exitCode === null) { child.kill("SIGTERM"); await new Promise(resolve => child.once("exit", resolve)); }
      server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); fs.rmSync(folder, { recursive: true, force: true });
    }
  });

  it("omits private organization and approver identity from anonymous capability polling", async () => {
    const f = await fixture();
    const pending = await f.service.describeCliAuthChallenge(f.challenge.id, f.challengeSecret);
    expect(pending?.requestedSpaceName).toBeNull();
    await f.service.approveCliAuthChallenge(f.challenge.id, f.challengeSecret, f.userId);
    const approved = await f.service.describeCliAuthChallenge(f.challenge.id, f.challengeSecret);
    expect(approved).toMatchObject({ status: "approved", requestedSpaceName: null, approvedByUser: null });
    expect(JSON.stringify(approved)).not.toContain(`${f.userId}@example.invalid`);
  });
});
