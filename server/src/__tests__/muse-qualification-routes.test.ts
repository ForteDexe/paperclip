import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { Db } from "@outpost/db";
import { museQualificationRoutes } from "../routes/muse-qualification.js";
import { museOperatorRoutes } from "../routes/muse.js";
const mocks = vi.hoisted(() => ({ beginQualification: vi.fn(), endQualification: vi.fn(), readQualificationEvidence: vi.fn(), verify: vi.fn(), attestDetectorCleanup: vi.fn(), decide: vi.fn(), getById: vi.fn() }));
vi.mock("../services/muse-runner-broker.js", () => ({ museRunnerBroker: () => mocks }));
vi.mock("../services/access.js", () => ({ accessService: () => mocks }));
vi.mock("../services/authorization.js", () => ({ authorizationService: () => mocks }));
vi.mock("../modules/external-agents/index.js", () => ({ museExternalAgents: () => mocks }));
vi.mock("../services/agents.js", () => ({ agentService: () => mocks }));
const spaceId = "10000000-0000-4000-8000-000000000001", agentId = "20000000-0000-4000-8000-000000000001";
const bindingId = "30000000-0000-4000-8000-000000000001", qualificationId = "40000000-0000-4000-8000-000000000001";
const path = `/spaces/${spaceId}/agents/${agentId}/muse-binding/qualification`;
const body = { bindingId, qualificationId, generation: 1, expectedRevision: 2 };
function app(actor: Record<string, unknown> = { type: "operator", source: "operator_key", userId: "operator", spaceIds: [spaceId] }) {
  const result = express(); result.use(express.json());
  result.use((req, _res, next) => { Object.assign(req, { actor }); next(); });
  result.use(museQualificationRoutes({} as Db));
  result.use(museOperatorRoutes({} as Db));
  result.use((error: { status?: number; name?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.status ?? (error.name === "ZodError" ? 400 : 500)).json({ error: "request_rejected" });
  });
  return result;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getById.mockResolvedValue({ id: agentId, spaceId });
  mocks.decide.mockResolvedValue({ allowed: true });
  mocks.beginQualification.mockResolvedValue({ qualificationId, startedAt: "2099-01-01T00:00:00.000Z", expiresAt: "2099-01-02T00:00:00.000Z", revision: 3 });
  mocks.endQualification.mockResolvedValue(undefined);
  mocks.readQualificationEvidence.mockResolvedValue({ assignments: [], contacts: [] });
  mocks.verify.mockResolvedValue({ status: "pending" });
});
describe("operator-only Muse qualification routes", () => {
  it("uses current operator permission and a server-bounded 24h deadline", async () => {
    const before = Date.now();
    const response = await request(app()).post(path).send(body);
    expect(response.status).toBe(201); expect(response.headers["cache-control"]).toBe("no-store");
    const input = mocks.beginQualification.mock.calls[0]![0];
    expect(input).toMatchObject({ ...body, spaceId, agentId, operatorId: "operator" });
    expect(input.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 86_400_000);
    expect(input.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 86_400_000);
    expect(mocks.decide).toHaveBeenCalledWith(expect.objectContaining({ action: "agent_config:update", scope: { requiresChangeGrant: true } }));
  });
  it("rejects agent, human-MCP, implicit and cross-space callers before starting", async () => {
    for (const actor of [
      { type: "agent", source: "agent_key", agentId, spaceId },
      { type: "operator", source: "mcp_oauth", userId: "operator", spaceIds: [spaceId] },
      { type: "operator", source: "local_implicit", userId: "operator", spaceIds: [spaceId] },
      { type: "operator", source: "operator_key", userId: "operator", spaceIds: [] },
    ]) expect((await request(app(actor)).post(path).send(body)).status).toBe(403);
    expect(mocks.beginQualification).not.toHaveBeenCalled();
  });
  it("honors current permission denial and does not allow a caller-selected duration", async () => {
    mocks.decide.mockResolvedValueOnce({ allowed: false, explanation: "Not allowed" });
    expect((await request(app()).post(path).send(body)).status).toBe(403);
    expect((await request(app()).post(path).send({ ...body, expiresAt: "2099-12-31T00:00:00Z" })).status).toBe(400);
    expect(mocks.beginQualification).not.toHaveBeenCalled();
  });
  it("requires matching agent/space for evidence and cleanup", async () => {
    mocks.getById.mockResolvedValue({ id: agentId, spaceId: "50000000-0000-4000-8000-000000000001" });
    expect((await request(app()).get(path).query({ bindingId, qualificationId })).status).toBe(404);
    expect((await request(app()).delete(path).send({ bindingId, qualificationId })).status).toBe(404);
    expect(mocks.readQualificationEvidence).not.toHaveBeenCalled(); expect(mocks.endQualification).not.toHaveBeenCalled();
  });
  it("stops only the exact selected qualification and exposes non-cacheable evidence", async () => {
    const read = await request(app()).get(path).query({ bindingId, qualificationId });
    expect(read.status).toBe(200); expect(read.headers["cache-control"]).toBe("no-store");
    expect(mocks.readQualificationEvidence).toHaveBeenCalledWith(spaceId, agentId, bindingId, qualificationId);
    expect((await request(app()).delete(path).send({ bindingId, qualificationId })).status).toBe(204);
    expect(mocks.endQualification).toHaveBeenCalledWith({ spaceId, agentId, operatorId: "operator", bindingId, qualificationId });
  });
});

