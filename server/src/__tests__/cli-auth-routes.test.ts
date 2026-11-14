import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInviteRateLimiter, type InviteRateLimiter } from "../services/invite-rate-limit.js";

const mockAccessService = vi.hoisted(() => ({
  isInstanceAdmin: vi.fn(),
  hasPermission: vi.fn(),
  canUser: vi.fn(),
}));

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockOperatorAuthService = vi.hoisted(() => ({
  createCliAuthChallenge: vi.fn(),
  describeCliAuthChallenge: vi.fn(),
  approveCliAuthChallenge: vi.fn(),
  cancelCliAuthChallenge: vi.fn(),
  resolveBoardAccess: vi.fn(),
  resolveBoardActivitySpaceIds: vi.fn(),
  assertCurrentBoardKey: vi.fn(),
  revokeBoardApiKey: vi.fn(),
  listBoardApiKeys: vi.fn(),
  createNamedBoardApiKey: vi.fn(),
  getBoardApiKeyForUser: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  accessService: () => mockAccessService,
  agentService: () => mockAgentService,
  operatorAuthService: () => mockOperatorAuthService,
  logActivity: mockLogActivity,
  notifyCreateApproved: vi.fn(),
  deduplicateAgentName: vi.fn((name: string) => name),
}));

function registerModuleMocks() {
  vi.doMock("../routes/authz.js", async () => vi.importActual("../routes/authz.js"));

  vi.doMock("../services/index.js", () => ({
    accessService: () => mockAccessService,
    agentService: () => mockAgentService,
    operatorAuthService: () => mockOperatorAuthService,
    logActivity: mockLogActivity,
    notifyCreateApproved: vi.fn(),
    deduplicateAgentName: vi.fn((name: string) => name),
  }));
}

let appImportCounter = 0;

async function createApp(actor: any, db: any = {} as any, options: { authPublicBaseUrl?: string; cliAuthCreateRateLimiter?: InviteRateLimiter; cliAuthPollRateLimiter?: InviteRateLimiter } = {}) {
  appImportCounter += 1;
  const routeModulePath = `../routes/access.js?cli-auth-routes-${appImportCounter}`;
  const middlewareModulePath = `../middleware/index.js?cli-auth-routes-${appImportCounter}`;
  const [{ accessRoutes }, { errorHandler }] = await Promise.all([
    import(routeModulePath) as Promise<typeof import("../routes/access.js")>,
    import(middlewareModulePath) as Promise<typeof import("../middleware/index.js")>,
  ]);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = {
      ...actor,
      spaceIds: Array.isArray(actor.spaceIds) ? [...actor.spaceIds] : actor.spaceIds,
      memberships: Array.isArray(actor.memberships)
        ? actor.memberships.map((membership: unknown) =>
            typeof membership === "object" && membership !== null
              ? { ...membership }
              : membership,
          )
        : actor.memberships,
    };
    next();
  });
  app.use(
    "/api",
    accessRoutes(db, {
      deploymentMode: "authenticated",
      deploymentExposure: "private",
      bindHost: "127.0.0.1",
      allowedHostnames: [],
      ...options,
    }),
  );
  app.use(errorHandler);
  return app;
}

