import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockPortabilityService = vi.hoisted(() => ({
  previewExport: vi.fn(),
  exportBundle: vi.fn(),
  previewImport: vi.fn(),
  importBundle: vi.fn(),
}));

const mockTransferRunService = vi.hoisted(() => ({
  resumeOrCreate: vi.fn(),
  getRunForActor: vi.fn(),
  recordCompletedPart: vi.fn(),
  claimApply: vi.fn(),
  releaseApplyClaim: vi.fn(),
  completeRun: vi.fn(),
  failRun: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  accessService: () => ({}),
  agentService: () => ({ list: vi.fn().mockResolvedValue([]) }),
  budgetService: () => ({}),
  spaceArtifactsService: () => ({}),
  spacePortabilityService: () => mockPortabilityService,
  spaceService: () => ({}),
  feedbackService: () => ({}),
  logActivity: mockLogActivity,
  workTimelineService: () => ({}),
}));

vi.mock("../services/space-transfer-runs.js", () => ({
  spaceTransferRunService: mockTransferRunService,
}));

const TRANSFER_ID = "6e0a4f6e-6f7d-4a37-9a83-0b8f2f9f2b11";

/**
 * Every route in the space-import surface. The floor must answer all of
 * them, including the read-only polling routes: with imports disabled no job
 * or transfer can exist, so a uniform 403 is clearer than a mixed surface.
 */
const IMPORT_ROUTES: Array<{ method: "get" | "post" | "put"; path: string }> = [
  { method: "post", path: "/api/spaces/import/preview" },
  { method: "post", path: "/api/spaces/import" },
  { method: "get", path: "/api/spaces/import/jobs/some-job" },
  { method: "post", path: "/api/spaces/import/transfers" },
  { method: "put", path: `/api/spaces/import/transfers/${TRANSFER_ID}/parts/0` },
  { method: "get", path: `/api/spaces/import/transfers/${TRANSFER_ID}` },
  { method: "post", path: `/api/spaces/import/transfers/${TRANSFER_ID}/preview` },
  { method: "post", path: `/api/spaces/import/transfers/${TRANSFER_ID}/apply` },
  { method: "post", path: "/api/spaces/11111111-2222-4333-8444-555555555555/imports/preview" },
  { method: "post", path: "/api/spaces/11111111-2222-4333-8444-555555555555/imports/apply" },
];

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

const operatorAdmin = {
  type: "operator",
  source: "local_implicit",
  userId: "local-user",
  isInstanceAdmin: true,
};

function expectNoImportWork() {
  expect(mockPortabilityService.previewImport).not.toHaveBeenCalled();
  expect(mockPortabilityService.importBundle).not.toHaveBeenCalled();
  expect(mockTransferRunService.resumeOrCreate).not.toHaveBeenCalled();
  expect(mockTransferRunService.getRunForActor).not.toHaveBeenCalled();
}

describe("space import Cloud floor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OUTPOST_CLOUD_TENANT_SERVER_TOKEN;
    delete process.env.OUTPOST_MANAGED_CONFIG;
    delete process.env.OUTPOST_HIDDEN_SETTINGS;
  });

  afterEach(() => {
    delete process.env.OUTPOST_CLOUD_TENANT_SERVER_TOKEN;
    delete process.env.OUTPOST_MANAGED_CONFIG;
    delete process.env.OUTPOST_HIDDEN_SETTINGS;
  });

  it("returns 403 cloud_managed on every import route on a cloud-managed instance", async () => {
    process.env.OUTPOST_CLOUD_TENANT_SERVER_TOKEN = "tenant-secret";
    const app = await createApp(operatorAdmin);

    for (const route of IMPORT_ROUTES) {
      const res = await request(app)[route.method](route.path).send({});
      expect(res.status, `${route.method.toUpperCase()} ${route.path}`).toBe(403);
      expect(res.body, `${route.method.toUpperCase()} ${route.path}`).toMatchObject({
        code: "cloud_managed",
      });
    }
    expectNoImportWork();
  });

  it("floors on the managed-config signal alone", async () => {
    process.env.OUTPOST_MANAGED_CONFIG = JSON.stringify({ v: 1, mode: "cloud" });
    const app = await createApp(operatorAdmin);

    const res = await request(app).post("/api/spaces/import").send({});

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "cloud_managed" });
    expectNoImportWork();
  });

  it("applies the floor before auth and request-body validation", async () => {
    process.env.OUTPOST_CLOUD_TENANT_SERVER_TOKEN = "tenant-secret";
    // An agent actor never passes the import routes' own assertOperator, and the
    // body is not schema-valid either — the floor must still answer first so a
    // Cloud caller sees one consistent refusal.
    const app = await createApp({ type: "agent", agentId: "agent-1", spaceId: "space-1" });

    const res = await request(app)
      .post("/api/spaces/import/transfers")
      .send({ nonsense: true });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "cloud_managed" });
    expectNoImportWork();
  });

  it("floors every import route with settings_operator_managed when space.import is hidden", async () => {
    process.env.OUTPOST_HIDDEN_SETTINGS = "space.import";
    const app = await createApp(operatorAdmin);

    for (const route of IMPORT_ROUTES) {
      const res = await request(app)[route.method](route.path).send({});
      expect(res.status, `${route.method.toUpperCase()} ${route.path}`).toBe(403);
      expect(res.body, `${route.method.toUpperCase()} ${route.path}`).toMatchObject({
        code: "settings_operator_managed",
      });
    }
    expectNoImportWork();
  });

  it("keeps import open when only other space pages are hidden", async () => {
    process.env.OUTPOST_HIDDEN_SETTINGS = "space.secrets,space.members";
    const app = await createApp(operatorAdmin);

    const res = await request(app).get("/api/spaces/import/jobs/unknown-job");

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "Import job not found" });
  });

  it("keeps space export open on a cloud-managed instance", async () => {
    process.env.OUTPOST_CLOUD_TENANT_SERVER_TOKEN = "tenant-secret";
    mockPortabilityService.exportBundle.mockResolvedValue({ ok: true });
    const app = await createApp(operatorAdmin);

    const res = await request(app)
      .post("/api/spaces/11111111-2222-4333-8444-555555555555/exports")
      .send({});

    expect(res.status).toBe(200);
    expect(mockPortabilityService.exportBundle).toHaveBeenCalledTimes(1);
  });

  it("preserves self-hosted import preview", async () => {
    mockPortabilityService.previewImport.mockResolvedValue({ spaces: [] });
    const app = await createApp(operatorAdmin);

    const res = await request(app)
      .post("/api/spaces/import/preview")
      .send({
        source: { type: "github", url: "https://github.com/example/export" },
        target: { mode: "new_space" },
      });

    expect(res.status).toBe(200);
    expect(mockPortabilityService.previewImport).toHaveBeenCalledTimes(1);
  });

  it("preserves self-hosted import job polling", async () => {
    const app = await createApp(operatorAdmin);

    const res = await request(app).get("/api/spaces/import/jobs/unknown-job");

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "Import job not found" });
  });
});