describe("operator Muse verification attribution", () => {
  const verifyPath = `/spaces/${spaceId}/agents/${agentId}/muse-binding/verify`;
  const verifyBody = { bindingId, generation: 1, expectedRevision: 2 };
  it("passes only the authorized server-derived operator caller to verification", async () => {
    const actor = { type: "operator", source: "session", userId: "actual-operator-caller", spaceIds: [spaceId] };
    expect((await request(app(actor)).post(verifyPath).send(verifyBody)).status).toBe(200);
    expect(mocks.verify).toHaveBeenCalledExactlyOnceWith(spaceId, agentId, verifyBody, "actual-operator-caller");
    expect(mocks.decide).toHaveBeenCalledWith(expect.objectContaining({ actor, action: "agent_config:update", scope: { requiresChangeGrant: true } }));
  });
  it("rejects caller-supplied audit identity before verification", async () => {
    expect((await request(app()).post(verifyPath).send({ ...verifyBody, operatorId: "spoofed-caller" })).status).toBe(400);
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it("does not verify when current operator authority or space scope is denied", async () => {
    mocks.decide.mockResolvedValueOnce({ allowed: false, explanation: "Not allowed" });
    expect((await request(app()).post(verifyPath).send(verifyBody)).status).toBe(403);
    expect((await request(app({ type: "operator", source: "operator_key", userId: "operator", spaceIds: [] })).post(verifyPath).send(verifyBody)).status).toBe(403);
    expect(mocks.verify).not.toHaveBeenCalled();
  });
});


describe("operator-only exact Muse detector cleanup", () => {
  const cleanupPath = `/spaces/${spaceId}/agents/${agentId}/muse-binding/attest-detector-cleanup`;
  const input = { bindingId, qualificationId, generation: 1, expectedRevision: 2, hookScript: `~/hooks/scripts/outpost-muse-${bindingId}.sh`, detectorRemoved: true,
    observation: { method: "hooks.list", includeDisabled: true, hookId: "test-hook", outcome: "exact_hook_absent", observedAt: "2099-01-02T00:00:01.000Z", sha256: "a".repeat(64) } };
  it("uses actual Operator caller and normal change-grant authorization", async () => {
    const actor = { type: "operator", source: "session", userId: "actual-operator", spaceIds: [spaceId] };
    const response = await request(app(actor)).post(cleanupPath).send(input);
    expect(response.status).toBe(200); expect(response.headers["cache-control"]).toBe("no-store");
    expect(mocks.attestDetectorCleanup).toHaveBeenCalledExactlyOnceWith(spaceId, agentId, "actual-operator", input, actor);
    expect(mocks.decide).toHaveBeenCalledWith(expect.objectContaining({ action: "agent_config:update", scope: { requiresChangeGrant: true } }));
  });
  it("rejects denied authority, agent callers, cross-space callers and supplied actor metadata", async () => {
    mocks.decide.mockResolvedValueOnce({ allowed: false, explanation: "Denied" });
    expect((await request(app()).post(cleanupPath).send(input)).status).toBe(403);
    for (const actor of [{ type: "agent", source: "agent_key", agentId, spaceId }, { type: "operator", source: "operator_key", userId: "operator", spaceIds: [] }]) expect((await request(app(actor)).post(cleanupPath).send(input)).status).toBe(403);
    expect((await request(app()).post(cleanupPath).send({ ...input, operatorId: "spoofed" })).status).toBe(400);
    expect(mocks.attestDetectorCleanup).not.toHaveBeenCalled();
  });
});
