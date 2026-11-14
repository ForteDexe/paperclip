import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSpaceService = vi.hoisted(() => ({
  create: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  ensureMembership: vi.fn(),
  ensureRoleDefaultGrants: vi.fn(),
}));

const mockBudgetService = vi.hoisted(() => ({
  upsertPolicy: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  accessService: () => mockAccessService,
  agentService: () => ({}),
  budgetService: () => mockBudgetService,
  spaceArtifactsService: () => ({}),
  spacePortabilityService: () => ({}),
  spaceService: () => mockSpaceService,
  feedbackService: () => ({}),
  logActivity: mockLogActivity,
  workTimelineService: () => ({}),
}));

const createdSpace = {
  id: "space-new",
  name: "New Space",
  budgetMonthlyCents: 0,
};

async function createApp(actor: Record<string, unknown>) {
  const [{ spaceRoutes }, { errorHandler }] = await Promise.all([
    import("../routes/spaces.js"),
    import("../middleware/index.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api/spaces", spaceRoutes({} as any));
  app.use(errorHandler);
  return app;
}

describe("POST /api/spaces Cloud floor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OUTPOST_CLOUD_TENANT_SERVER_TOKEN;
    delete process.env.OUTPOST_MANAGED_CONFIG;
    mockSpaceService.create.mockResolvedValue(createdSpace);
  });

  afterEach(() => {
    delete process.env.OUTPOST_CLOUD_TENANT_SERVER_TOKEN;
    delete process.env.OUTPOST_MANAGED_CONFIG;
  });

  it("returns 403 cloud_managed before creating a second space on Cloud", async () => {
    process.env.OUTPOST_CLOUD_TENANT_SERVER_TOKEN = "tenant-secret";
    const app = await createApp({
      type: "operator",
      source: "cloud_tenant",
      userId: "cloud-user",
      isInstanceAdmin: true,
    });

    const res = await request(app).post("/api/spaces").send({ name: "Second Space" });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "cloud_managed" });
    expect(mockSpaceService.create).not.toHaveBeenCalled();
    expect(mockAccessService.ensureMembership).not.toHaveBeenCalled();
  });

  it("applies the Cloud floor before request-body validation", async () => {
    process.env.OUTPOST_CLOUD_TENANT_SERVER_TOKEN = "tenant-secret";
    const app = await createApp({
      type: "operator",
      source: "cloud_tenant",
      userId: "cloud-user",
      isInstanceAdmin: true,
    });

    const res = await request(app).post("/api/spaces").send({ name: "" });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "cloud_managed" });
    expect(mockSpaceService.create).not.toHaveBeenCalled();
  });

  it("preserves self-hosted space creation", async () => {
    const app = await createApp({
      type: "operator",
      source: "local_implicit",
      userId: "local-user",
      isInstanceAdmin: true,
    });

    const res = await request(app).post("/api/spaces").send({ name: "New Space" });

    expect(res.status).toBe(201);
    expect(res.body).toEqual(createdSpace);
    expect(mockSpaceService.create).toHaveBeenCalledWith(expect.objectContaining({
      name: "New Space",
      defaultResponsibleUserId: "local-user",
    }));
    expect(mockAccessService.ensureMembership).toHaveBeenCalledWith(
      "space-new",
      "user",
      "local-user",
      "owner",
      "active",
    );
  });
});
