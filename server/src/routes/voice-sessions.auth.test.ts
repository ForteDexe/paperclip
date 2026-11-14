import express from "express";
import request from "supertest";
import type { Db } from "@outpost/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/error-handler.js";
import type { VoiceSessionService } from "../services/voice/voice-session-service.js";
import { voiceSessionRoutes } from "./voice-sessions.js";

vi.mock("../services/instance-settings.js", () => ({
  instanceSettingsService: () => ({ getExperimental: async () => ({ enableChatConnectors: true }) }),
}));

const spaceId = "11111111-1111-4111-8111-111111111111";
const endpointId = "22222222-2222-4222-8222-222222222222";
const idempotencyKey = "33333333-3333-4333-8333-333333333333";
const actor: Express.Request["actor"] = {
  type: "operator", source: "session", userId: "signed-in-user", spaceIds: [spaceId],
};
const service = { history: vi.fn(), start: vi.fn() };

function app(currentActor = actor) {
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => { req.actor = currentActor; next(); });
  server.use("/api", voiceSessionRoutes({} as Db, service as unknown as VoiceSessionService));
  server.use(errorHandler);
  return server;
}

beforeEach(() => {
  vi.resetAllMocks();
  service.history.mockResolvedValue([]);
  service.start.mockResolvedValue({ session: { id: "test-session" } });
});

describe("voice caller authentication", () => {
  it.each(["session", "cloud_tenant"] as const)("allows signed-in %s users to read calls and start a session", async (source) => {
    const server = app({ ...actor, source });
    await request(server).get(`/api/spaces/${spaceId}/voice-history/${endpointId}`).expect(200, []);
    expect(service.history).toHaveBeenCalledWith(spaceId, endpointId, { id: actor.userId, authority: "member" });
    await request(server).post(`/api/spaces/${spaceId}/voice-sessions`)
      .send({ endpointId, idempotencyKey }).expect(200);
    expect(service.start).toHaveBeenCalledWith(expect.objectContaining({ spaceId, endpointId, caller: { id: actor.userId, authority: "member" } }));
  });

  it("keeps Cloud owners space-scoped without a persisted local admin role", async () => {
    await request(app({ ...actor, source: "cloud_tenant", isInstanceAdmin: true }))
      .get(`/api/spaces/${spaceId}/voice-history/${endpointId}`).expect(200);
    expect(service.history).toHaveBeenCalledWith(spaceId, endpointId, { id: actor.userId, authority: "member" });
  });

  it("preserves local authenticated administrator authority", async () => {
    await request(app({ ...actor, isInstanceAdmin: true }))
      .get(`/api/spaces/${spaceId}/voice-history/${endpointId}`).expect(200);
    expect(service.history).toHaveBeenCalledWith(spaceId, endpointId, { id: actor.userId, authority: "instance_admin" });
  });

  it("preserves local trusted callers", async () => {
    await request(app({ type: "operator", source: "local_implicit" }))
      .get(`/api/spaces/${spaceId}/voice-history/${endpointId}`).expect(200);
    expect(service.history).toHaveBeenCalledWith(spaceId, endpointId, { id: "local-operator", authority: "local_board" });
  });

  it.each(["operator_key", "mcp_oauth", "cloud_control"] as const)("rejects %s credentials as private human callers", async (source) => {
    await request(app({ ...actor, source })).get(`/api/spaces/${spaceId}/voice-history/${endpointId}`).expect(403);
    expect(service.history).not.toHaveBeenCalled();
  });

  it.each(["session", "cloud_tenant"] as const)("requires a user identity for %s callers", async (source) => {
    await request(app({ ...actor, source, userId: undefined })).get(`/api/spaces/${spaceId}/voice-history/${endpointId}`).expect(403);
    expect(service.history).not.toHaveBeenCalled();
  });

  it("retains Cloud space isolation", async () => {
    const server = app({ ...actor, source: "cloud_tenant", spaceIds: [] });
    await request(server).get(`/api/spaces/${spaceId}/voice-history/${endpointId}`).expect(403);
    await request(server).post(`/api/spaces/${spaceId}/voice-sessions`).send({ endpointId, idempotencyKey }).expect(403);
    expect(service.history).not.toHaveBeenCalled();
    expect(service.start).not.toHaveBeenCalled();
  });

  it("does not authenticate raw Cloud headers or agent callers", async () => {
    await request(app({ type: "none", source: "none" }))
      .get(`/api/spaces/${spaceId}/voice-history/${endpointId}`)
      .set("x-outpost-cloud-user-id", actor.userId!).expect(403);
    await request(app({ type: "agent", source: "agent_key", spaceId }))
      .post(`/api/spaces/${spaceId}/voice-sessions`).send({ endpointId, idempotencyKey }).expect(403);
    expect(service.history).not.toHaveBeenCalled();
    expect(service.start).not.toHaveBeenCalled();
  });
});
