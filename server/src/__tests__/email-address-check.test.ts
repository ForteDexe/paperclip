import express from "express";
import request from "supertest";
import { spaceMemberships, instanceUserRoles, principalPermissionGrants, toolConnections, toolConnectionInstalls, type Db } from "@outpost/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forbidden } from "../errors.js";
import { errorHandler } from "../middleware/error-handler.js";
import { emailRoutes } from "../routes/email.js";
import type { EmailChannelService } from "../services/email-channels.js";

const mocks = vi.hoisted(() => ({ credential: vi.fn(), listCredentials: vi.fn(), permission: vi.fn() }));
vi.mock("../services/email-connections.js", () => ({ emailConnectionService: () => ({ credential: mocks.credential, listCredentials: mocks.listCredentials }) }));
vi.mock("../services/access.js", () => ({ accessService: () => ({ hasPermission: mocks.permission }) }));
const spaceId = "11111111-1111-4111-8111-111111111111";
const connectionId = "22222222-2222-4222-8222-222222222222";
const path = `/api/spaces/${spaceId}/email/connections/${connectionId}/check-address`;
const input = { username: "ralph", domain: "agentmail.to" };
function app(actor = { type: "operator", source: "local_implicit", userId: "operator" } as express.Request["actor"]) {
  const instance = express();
  instance.use(express.json());
  instance.use((req, _res, next) => { req.actor = actor; next(); });
  // Provider calls remain stubbed, while the shared guard resolves real-shaped
  // resource and membership rows before those calls.
  const db = { select: () => ({ from: (table: unknown) => {
    const rows = table === toolConnections ? [{ id: connectionId, spaceId, createdByUserId: "operator", connectionPurpose: "tool", credentialPolicy: "shared", config: { provider: "agentmail" }, transportConfig: {} }]
      : table === spaceMemberships ? [{ spaceId, principalType: "user", principalId: "member", status: "active", membershipRole: "member" }]
      : [];
    expect([toolConnections, toolConnectionInstalls, spaceMemberships, instanceUserRoles, principalPermissionGrants]).toContain(table);
    return { where: () => Object.assign(Promise.resolve(rows), { limit: async () => rows }) };
  } }) } as unknown as Db;
  instance.use("/api", emailRoutes(db, {} as EmailChannelService));
  instance.use(errorHandler);
  return instance;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.credential.mockResolvedValue({ value: "private-key" });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ inboxes: [{ inbox_id: "ralph@agentmail.to" }] })));
});
afterEach(() => vi.unstubAllGlobals());
describe("AgentMail address checks", () => {
  it("lists saved-key metadata with space and manager access checks", async () => {
    const listPath = `/api/spaces/${spaceId}/email/connections`;
    mocks.listCredentials.mockResolvedValue([{ id: connectionId, label: "AgentMail account key", scope: "organization" }]);
    const response = await request(app()).get(listPath).expect(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(mocks.listCredentials).toHaveBeenCalledWith(spaceId, expect.objectContaining({ userId: "operator" }));
    mocks.listCredentials.mockClear();
    await request(app({ type: "agent", agentId: connectionId, spaceId })).get(listPath).expect(403);
    await request(app({ type: "operator", source: "session", userId: "member", spaceIds: [] })).get(listPath).expect(404);
    await request(app({ type: "operator", source: "session", userId: "member", spaceIds: [spaceId] })).get(listPath).expect(403);
    expect(mocks.listCredentials).not.toHaveBeenCalled();
  });
  it("uses the space-scoped saved credential and returns only address status", async () => {
    const response = await request(app()).post(path).send({ username: "Ralph", domain: "AgentMail.to" }).expect(200);
    expect(response.body).toEqual({ address: "ralph@agentmail.to", status: "taken" });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(mocks.credential).toHaveBeenCalledWith(spaceId, connectionId, expect.objectContaining({ userId: "operator" }));
    expect(fetch).toHaveBeenCalledWith("https://api.agentmail.to/v0/inboxes?limit=100", expect.objectContaining({ method: "GET" }));
    expect(response.text).not.toContain("private-key");
  });
  it.each([
    { username: "bad/name", domain: "agentmail.to" },
    { username: "r".repeat(65), domain: "agentmail.to" },
    { username: "ralph", domain: "https://other.test" },
    { ...input, apiKey: "unexpected" },
  ])("rejects malformed input before reading credentials (%#)", async body => {
    await request(app()).post(path).send(body).expect(400);
    expect(mocks.credential).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects agents without a responsible user", async () => {
    await request(app({ type: "agent", agentId: connectionId, spaceId })).post(path).send(input).expect(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("requires space access and connection management permission", async () => {
    await request(app({ type: "operator", source: "session", userId: "member", spaceIds: [] })).post(path).send(input).expect(404);
    await request(app({ type: "operator", source: "session", userId: "member", spaceIds: [spaceId] })).post(path).send(input).expect(403);
    expect(mocks.credential).not.toHaveBeenCalled();
  });
  it("preserves credential access checks", async () => {
    mocks.credential.mockRejectedValueOnce(forbidden("Credential access denied"));
    await request(app()).post(path).send(input).expect(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("surfaces rate limits without copying provider bodies", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ code: "rate_limit_exceeded", message: "private-key" }, { status: 429, headers: { "retry-after": "10" } }));
    const response = await request(app()).post(path).send(input).expect(429);
    expect(response.headers["retry-after"]).toBe("10");
    expect(response.text).not.toContain("private-key");
  });
});
