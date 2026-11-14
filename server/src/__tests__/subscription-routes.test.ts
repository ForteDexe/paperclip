import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@outpost/db";
import { costRoutes } from "../routes/costs.js";
import { errorHandler } from "../middleware/error-handler.js";
import { tooManyRequests } from "../errors.js";

const mocks = vi.hoisted(() => ({ report: vi.fn(), refresh: vi.fn(), updatePrice: vi.fn(), merge: vi.fn(), decide: vi.fn() }));
vi.mock("../services/subscription-report.js", () => ({ subscriptionCostReport: mocks.report }));
vi.mock("../services/subscription-refresh.js", () => ({ refreshSpaceSubscriptions: mocks.refresh }));
vi.mock("../services/subscriptions.js", () => ({ subscriptionService: () => mocks }));
vi.mock("../routes/ai-connections.js", () => ({ canManageAiConnections: async () => false }));
vi.mock("../services/index.js", () => ({
  heartbeatService: () => ({}), costService: () => ({}), financeService: () => ({}), budgetService: () => ({}),
  spaceService: () => ({}), agentService: () => ({}), issueService: () => ({}), accessService: () => ({ decide: mocks.decide }),
}));
vi.mock("../services/accounting-integrity.js", () => ({ accountingIntegrityService: () => ({}) }));
vi.mock("../services/billing-reconciliation.js", () => ({ billingReconciliationService: () => ({}) }));

const spaceId = "11111111-1111-4111-8111-111111111111";
const accountId = "22222222-2222-4222-8222-222222222222";
function app(type: "operator" | "agent" = "operator", role = "member") {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.actor = type === "operator" ? { type: "operator", source: "session", userId: "alice", spaceIds: [spaceId], memberships: [{ spaceId, status: "active", membershipRole: role }] } as typeof req.actor : { type: "agent", agentId: "agent", spaceId } as typeof req.actor; next(); });
  app.use("/api", costRoutes({} as Db)); app.use(errorHandler); return app;
}
beforeEach(() => { vi.clearAllMocks(); mocks.decide.mockResolvedValue({ allowed: true }); mocks.report.mockResolvedValue({ accounts: [] }); mocks.refresh.mockResolvedValue(undefined); mocks.updatePrice.mockResolvedValue({ id: accountId }); });
describe("subscription reporting authorization", () => {
  it("allows space cost reads but rejects agents, other spaces and invalid dates", async () => {
    const path = `/api/spaces/${spaceId}/costs/subscriptions`;
    expect((await request(app()).get(path)).status).toBe(200);
    expect((await request(app("agent")).get(path)).status).toBe(403);
    expect((await request(app()).get("/api/spaces/other/costs/subscriptions")).status).toBe(403);
    expect((await request(app()).get(`${path}?from=not-a-date`)).status).toBe(400);
    expect((await request(app()).get(`${path}?period=all`)).status).toBe(200);
    expect(mocks.report).toHaveBeenLastCalledWith(expect.anything(), spaceId, expect.anything(), { allTime: true });
    mocks.decide.mockResolvedValue({ allowed: false });
    expect((await request(app()).get(path)).status).toBe(403);
  });
  it("returns immediately while authorized discovery runs and denies viewers", async () => {
    mocks.refresh.mockReturnValue(new Promise(() => {}));
    const path = `/api/spaces/${spaceId}/costs/subscriptions/refresh`;
    expect((await request(app()).post(path)).status).toBe(202);
    expect(mocks.refresh).toHaveBeenCalledWith(expect.anything(), spaceId, "alice");
    expect((await request(app("operator", "viewer")).post(path)).status).toBe(403);
  });
  it("validates edits and passes ownership and optimistic concurrency to the service", async () => {
    const path = `/api/spaces/${spaceId}/costs/subscriptions/${accountId}`;
    const data = { expectedRevision: 3, plan: "Pro", amountCents: "2000", currency: "USD", cadence: "month", status: "active" };
    expect((await request(app()).patch(path).send(data)).status).toBe(200);
    expect(mocks.updatePrice).toHaveBeenCalledWith(spaceId, accountId, expect.objectContaining({ expectedRevision: 3, amountCents: "2000.0000000" }), { userId: "alice", canManage: false, readOnly: false });
    expect((await request(app()).patch(path).send({ ...data, amountCents: "-1" })).status).toBe(400);
    expect((await request(app()).patch(path).send({ ...data, ownerUserId: "bob" })).status).toBe(400);
    expect((await request(app("agent")).patch(path).send(data)).status).toBe(403);
    mocks.decide.mockResolvedValue({ allowed: false });
    expect((await request(app()).patch(path).send(data)).status).toBe(403);
    expect((await request(app()).post(`${path}/link`).send({ targetId: accountId, expectedRevision: 3, targetRevision: 3 })).status).toBe(403);
  });
  it("returns a retryable error instead of accepting discovery beyond capacity", async () => {
    mocks.refresh.mockImplementationOnce(() => { throw tooManyRequests("Subscription account checks are busy. Try again shortly."); });
    const response = await request(app()).post(`/api/spaces/${spaceId}/costs/subscriptions/refresh`);
    expect(response.status).toBe(429);
    expect(response.body.error).toContain("Try again shortly");
  });
});
