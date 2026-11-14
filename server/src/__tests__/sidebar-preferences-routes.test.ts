import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSidebarPreferenceService = vi.hoisted(() => ({
  getSpaceOrder: vi.fn(),
  upsertSpaceOrder: vi.fn(),
  getProjectOrder: vi.fn(),
  upsertProjectOrder: vi.fn(),
}));
const mockLogActivity = vi.hoisted(() => vi.fn());

function registerModuleMocks() {
  vi.doMock("../services/index.js", () => ({
    sidebarPreferenceService: () => mockSidebarPreferenceService,
    logActivity: mockLogActivity,
  }));
}

async function createApp(actor: Record<string, unknown>) {
  const { errorHandler } = await import("../middleware/index.js");
  const { sidebarPreferenceRoutes } = await import("../routes/sidebar-preferences.js");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor as never;
    next();
  });
  app.use("/api", sidebarPreferenceRoutes({} as never));
  app.use(errorHandler);
  return app;
}

const ORDERED_IDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
];

describe("sidebar preference routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("../services/index.js");
    vi.doUnmock("../routes/sidebar-preferences.js");
    vi.doUnmock("../routes/authz.js");
    vi.doUnmock("../middleware/index.js");
    registerModuleMocks();
    vi.clearAllMocks();
    mockSidebarPreferenceService.getSpaceOrder.mockResolvedValue({
      orderedIds: ORDERED_IDS,
      updatedAt: null,
    });
    mockSidebarPreferenceService.upsertSpaceOrder.mockResolvedValue({
      orderedIds: ORDERED_IDS,
      updatedAt: null,
    });
    mockSidebarPreferenceService.getProjectOrder.mockResolvedValue({
      orderedIds: ORDERED_IDS,
      updatedAt: null,
    });
    mockSidebarPreferenceService.upsertProjectOrder.mockResolvedValue({
      orderedIds: ORDERED_IDS,
      updatedAt: null,
    });
  });

  it("returns space rail order for operator users", async () => {
    const app = await createApp({
      type: "operator",
      userId: "user-1",
      source: "session",
      isInstanceAdmin: false,
      spaceIds: ["space-1"],
    });

    const res = await request(app).get("/api/sidebar-preferences/me");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      orderedIds: ORDERED_IDS,
      updatedAt: null,
    });
    expect(mockSidebarPreferenceService.getSpaceOrder).toHaveBeenCalledWith("user-1");
  });

  it("updates space rail order for operator users", async () => {
    const app = await createApp({
      type: "operator",
      userId: "user-1",
      source: "local_implicit",
      isInstanceAdmin: true,
      spaceIds: ["space-1"],
    });

    const res = await request(app)
      .put("/api/sidebar-preferences/me")
      .send({ orderedIds: ORDERED_IDS });

    expect(res.status).toBe(200);
    expect(mockSidebarPreferenceService.upsertSpaceOrder).toHaveBeenCalledWith("user-1", ORDERED_IDS);
  });

  it("returns project order for spaces the operator user can access", async () => {
    const app = await createApp({
      type: "operator",
      userId: "user-1",
      source: "session",
      isInstanceAdmin: false,
      spaceIds: ["space-1"],
    });

    const res = await request(app).get("/api/spaces/space-1/sidebar-preferences/me");

    expect(res.status).toBe(200);
    expect(mockSidebarPreferenceService.getProjectOrder).toHaveBeenCalledWith("space-1", "user-1");
  });

  it("logs project order updates for space-scoped writes", async () => {
    const app = await createApp({
      type: "operator",
      userId: "user-1",
      source: "session",
      isInstanceAdmin: false,
      spaceIds: ["space-1"],
      runId: "run-1",
    });

    const res = await request(app)
      .put("/api/spaces/space-1/sidebar-preferences/me")
      .send({ orderedIds: ORDERED_IDS });

    expect(res.status).toBe(200);
    expect(mockSidebarPreferenceService.upsertProjectOrder).toHaveBeenCalledWith("space-1", "user-1", ORDERED_IDS);
    expect(mockLogActivity).toHaveBeenCalledWith(
      {} as never,
      expect.objectContaining({
        spaceId: "space-1",
        action: "sidebar_preferences.project_order_updated",
        details: expect.objectContaining({
          userId: "user-1",
          orderedIds: ORDERED_IDS,
        }),
      }),
    );
  });

  it("rejects space-scoped reads when the operator user lacks space access", async () => {
    const app = await createApp({
      type: "operator",
      userId: "user-1",
      source: "session",
      isInstanceAdmin: false,
      spaceIds: ["space-2"],
    });

    const res = await request(app).get("/api/spaces/space-1/sidebar-preferences/me");

    expect(res.status).toBe(403);
    expect(mockSidebarPreferenceService.getProjectOrder).not.toHaveBeenCalled();
  });

  it("rejects agent callers", async () => {
    const app = await createApp({
      type: "agent",
      agentId: "agent-1",
      spaceId: "space-1",
      source: "agent_key",
    });

    const res = await request(app).get("/api/sidebar-preferences/me");

    expect(res.status).toBe(403);
    expect(mockSidebarPreferenceService.getSpaceOrder).not.toHaveBeenCalled();
  });
});