describe("cli auth routes", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.doUnmock("../services/index.js");
    vi.doUnmock("../routes/authz.js");
    vi.doUnmock("../routes/access.js");
    vi.doUnmock("../middleware/index.js");
    registerModuleMocks();
    vi.resetAllMocks();
    // Cold route transforms are fixture setup, not HTTP request latency.
    // Use the hook budget while preserving the request tests' normal timeout.
    await Promise.all([import("../routes/access.js"), import("../middleware/index.js")]);
  });

  it("creates a CLI auth challenge with approval metadata", async () => {
    mockOperatorAuthService.createCliAuthChallenge.mockResolvedValue({
      challenge: {
        id: "12345678-1234-4123-8123-123456789abc",
        expiresAt: new Date("2026-03-23T13:00:00.000Z"),
      },
      challengeSecret: "pcp_cli_auth_secret",
      pendingBoardToken: "pcp_board_token",
    });

    const app = await createApp({ type: "none", source: "none" });
    const res = await request(app)
      .post("/api/cli-auth/challenges")
      .send({
        command: "outpost space import",
        clientName: "outpost cli",
        requestedAccess: "operator",
      });

    expect(res.status, res.text || JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      id: "12345678-1234-4123-8123-123456789abc",
      token: "pcp_cli_auth_secret",
      approvalPath: "/cli-auth/12345678-1234-4123-8123-123456789abc?token=pcp_cli_auth_secret",
      pollPath: "/cli-auth/challenges/12345678-1234-4123-8123-123456789abc",
      expiresAt: "2026-03-23T13:00:00.000Z",
    });
    expect(res.body.operatorApiToken).toBe("pcp_board_token");
    expect(res.body.approvalUrl).toContain("/cli-auth/12345678-1234-4123-8123-123456789abc?token=pcp_cli_auth_secret");
  });

  it("uses the configured public origin for CLI approval behind an upstream proxy", async () => {
    mockOperatorAuthService.createCliAuthChallenge.mockResolvedValue({
      challenge: {
        id: "12345678-1234-4123-8123-123456789abc",
        expiresAt: new Date(Date.now() + 60_000),
      },
      challengeSecret: "pcp_cli_auth_secret",
      pendingBoardToken: "pcp_board_token",
    });
    const app = await createApp({ type: "none", source: "none" }, {}, {
      authPublicBaseUrl: "https://workspace.example.com/",
    });
    const res = await request(app)
      .post("/api/cli-auth/challenges")
      .set("Host", "upstream.example.net")
      .set("X-Forwarded-Host", "upstream.example.net")
      .set("X-Forwarded-Proto", "https")
      .send({ command: "outpost auth login", requestedAccess: "operator" });

    expect(res.status).toBe(201);
    expect(res.body.approvalUrl).toBe(
      `https://workspace.example.com${res.body.approvalPath}`,
    );
  });

  it("bounds anonymous create and poll independently without trusting spoofed forwarding headers", async () => {
    let now = 1_000;
    mockOperatorAuthService.createCliAuthChallenge.mockResolvedValue({
      challenge: { id: "12345678-1234-4123-8123-123456789abc", expiresAt: new Date(Date.now() + 60_000) },
      challengeSecret: "pcp_cli_auth_secret", pendingBoardToken: "pcp_board_token",
    });
    mockOperatorAuthService.describeCliAuthChallenge.mockResolvedValue({ id: "12345678-1234-4123-8123-123456789abc", status: "pending", requestedAccess: "operator" });
    const app = await createApp({ type: "none", source: "none" }, {}, {
      cliAuthCreateRateLimiter: createInviteRateLimiter({ maxRequests: 2, now: () => now }),
      cliAuthPollRateLimiter: createInviteRateLimiter({ maxRequests: 2, now: () => now }),
    });
    const payload = { command: "outpost auth login", requestedAccess: "operator" };
    for (let i = 0; i < 2; i++) expect((await request(app).post("/api/cli-auth/challenges").set("X-Forwarded-For", `198.51.100.${i}`).send(payload)).status).toBe(201);
    const blocked = await request(app).post("/api/cli-auth/challenges").set("X-Forwarded-For", "203.0.113.7").send(payload);
    expect(blocked.status).toBe(429);
    expect(blocked.headers["retry-after"]).toBe("60");
    expect(blocked.headers["cache-control"]).toBe("no-store");
    expect(blocked.headers["referrer-policy"]).toBe("no-referrer");
    expect(mockOperatorAuthService.createCliAuthChallenge).toHaveBeenCalledTimes(2);
    const path = "/api/cli-auth/challenges/12345678-1234-4123-8123-123456789abc?token=pcp_cli_auth_secret";
    for (let i = 0; i < 2; i++) expect((await request(app).get(path).set("X-Forwarded-For", `198.51.100.${i}`)).status).toBe(200);
    expect((await request(app).get(path).set("X-Forwarded-For", "203.0.113.8")).status).toBe(429);
    expect(mockOperatorAuthService.describeCliAuthChallenge).toHaveBeenCalledTimes(2);
    now += 60_000;
    expect((await request(app).post("/api/cli-auth/challenges").send(payload)).status).toBe(201);
    expect((await request(app).get(path)).status).toBe(200);
  });

  it("preserves the normal one-second CLI poll cadence throughout the ten-minute challenge", async () => {
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    mockOperatorAuthService.describeCliAuthChallenge.mockResolvedValue({ id: "12345678-1234-4123-8123-123456789abc", status: "pending", requestedAccess: "operator" });
    const app = await createApp({ type: "none", source: "none" });
    try {
      for (let i = 0; i < 600; i++) {
        const response = await request(app).get("/api/cli-auth/challenges/12345678-1234-4123-8123-123456789abc?token=pcp_cli_auth_secret");
        expect(response.status).toBe(200);
        expect(response.headers["x-ratelimit-limit"]).toBe("120");
        now += 1_000;
      }
    } finally { vi.restoreAllMocks(); }
  });

  it("keeps challenge capabilities out of HTTP caches and referrers", async () => {
    mockOperatorAuthService.createCliAuthChallenge.mockResolvedValue({
      challenge: { id: "12345678-1234-4123-8123-123456789abc", expiresAt: new Date(Date.now() + 60_000) },
      challengeSecret: "pcp_cli_auth_secret", pendingBoardToken: "pcp_board_token",
    });
    mockOperatorAuthService.describeCliAuthChallenge.mockResolvedValue({ id: "12345678-1234-4123-8123-123456789abc", status: "pending", requestedAccess: "operator" });
    const app = await createApp({ type: "none", source: "none" });
    const responses = [
      await request(app).post("/api/cli-auth/challenges").send({ command: "outpost auth login" }),
      await request(app).get("/api/cli-auth/challenges/12345678-1234-4123-8123-123456789abc?token=pcp_cli_auth_secret"),
      await request(app).get("/api/cli-auth/challenges/12345678-1234-4123-8123-123456789abc"),
      await request(app).get("/api/cli-auth/challenges/not-a-uuid?token=pcp_cli_auth_secret"),
      await request(app).post("/api/cli-auth/challenges/12345678-1234-4123-8123-123456789abc/approve").send({ token: "pcp_cli_auth_secret" }),
    ];
    for (const response of responses) {
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.headers["referrer-policy"]).toBe("no-referrer");
    }
  });

  it("does not offer approval for an inaccessible requested organization", async () => {
    mockOperatorAuthService.describeCliAuthChallenge.mockResolvedValue({
      id: "12345678-1234-4123-8123-123456789abc", status: "pending", requestedAccess: "operator", requestedSpaceId: "space-private",
    });
    const app = await createApp({ type: "operator", source: "session", userId: "user-1", spaceIds: ["space-public"] });
    const response = await request(app).get("/api/cli-auth/challenges/12345678-1234-4123-8123-123456789abc?token=pcp_cli_auth_secret");
    expect(response.body.canApprove).toBe(false);
  });

  it("does not duplicate key-creation audit on a same-user approval retry", async () => {
    mockOperatorAuthService.approveCliAuthChallenge.mockResolvedValue({
      status: "approved", created: false,
      challenge: { id: "12345678-1234-4123-8123-123456789abc", operatorApiKeyId: "operator-key-1", requestedAccess: "operator", expiresAt: new Date(Date.now() + 60_000) },
    });
    mockOperatorAuthService.resolveBoardActivitySpaceIds.mockResolvedValue(["space-1"]);
    const app = await createApp({ type: "operator", source: "session", userId: "user-1" });
    const response = await request(app).post("/api/cli-auth/challenges/12345678-1234-4123-8123-123456789abc/approve").send({ token: "pcp_cli_auth_secret" });
    expect(response.status).toBe(200);
    expect(response.body.approved).toBe(true);
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("rejects anonymous access to generic skill documents", async () => {
    const indexApp = await createApp({ type: "none", source: "none" });
    const skillApp = await createApp({ type: "none", source: "none" });

    const indexRes = await request(indexApp).get("/api/skills/index");
    const skillRes = await request(skillApp).get("/api/skills/outpost");

    expect(indexRes.status, JSON.stringify(indexRes.body)).toBe(401);
    expect(skillRes.status, skillRes.text || JSON.stringify(skillRes.body)).toBe(401);
  });

  it("serves the invite-scoped outpost skill anonymously for active invites", async () => {
    const invite = {
      id: "invite-1",
      spaceId: "space-1",
      inviteType: "space_join",
      allowedJoinTypes: "agent",
      tokenHash: "hash",
      defaultsPayload: null,
      expiresAt: new Date(Date.now() + 60_000),
      invitedByUserId: null,
      revokedAt: null,
      acceptedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([invite]),
        })),
      })),
    };

    const app = await createApp({ type: "none", source: "none" }, db);
    const res = await request(app).get("/api/invites/token-123/skills/outpost");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/markdown");
    expect(res.text).toContain("# Outpost Skill");
  });

  it("marks challenge status as requiring sign-in for anonymous viewers", async () => {
    mockOperatorAuthService.describeCliAuthChallenge.mockResolvedValue({
      id: "12345678-1234-4123-8123-123456789abc",
      status: "pending",
      command: "outpost space import",
      clientName: "outpost cli",
      requestedAccess: "operator",
      requestedSpaceId: null,
      requestedSpaceName: null,
      approvedAt: null,
      cancelledAt: null,
      expiresAt: "2026-03-23T13:00:00.000Z",
      approvedByUser: null,
    });

    const app = await createApp({ type: "none", source: "none" });
    const res = await request(app).get("/api/cli-auth/challenges/12345678-1234-4123-8123-123456789abc?token=pcp_cli_auth_secret");

    expect(res.status).toBe(200);
    expect(res.body.requiresSignIn).toBe(true);
    expect(res.body.canApprove).toBe(false);
  });

  it.each([
    ["cloud_tenant", "operator", false, false, true],
    ["cloud_tenant", "instance_admin_required", false, false, false],
    ["session", "operator", false, false, true],
    ["operator_api_key", "operator", false, true, false],
  ])("reports CLI approval for %s requesting %s", async (source, requestedAccess, isInstanceAdmin, requiresSignIn, canApprove) => {
    mockOperatorAuthService.describeCliAuthChallenge.mockResolvedValue({
      id: "12345678-1234-4123-8123-123456789abc", status: "pending", requestedAccess,
    });
    const app = await createApp({ type: "operator", source, userId: "user-1", isInstanceAdmin });
    const res = await request(app).get("/api/cli-auth/challenges/12345678-1234-4123-8123-123456789abc?token=pcp_cli_auth_secret");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ requiresSignIn, canApprove });
  });

  it.each(["PASTE_ID_HERE", "not-a-uuid"])("rejects malformed challenge ID %s before calling the service", async (id) => {
    const app = await createApp({ type: "operator", userId: "user-1", source: "session" });
    const responses = [
      await request(app).get(`/api/cli-auth/challenges/${id}?token=pcp_cli_auth_secret`),
      await request(app).post(`/api/cli-auth/challenges/${id}/approve`).send({ token: "pcp_cli_auth_secret" }),
      await request(app).post(`/api/cli-auth/challenges/${id}/cancel`).send({ token: "pcp_cli_auth_secret" }),
    ];
    for (const response of responses) {
      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Invalid CLI auth challenge ID");
    }
    expect(mockOperatorAuthService.describeCliAuthChallenge).not.toHaveBeenCalled();
    expect(mockOperatorAuthService.approveCliAuthChallenge).not.toHaveBeenCalled();
    expect(mockOperatorAuthService.cancelCliAuthChallenge).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("requires authentication before approving even a malformed challenge ID", async () => {
    const app = await createApp({ type: "none", source: "none" });
    const res = await request(app)
      .post("/api/cli-auth/challenges/PASTE_ID_HERE/approve")
      .send({ token: "pcp_cli_auth_secret" });
    expect(res.status).toBe(401);
    expect(mockOperatorAuthService.approveCliAuthChallenge).not.toHaveBeenCalled();
  });

  it("preserves missing-secret and unknown-challenge responses", async () => {
    const app = await createApp({ type: "none", source: "none" });
    const path = "/api/cli-auth/challenges/12345678-1234-4123-8123-123456789abc";
    const missing = await request(app).get(path);
    expect(missing.status).toBe(404);
    expect(mockOperatorAuthService.describeCliAuthChallenge).not.toHaveBeenCalled();
    mockOperatorAuthService.describeCliAuthChallenge.mockResolvedValue(null);
    const unknown = await request(app).get(`${path}?token=wrong-secret`);
    expect(unknown.status).toBe(404);
  });

  it("cancels a valid challenge and preserves path whitespace normalization", async () => {
    mockOperatorAuthService.cancelCliAuthChallenge.mockResolvedValue({ status: "cancelled" });
    const app = await createApp({ type: "none", source: "none" });
    const id = "12345678-1234-4123-8123-123456789ABC";
    const res = await request(app)
      .post(`/api/cli-auth/challenges/${encodeURIComponent(` ${id} `)}/cancel`)
      .send({ token: "pcp_cli_auth_secret" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "cancelled", cancelled: true });
    expect(mockOperatorAuthService.cancelCliAuthChallenge).toHaveBeenCalledWith(id, "pcp_cli_auth_secret");
  });

  it("approves a CLI auth challenge for a signed-in operator user", async () => {
    mockOperatorAuthService.approveCliAuthChallenge.mockResolvedValue({
      status: "approved",
      challenge: {
        id: "12345678-1234-4123-8123-123456789abc",
        operatorApiKeyId: "operator-key-1",
        requestedAccess: "operator",
        requestedSpaceId: "space-1",
        expiresAt: new Date("2026-03-23T13:00:00.000Z"),
      },
    });
    mockOperatorAuthService.resolveBoardAccess.mockResolvedValue({
      user: { id: "user-1", name: "User One", email: "user@example.com" },
      spaceIds: ["space-1"],
      isInstanceAdmin: false,
    });
    mockOperatorAuthService.resolveBoardActivitySpaceIds.mockResolvedValue(["space-1"]);

    const app = await createApp({
      type: "operator",
      userId: "user-1",
      source: "session",
      isInstanceAdmin: false,
      spaceIds: ["space-1"],
    });
    const res = await request(app)
      .post("/api/cli-auth/challenges/12345678-1234-4123-8123-123456789abc/approve")
      .send({ token: "pcp_cli_auth_secret" });

    expect(res.status).toBe(200);
    expect(mockOperatorAuthService.approveCliAuthChallenge).toHaveBeenCalledWith(
      "12345678-1234-4123-8123-123456789abc",
      "pcp_cli_auth_secret",
      "user-1",
    );
    expect(mockOperatorAuthService.resolveBoardActivitySpaceIds).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("delegates instance-admin approval and atomic auditing to the service", async () => {
    mockOperatorAuthService.approveCliAuthChallenge.mockResolvedValue({
      status: "approved",
      challenge: {
        id: "12345678-1234-4123-8123-123456789def",
        operatorApiKeyId: "operator-key-2",
        requestedAccess: "instance_admin_required",
        requestedSpaceId: null,
        expiresAt: new Date("2026-03-23T13:00:00.000Z"),
      },
    });
    mockOperatorAuthService.resolveBoardActivitySpaceIds.mockResolvedValue(["space-a", "space-b"]);

    const app = await createApp({
      type: "operator",
      userId: "admin-1",
      source: "session",
      isInstanceAdmin: true,
      spaceIds: [],
    });
    const res = await request(app)
      .post("/api/cli-auth/challenges/12345678-1234-4123-8123-123456789def/approve")
      .send({ token: "pcp_cli_auth_secret" });

    expect(res.status).toBe(200);
    expect(mockOperatorAuthService.approveCliAuthChallenge).toHaveBeenCalledWith(
      "12345678-1234-4123-8123-123456789def", "pcp_cli_auth_secret", "admin-1",
    );
    expect(mockOperatorAuthService.resolveBoardActivitySpaceIds).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("delegates owner-bound revocation and atomic audit to the service", async () => {
    mockOperatorAuthService.assertCurrentBoardKey.mockResolvedValue({
      id: "operator-key-3",
      userId: "admin-2",
    });
    mockOperatorAuthService.resolveBoardActivitySpaceIds.mockResolvedValue(["space-z"]);

    const app = await createApp({
      type: "operator",
      userId: "admin-2",
      keyId: "operator-key-3",
      source: "operator_key",
      isInstanceAdmin: true,
      spaceIds: [],
    });
    const res = await request(app).post("/api/cli-auth/revoke-current").send({});

    expect(res.status).toBe(200);
    expect(mockOperatorAuthService.revokeBoardApiKey).toHaveBeenCalledWith("operator-key-3", {
      userId: "admin-2", revokedVia: "cli_auth_logout",
    });
    expect(mockOperatorAuthService.resolveBoardActivitySpaceIds).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("creates a named operator API key and logs audit activity", async () => {
    mockOperatorAuthService.createNamedBoardApiKey.mockResolvedValue({
      id: "operator-key-4",
      name: "external-admin",
      token: "pcp_board_plaintext",
      createdAt: new Date("2026-05-23T12:00:00.000Z"),
      lastUsedAt: null,
      revokedAt: null,
      expiresAt: new Date("2026-06-23T12:00:00.000Z"),
    });
    mockOperatorAuthService.resolveBoardActivitySpaceIds.mockResolvedValue(["11111111-1111-4111-8111-111111111111"]);

    const app = await createApp({
      type: "operator",
      userId: "user-1",
      source: "operator_key",
      isInstanceAdmin: false,
      spaceIds: ["11111111-1111-4111-8111-111111111111"],
    });
    const res = await request(app)
      .post("/api/operator-api-keys")
      .send({
        name: "external-admin",
        requestedSpaceId: "11111111-1111-4111-8111-111111111111",
        expiresAt: "2026-06-23T12:00:00.000Z",
      });

    expect(res.status, res.text || JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      id: "operator-key-4",
      name: "external-admin",
      token: "pcp_board_plaintext",
      expiresAt: "2026-06-23T12:00:00.000Z",
    });
    expect(mockOperatorAuthService.createNamedBoardApiKey).toHaveBeenCalledWith({
      userId: "user-1",
      name: "external-admin",
      expiresAt: new Date("2026-06-23T12:00:00.000Z"),
    });
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        spaceId: "11111111-1111-4111-8111-111111111111",
        action: "operator_api_key.created",
        details: expect.objectContaining({ name: "external-admin" }),
      }),
    );
  });

  it("lists and revokes named operator API keys for the current operator user", async () => {
    const keyId = "55555555-5555-4555-8555-555555555555";
    mockOperatorAuthService.listBoardApiKeys.mockResolvedValue([
      {
        id: keyId,
        name: "external-admin",
        createdAt: new Date("2026-05-23T12:00:00.000Z"),
        lastUsedAt: null,
        revokedAt: null,
        expiresAt: null,
      },
    ]);
    mockOperatorAuthService.getBoardApiKeyForUser.mockResolvedValue({
      id: keyId,
      userId: "user-1",
      name: "external-admin",
    });
    mockOperatorAuthService.revokeBoardApiKey.mockResolvedValue({
      id: keyId,
      userId: "user-1",
      name: "external-admin",
    });
    mockOperatorAuthService.resolveBoardActivitySpaceIds.mockResolvedValue(["space-1"]);

    const app = await createApp({
      type: "operator",
      userId: "user-1",
      source: "operator_key",
      isInstanceAdmin: false,
      spaceIds: ["space-1"],
    });

    const listRes = await request(app).get("/api/operator-api-keys");
    expect(listRes.status).toBe(200);
    expect(listRes.body[0]).toMatchObject({ id: keyId, name: "external-admin" });
    expect(mockOperatorAuthService.listBoardApiKeys).toHaveBeenCalledWith(
      "user-1",
      { includeInactive: false },
    );

    const revokeRes = await request(app).delete(`/api/operator-api-keys/${keyId}`);
    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body).toEqual({ ok: true, keyId });
    expect(mockOperatorAuthService.revokeBoardApiKey).toHaveBeenCalledWith(keyId, {
      userId: "user-1", revokedVia: "operator_api_key_lifecycle",
    });
    expect(mockOperatorAuthService.resolveBoardActivitySpaceIds).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("rejects malformed operator API key IDs before database lookup", async () => {
    const app = await createApp({
      type: "operator",
      userId: "user-1",
      source: "operator_key",
      isInstanceAdmin: false,
      spaceIds: ["space-1"],
    });

    const res = await request(app).delete("/api/operator-api-keys/not-a-uuid");

    expect(res.status).toBe(400);
    expect(mockOperatorAuthService.getBoardApiKeyForUser).not.toHaveBeenCalled();
    expect(mockOperatorAuthService.revokeBoardApiKey).not.toHaveBeenCalled();
  });
});
