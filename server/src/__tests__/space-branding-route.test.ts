import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSpaceService = vi.hoisted(() => ({
  list: vi.fn(),
  stats: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
  remove: vi.fn(),
}));

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  ensureMembership: vi.fn(),
}));

const mockBudgetService = vi.hoisted(() => ({
  upsertPolicy: vi.fn(),
}));

const mockSpacePortabilityService = vi.hoisted(() => ({
  exportBundle: vi.fn(),
  previewExport: vi.fn(),
  previewImport: vi.fn(),
  importBundle: vi.fn(),
}));

const mockSpaceArtifactsService = vi.hoisted(() => ({
  list: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());
vi.mock("../services/index.js", () => ({
  accessService: () => mockAccessService,
  agentService: () => mockAgentService,
  budgetService: () => mockBudgetService,
  spaceArtifactsService: () => mockSpaceArtifactsService,
  spacePortabilityService: () => mockSpacePortabilityService,
  spaceService: () => mockSpaceService,
  instanceSettingsService: () => ({
    getExperimental: vi.fn(),
  }),
  logActivity: mockLogActivity,
}));

function createSpace() {
  const now = new Date("2026-03-19T02:00:00.000Z");
  return {
    id: "space-1",
    name: "Outpost",
    description: null,
    status: "active",
    issuePrefix: "PAP",
    issueCounter: 568,
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    requireOperatorApprovalForNewAgents: false,
    logoAssetId: "11111111-1111-4111-8111-111111111111",
    logoUrl: "/api/assets/11111111-1111-4111-8111-111111111111/content",
    createdAt: now,
    updatedAt: now,
  };
}

async function createApp(actor: Record<string, unknown>) {
  const [{ spaceRoutes }, { errorHandler }] = await Promise.all([
    vi.importActual<typeof import("../routes/spaces.js")>("../routes/spaces.js"),
    vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
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

describe("PATCH /api/spaces/:spaceId/branding", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("../routes/spaces.js");
    vi.doUnmock("../routes/authz.js");
    vi.doUnmock("../middleware/index.js");
    vi.clearAllMocks();
  });

  it("keeps Space branding operator-only for agents regardless of title", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "agent-1",
      spaceId: "space-1",
      role: "engineer",
    });
    const app = await createApp({
      type: "agent",
      agentId: "agent-1",
      spaceId: "space-1",
      source: "agent_key",
      runId: "run-1",
    });

    const res = await request(app)
      .patch("/api/spaces/space-1/branding")
      .send({ logoAssetId: "11111111-1111-4111-8111-111111111111" });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Only operator users can manage space branding");
    expect(mockSpaceService.update).not.toHaveBeenCalled();
  });

  it("rejects agent callers before validating branding body shape", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "agent-1",
      spaceId: "space-1",
      role: "engineer",
    });
    const app = await createApp({
      type: "agent",
      agentId: "agent-1",
      spaceId: "space-1",
      source: "agent_key",
      runId: "run-1",
    });

    const res = await request(app)
      .patch("/api/spaces/space-1/branding")
      .send({ status: "archived" });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Only operator users can manage space branding");
    expect(mockSpaceService.update).not.toHaveBeenCalled();
  });

  it("does not derive branding authority from a root agent's legacy title", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "agent-1",
      spaceId: "space-1",
      role: "lead",
      leadAgentId: null,
    });
    const app = await createApp({
      type: "agent",
      agentId: "agent-1",
      spaceId: "space-1",
      source: "agent_key",
      runId: "run-1",
    });

    const res = await request(app)
      .patch("/api/spaces/space-1/branding")
      .send({
        logoAssetId: "11111111-1111-4111-8111-111111111111",
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Only operator users can manage space branding");
    expect(mockSpaceService.update).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("allows operator callers to update branding fields", async () => {
    const space = createSpace();
    mockSpaceService.update.mockResolvedValue({
      ...space,
      logoAssetId: null,
      logoUrl: null,
    });
    const app = await createApp({
      type: "operator",
      userId: "user-1",
      source: "local_implicit",
    });

    const res = await request(app)
      .patch("/api/spaces/space-1/branding")
      .send({ description: null, logoAssetId: null });

    expect(res.status).toBe(200);
    expect(res.body.logoAssetId ?? null).toBeNull();
  });

  it("rejects the retired brandColor field in the request body", async () => {
    const app = await createApp({
      type: "operator",
      userId: "user-1",
      source: "local_implicit",
    });

    const res = await request(app)
      .patch("/api/spaces/space-1/branding")
      .send({
        logoAssetId: "11111111-1111-4111-8111-111111111111",
        brandColor: "#123456",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation error");
    expect(mockSpaceService.update).not.toHaveBeenCalled();
  });

  it("rejects non-branding fields in the request body", async () => {
    const app = await createApp({
      type: "operator",
      userId: "user-1",
      source: "local_implicit",
    });

    const res = await request(app)
      .patch("/api/spaces/space-1/branding")
      .send({
        logoAssetId: "11111111-1111-4111-8111-111111111111",
        status: "archived",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation error");
    expect(mockSpaceService.update).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/spaces/:spaceId", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("../routes/spaces.js");
    vi.doUnmock("../routes/authz.js");
    vi.doUnmock("../middleware/index.js");
    vi.clearAllMocks();
  });

  it("rejects agent callers before loading the space or validating settings body shape", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "agent-1",
      spaceId: "space-1",
      role: "engineer",
    });
    const app = await createApp({
      type: "agent",
      agentId: "agent-1",
      spaceId: "space-1",
      source: "agent_key",
      runId: "run-1",
    });

    const res = await request(app)
      .patch("/api/spaces/space-1")
      .send({ status: "archived" });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Only operator users can manage space settings");
    expect(mockSpaceService.getById).not.toHaveBeenCalled();
    expect(mockSpaceService.update).not.toHaveBeenCalled();
  });

  it("does not derive Space settings authority from a root agent's legacy title", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "agent-1",
      spaceId: "space-1",
      role: "lead",
    });
    const app = await createApp({
      type: "agent",
      agentId: "agent-1",
      spaceId: "space-1",
      source: "agent_key",
      runId: "run-1",
    });

    const res = await request(app)
      .patch("/api/spaces/space-1")
      .send({ name: "New Name" });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Only operator users can manage space settings");
    expect(mockSpaceService.getById).not.toHaveBeenCalled();
    expect(mockSpaceService.update).not.toHaveBeenCalled();
  });

  it("rejects root-agent attempts to update lifecycle, budget, consent, or prefix fields before validation", async () => {
    const space = createSpace();
    mockAgentService.getById.mockResolvedValue({
      id: "agent-1",
      spaceId: "space-1",
      role: "lead",
    });
    mockSpaceService.getById.mockResolvedValue(space);
    const app = await createApp({
      type: "agent",
      agentId: "agent-1",
      spaceId: "space-1",
      source: "agent_key",
      runId: "run-1",
    });

    const res = await request(app)
      .patch("/api/spaces/space-1")
      .send({
        status: "archived",
        budgetMonthlyCents: 1000,
        spentMonthlyCents: 500,
        requireOperatorApprovalForNewAgents: true,
        feedbackDataSharingEnabled: true,
        issuePrefix: "BAD",
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Only operator users can manage space settings");
    expect(mockSpaceService.update).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("keeps full space settings updates operator-only", async () => {
    const space = createSpace();
    mockSpaceService.getById.mockResolvedValue(space);
    mockSpaceService.update.mockResolvedValue({
      ...space,
      status: "paused",
    });
    const app = await createApp({
      type: "operator",
      userId: "user-1",
      source: "local_implicit",
    });

    const res = await request(app)
      .patch("/api/spaces/space-1")
      .send({ status: "paused" });

    expect(res.status).toBe(200);
    expect(mockSpaceService.update).toHaveBeenCalledWith("space-1", { status: "paused" }, expect.objectContaining({
      actorType: "user",
      actorId: "user-1",
    }));
  });
});
