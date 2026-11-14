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
  list: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  ensureMembership: vi.fn(),
  decide: vi.fn(),
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
const mockInstanceSettingsService = vi.hoisted(() => ({
  getExperimental: vi.fn(),
}));

vi.mock("../services/access.js", () => ({
  accessService: () => mockAccessService,
}));

vi.mock("../services/activity-log.js", () => ({
  logActivity: mockLogActivity,
}));

vi.mock("../services/agents.js", () => ({
  agentService: () => mockAgentService,
}));

vi.mock("../services/budgets.js", () => ({
  budgetService: () => mockBudgetService,
}));

vi.mock("../services/space-service.js", () => ({
  spaceService: () => mockSpaceService,
}));

vi.mock("../services/space-portability.js", () => ({
  spacePortabilityService: () => mockSpacePortabilityService,
}));

vi.mock("../services/index.js", () => ({
  accessService: () => mockAccessService,
  agentService: () => mockAgentService,
  budgetService: () => mockBudgetService,
  spaceArtifactsService: () => mockSpaceArtifactsService,
  spacePortabilityService: () => mockSpacePortabilityService,
  spaceService: () => mockSpaceService,
  instanceSettingsService: () => mockInstanceSettingsService,
  logActivity: mockLogActivity,
}));

function registerSpaceRouteMocks() {
  vi.doMock("../services/index.js", () => ({
    accessService: () => mockAccessService,
    agentService: () => mockAgentService,
    budgetService: () => mockBudgetService,
    spaceArtifactsService: () => mockSpaceArtifactsService,
    spacePortabilityService: () => mockSpacePortabilityService,
    spaceService: () => mockSpaceService,
    instanceSettingsService: () => mockInstanceSettingsService,
    logActivity: mockLogActivity,
  }));
}

let appImportCounter = 0;

async function createApp(actor: Record<string, unknown>) {
  registerSpaceRouteMocks();
  appImportCounter += 1;
  const routeModulePath = `../routes/spaces.js?space-portability-routes-${appImportCounter}`;
  const middlewareModulePath = `../middleware/index.js?space-portability-routes-${appImportCounter}`;
  const [{ spaceRoutes }, { errorHandler }] = await Promise.all([
    import(routeModulePath) as Promise<typeof import("../routes/spaces.js")>,
    import(middlewareModulePath) as Promise<typeof import("../middleware/index.js")>,
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

const spaceId = "11111111-1111-4111-8111-111111111111";
const otherSpaceId = "22222222-2222-4222-8222-222222222222";
const rootAgentId = "root-agent";
const workerAgentId = "worker-agent";

const exportRequest = {
  include: { space: true, agents: true, projects: true },
};

function createExportResult() {
  return {
    rootPath: "outpost",
    manifest: {
      agents: [],
      skills: [],
      projects: [],
      issues: [],
      envInputs: [],
      includes: { space: true, agents: true, projects: true, issues: false, skills: false },
      space: null,
      schemaVersion: 1,
      generatedAt: "2026-01-01T00:00:00.000Z",
      source: null,
    },
    files: {},
    warnings: [],
  };
}

const importRequest = {
  source: { type: "inline", files: { "COMPANY.md": "---\nname: Test\n---\n" } },
  include: { space: true, agents: true, projects: false, issues: false },
  target: { mode: "existing_space", spaceId },
  collisionStrategy: "rename",
};

const cloudHeaders = {
  "x-outpost-cloud-stack-id": "stack-alpha",
  "x-outpost-cloud-outpost-space-id": spaceId,
};

function cloudTenantActor() {
  return {
    type: "operator",
    userId: "cloud-user-1",
    userName: "Cloud User",
    userEmail: "cloud-user@example.com",
    spaceIds: [spaceId],
    memberships: [{ spaceId, membershipRole: "owner", status: "active" }],
    isInstanceAdmin: true,
    source: "cloud_tenant",
  };
}

function createImportResult(action = "updated") {
  return {
    space: { id: spaceId, action },
    agents: [{ id: "agent-1" }],
    warnings: [],
  };
}

async function waitForImportJobStatus(app: express.Express, statusUrl: string, status: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const res = await request(app).get(statusUrl).set(cloudHeaders);
    if (res.body.job?.status === status) {
      return res;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for import job to reach ${status}`);
}

async function waitForCondition(condition: () => boolean, label: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

const TEST_USER_HEADER = "x-test-user-id";

function operatorActor(userId: string) {
  return {
    type: "operator",
    userId,
    userName: "Operator User",
    userEmail: `${userId}@example.com`,
    spaceIds: [spaceId],
    memberships: [{ spaceId, membershipRole: "owner", status: "active" }],
    isInstanceAdmin: true,
    source: "session",
  };
}

// A single spaceRoutes instance (one shared in-memory job map) whose operator
// actor is chosen per request from the `x-test-user-id` header. This lets one
// app exercise cross-user isolation and the per-user duplicate guard.
async function createOperatorApp() {
  registerSpaceRouteMocks();
  appImportCounter += 1;
  const routeModulePath = `../routes/spaces.js?space-portability-routes-${appImportCounter}`;
  const middlewareModulePath = `../middleware/index.js?space-portability-routes-${appImportCounter}`;
  const [{ spaceRoutes }, { errorHandler }] = await Promise.all([
    import(routeModulePath) as Promise<typeof import("../routes/spaces.js")>,
    import(middlewareModulePath) as Promise<typeof import("../middleware/index.js")>,
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const header = req.headers[TEST_USER_HEADER];
    const userId = typeof header === "string" && header.length > 0 ? header : "operator-user-a";
    (req as any).actor = operatorActor(userId);
    next();
  });
  app.use("/api/spaces", spaceRoutes({} as any));
  app.use(errorHandler);
  return app;
}

async function waitForImportJobStatusAs(
  app: express.Express,
  statusUrl: string,
  status: string,
  headers: Record<string, string>,
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const res = await request(app).get(statusUrl).set(headers);
    if (res.body.job?.status === status) {
      return res;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for import job to reach ${status}`);
}

// A minimal STORE-only zip writer so the multipart/zip upload path can be
// exercised end-to-end: the route unzips this into the same inline bundle an
// application/json caller would send. Layout matches ui/src/lib/zip.ts (local
// file headers, central directory, end-of-central-directory).
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) === 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildStoreZip(files: Record<string, string>, rootPath: string): Buffer {
  const encoder = new TextEncoder();
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let localOffset = 0;
  const entries = Object.entries(files);

  for (const [relativePath, content] of entries) {
    const fileName = encoder.encode(`${rootPath}/${relativePath}`);
    const body = Buffer.from(encoder.encode(content));
    const checksum = crc32(body);

    const localHeader = Buffer.alloc(30 + fileName.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(body.length, 18);
    localHeader.writeUInt32LE(body.length, 22);
    localHeader.writeUInt16LE(fileName.length, 26);
    Buffer.from(fileName).copy(localHeader, 30);

    const centralHeader = Buffer.alloc(46 + fileName.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(body.length, 20);
    centralHeader.writeUInt32LE(body.length, 24);
    centralHeader.writeUInt16LE(fileName.length, 28);
    centralHeader.writeUInt32LE(localOffset, 42);
    Buffer.from(fileName).copy(centralHeader, 46);

    localChunks.push(localHeader, body);
    centralChunks.push(centralHeader);
    localOffset += localHeader.length + body.length;
  }

  const centralDirectory = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localOffset, 16);

  return Buffer.concat([...localChunks, centralDirectory, eocd]);
}

// The import fields a multipart caller ships as the JSON `meta` field: the same
// object an inline caller sends, minus `source` (the source is the uploaded zip).
const importMeta = {
  include: importRequest.include,
  target: importRequest.target,
  collisionStrategy: importRequest.collisionStrategy,
};

describe("space portability routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAgentService.getById.mockImplementation(async (id: string) => ({
      id,
      spaceId,
      role: "general",
      leadAgentId: id === rootAgentId ? null : rootAgentId,
    }));
    mockAgentService.list.mockResolvedValue([]);
    mockAccessService.decide.mockResolvedValue({
      allowed: true,
      action: "space_scope:read",
      reason: "allow_explicit_grant",
      explanation: "Explicit permission granted.",
    });
    mockSpacePortabilityService.exportBundle.mockResolvedValue(createExportResult());
    mockSpacePortabilityService.previewExport.mockResolvedValue({
      rootPath: "outpost",
      manifest: { agents: [], skills: [], projects: [], issues: [], envInputs: [], includes: { space: true, agents: true, projects: true, issues: false, skills: false }, space: null, schemaVersion: 1, generatedAt: new Date().toISOString(), source: null },
      files: {},
      fileInventory: [],
      counts: { files: 0, agents: 0, skills: 0, projects: 0, issues: 0 },
      warnings: [],
      outpostExtensionPath: ".outpost.yaml",
    });
    mockSpacePortabilityService.previewImport.mockResolvedValue({ ok: true });
    mockSpacePortabilityService.importBundle.mockResolvedValue({
      space: { id: spaceId, action: "created" },
      agents: [],
      warnings: [],
    });
  });

  it("allows agents with an explicit space-scope grant to preview exports", async () => {
    const app = await createApp({
      type: "agent",
      agentId: workerAgentId,
      spaceId,
      source: "agent_key",
      runId: "run-1",
    });

    const res = await request(app)
      .post(`/api/spaces/${spaceId}/exports/preview`)
      .send(exportRequest);

    expect(res.status).toBe(200);
    expect(mockSpacePortabilityService.previewExport).toHaveBeenCalledTimes(1);
  });

  it("rejects export preview callers without an explicit grant before validating request shape", async () => {
    mockAccessService.decide.mockResolvedValueOnce({
      allowed: false,
      action: "space_scope:read",
      reason: "deny_missing_grant",
      explanation: "Missing permission: space_scope:read.",
    });
    const app = await createApp({
      type: "agent",
      agentId: workerAgentId,
      spaceId,
      source: "agent_key",
      runId: "run-1",
    });

    const res = await request(app)
      .post(`/api/spaces/${spaceId}/exports/preview`)
      .send({ agents: [123] });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Missing explicit permission to manage space exports");
    expect(mockSpacePortabilityService.previewExport).not.toHaveBeenCalled();
  });

  it("rejects agents without an explicit grant from legacy and scoped export bundle routes", async () => {
    mockAccessService.decide.mockResolvedValue({
      allowed: false,
      action: "space_scope:read",
      reason: "deny_missing_grant",
      explanation: "Missing permission: space_scope:read.",
    });
    const app = await createApp({
      type: "agent",
      agentId: workerAgentId,
      spaceId,
      source: "agent_key",
      runId: "run-1",
    });

    for (const path of [`/api/spaces/${spaceId}/export`, `/api/spaces/${spaceId}/exports`]) {
      const res = await request(app).post(path).send(exportRequest);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("Missing explicit permission to manage space exports");
    }
    expect(mockSpacePortabilityService.exportBundle).not.toHaveBeenCalled();
  });

  it("allows root agents with an explicit grant to use space-scoped export preview routes", async () => {
    mockSpacePortabilityService.previewExport.mockResolvedValue({
      rootPath: "outpost",
      manifest: { agents: [], skills: [], projects: [], issues: [], envInputs: [], includes: { space: true, agents: true, projects: true, issues: false, skills: false }, space: null, schemaVersion: 1, generatedAt: new Date().toISOString(), source: null },
      files: {},
      fileInventory: [],
      counts: { files: 0, agents: 0, skills: 0, projects: 0, issues: 0 },
      warnings: [],
      outpostExtensionPath: ".outpost.yaml",
    });
    const app = await createApp({
      type: "agent",
      agentId: rootAgentId,
      spaceId,
      source: "agent_key",
      runId: "run-1",
    });

    const res = await request(app)
      .post(`/api/spaces/${spaceId}/exports/preview`)
      .send(exportRequest);

    expect(res.status).toBe(200);
    expect(res.body.rootPath).toBe("outpost");
  });

  it("allows root agents with an explicit grant to export through legacy and scoped bundle routes", async () => {
    mockSpacePortabilityService.exportBundle.mockResolvedValue(createExportResult());
    const app = await createApp({
      type: "agent",
      agentId: rootAgentId,
      spaceId,
      source: "agent_key",
      runId: "run-1",
    });

    for (const path of [`/api/spaces/${spaceId}/export`, `/api/spaces/${spaceId}/exports`]) {
      const res = await request(app).post(path).send(exportRequest);

      expect(res.status).toBe(200);
      expect(res.body.rootPath).toBe("outpost");
    }
    expect(mockSpacePortabilityService.exportBundle).toHaveBeenCalledTimes(2);
    expect(mockSpacePortabilityService.exportBundle).toHaveBeenNthCalledWith(
      1,
      spaceId,
      exportRequest,
      { allowExternalInstructions: false },
    );
    expect(mockSpacePortabilityService.exportBundle).toHaveBeenNthCalledWith(
      2,
      spaceId,
      exportRequest,
      { allowExternalInstructions: false },
    );
  });

  it("allows operator users to export through legacy and scoped bundle routes", async () => {
    mockSpacePortabilityService.exportBundle.mockResolvedValue(createExportResult());
    const app = await createApp({
      type: "operator",
      userId: "user-1",
      spaceIds: [spaceId],
      source: "session",
      isInstanceAdmin: false,
    });

    for (const path of [`/api/spaces/${spaceId}/export`, `/api/spaces/${spaceId}/exports`]) {
      const res = await request(app).post(path).send(exportRequest);

      expect(res.status).toBe(200);
      expect(res.body.rootPath).toBe("outpost");
    }
    expect(mockSpacePortabilityService.exportBundle).toHaveBeenCalledTimes(2);
  });

  it("requires instance-admin access when a space export includes external instructions", async () => {
    mockAgentService.list.mockResolvedValue([{
      id: "external-agent",
      spaceId,
      adapterConfig: {
        instructionsBundleMode: "external",
        instructionsRootPath: "/srv/outpost/external-agent",
      },
    }]);
    const nonAdminActors = [
      {
        type: "operator",
        userId: "space-admin",
        spaceIds: [spaceId],
        memberships: [{ spaceId, status: "active", membershipRole: "admin" }],
        source: "session",
        isInstanceAdmin: false,
      },
      {
        type: "agent",
        agentId: rootAgentId,
        spaceId,
        source: "agent_key",
        runId: "run-1",
      },
    ];

    for (const actor of nonAdminActors) {
      const app = await createApp(actor);
      for (const path of [
        `/api/spaces/${spaceId}/export`,
        `/api/spaces/${spaceId}/exports`,
        `/api/spaces/${spaceId}/exports/preview`,
      ]) {
        const res = await request(app).post(path).send(exportRequest);
        expect(res.status, `${path}: ${JSON.stringify(res.body)}`).toBe(403);
        expect(res.body.error).toMatch(/Instance admin|Operator access/);
      }
    }

    expect(mockSpacePortabilityService.exportBundle).not.toHaveBeenCalled();
    expect(mockSpacePortabilityService.previewExport).not.toHaveBeenCalled();
  });

  it("allows an instance admin to export spaces with external instructions", async () => {
    mockAgentService.list.mockResolvedValue([{
      id: "external-agent",
      spaceId,
      adapterConfig: {
        instructionsBundleMode: "external",
        instructionsRootPath: "/srv/outpost/external-agent",
      },
    }]);
    const app = await createApp({
      type: "operator",
      userId: "instance-admin",
      spaceIds: [spaceId],
      memberships: [{ spaceId, status: "active", membershipRole: "admin" }],
      source: "session",
      isInstanceAdmin: true,
    });

    const res = await request(app).post(`/api/spaces/${spaceId}/exports`).send(exportRequest);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockSpacePortabilityService.exportBundle).toHaveBeenCalledWith(
      spaceId,
      exportRequest,
      { allowExternalInstructions: true },
    );
  });

  it("uses the export selector resolver before checking external instructions", async () => {
    mockAgentService.list.mockResolvedValue([
      {
        id: "external-agent",
        name: "Managed-Agent",
        spaceId,
        status: "active",
        metadata: null,
        adapterConfig: {
          instructionsBundleMode: "external",
          instructionsRootPath: "/srv/outpost/external-agent",
        },
      },
      {
        id: "managed-agent",
        name: "Managed Agent",
        spaceId,
        status: "active",
        metadata: null,
        adapterConfig: { instructionsBundleMode: "managed" },
      },
    ]);
    mockSpacePortabilityService.exportBundle.mockResolvedValue(createExportResult());
    const app = await createApp({
      type: "operator",
      userId: "space-admin",
      spaceIds: [spaceId],
      memberships: [{ spaceId, status: "active", membershipRole: "admin" }],
      source: "session",
      isInstanceAdmin: false,
    });
    const selectedAgentRequest = {
      ...exportRequest,
      agents: ["managed-agent"],
    };

    const res = await request(app)
      .post(`/api/spaces/${spaceId}/exports`)
      .send(selectedAgentRequest);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockAgentService.list).toHaveBeenCalledWith(spaceId, { includeTerminated: true });
    expect(mockSpacePortabilityService.exportBundle).toHaveBeenCalledWith(
      spaceId,
      selectedAgentRequest,
      { allowExternalInstructions: false },
    );
  });

  it("keeps non-agent exports open when external instructions are excluded", async () => {
    mockAgentService.list.mockResolvedValue([{
      id: "external-agent",
      spaceId,
      adapterConfig: {
        instructionsBundleMode: "external",
        instructionsRootPath: "/srv/outpost/external-agent",
      },
    }]);
    const app = await createApp({
      type: "operator",
      userId: "space-admin",
      spaceIds: [spaceId],
      memberships: [{ spaceId, status: "active", membershipRole: "admin" }],
      source: "session",
      isInstanceAdmin: false,
    });
    const spaceOnlyRequest = {
      include: {
        space: true,
        agents: false,
        projects: false,
        issues: false,
        skills: false,
      },
    };

    const res = await request(app)
      .post(`/api/spaces/${spaceId}/exports`)
      .send(spaceOnlyRequest);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockSpacePortabilityService.exportBundle).toHaveBeenCalledWith(
      spaceId,
      spaceOnlyRequest,
      { allowExternalInstructions: false },
    );
  });

  it("rejects root agents from exporting another Space before services run", async () => {
    const app = await createApp({
      type: "agent",
      agentId: rootAgentId,
      spaceId,
      source: "agent_key",
      runId: "run-1",
    });

    for (const path of [
      `/api/spaces/${otherSpaceId}/export`,
      `/api/spaces/${otherSpaceId}/exports`,
      `/api/spaces/${otherSpaceId}/exports/preview`,
    ]) {
      const res = await request(app).post(path).send(exportRequest);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("another space");
    }
    expect(mockSpacePortabilityService.exportBundle).not.toHaveBeenCalled();
    expect(mockSpacePortabilityService.previewExport).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("rejects replace collision strategy on agent-safe import routes", async () => {
    const app = await createApp({
      type: "agent",
      agentId: rootAgentId,
      spaceId: "11111111-1111-4111-8111-111111111111",
      source: "agent_key",
      runId: "run-1",
    });

    const res = await request(app)
      .post("/api/spaces/11111111-1111-4111-8111-111111111111/imports/preview")
      .send({
        source: { type: "inline", files: { "COMPANY.md": "---\nname: Test\n---\n" } },
        include: { space: true, agents: true, projects: false, issues: false },
        target: { mode: "existing_space", spaceId: "11111111-1111-4111-8111-111111111111" },
        collisionStrategy: "replace",
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("does not allow replace");
    expect(mockSpacePortabilityService.previewImport).not.toHaveBeenCalled();
  });

  it("rejects root agents from previewing or applying imports against another route Space", async () => {
    const app = await createApp({
      type: "agent",
      agentId: rootAgentId,
      spaceId,
      source: "agent_key",
      runId: "run-1",
    });

    for (const path of [
      `/api/spaces/${otherSpaceId}/imports/preview`,
      `/api/spaces/${otherSpaceId}/imports/apply`,
    ]) {
      const res = await request(app).post(path).send({
        ...importRequest,
        target: { mode: "existing_space", spaceId: otherSpaceId },
      });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("another space");
    }
    expect(mockSpacePortabilityService.previewImport).not.toHaveBeenCalled();
    expect(mockSpacePortabilityService.importBundle).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("rejects agent-safe import bodies that target a different Space than the route", async () => {
    const app = await createApp({
      type: "agent",
      agentId: rootAgentId,
      spaceId,
      source: "agent_key",
      runId: "run-1",
    });

    for (const path of [
      `/api/spaces/${spaceId}/imports/preview`,
      `/api/spaces/${spaceId}/imports/apply`,
    ]) {
      const res = await request(app).post(path).send({
        ...importRequest,
        target: { mode: "existing_space", spaceId: otherSpaceId },
      });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("only target the route space");
    }
    expect(mockSpacePortabilityService.previewImport).not.toHaveBeenCalled();
    expect(mockSpacePortabilityService.importBundle).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("keeps global import preview routes operator-only", async () => {
    const app = await createApp({
      type: "agent",
      agentId: workerAgentId,
      spaceId: "11111111-1111-4111-8111-111111111111",
      source: "agent_key",
      runId: "run-1",
    });

    const res = await request(app)
      .post("/api/spaces/import/preview")
      .send({
        source: { type: "inline", files: { "COMPANY.md": "---\nname: Test\n---\n" } },
        include: { space: true, agents: true, projects: false, issues: false },
        target: { mode: "existing_space", spaceId: "11111111-1111-4111-8111-111111111111" },
        collisionStrategy: "rename",
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Operator access required");
  });

  it("keeps global import preview operator-only before validating request shape", async () => {
    const app = await createApp({
      type: "agent",
      agentId: workerAgentId,
      spaceId: "11111111-1111-4111-8111-111111111111",
      source: "agent_key",
      runId: "run-1",
    });

    const res = await request(app)
      .post("/api/spaces/import/preview")
      .send({ target: { mode: "existing_space", spaceId: "not-a-uuid" } });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Operator access required");
    expect(mockSpacePortabilityService.previewImport).not.toHaveBeenCalled();
  });

  it("requires instance admin for new-space import preview", async () => {
    const app = await createApp({
      type: "operator",
      userId: "user-1",
      spaceIds: ["11111111-1111-4111-8111-111111111111"],
      source: "session",
      isInstanceAdmin: false,
    });

    const res = await request(app)
      .post("/api/spaces/import/preview")
      .send({
        source: { type: "inline", files: { "COMPANY.md": "---\nname: Test\n---\n" } },
        include: { space: true, agents: true, projects: false, issues: false },
        target: { mode: "new_space", newSpaceName: "Imported Test" },
        collisionStrategy: "rename",
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Instance admin");
    expect(mockSpacePortabilityService.previewImport).not.toHaveBeenCalled();
  });

  it("rejects replace collision strategy on agent-safe import apply routes", async () => {
    const app = await createApp({
      type: "agent",
      agentId: rootAgentId,
      spaceId: "11111111-1111-4111-8111-111111111111",
      source: "agent_key",
      runId: "run-1",
    });

    const res = await request(app)
      .post("/api/spaces/11111111-1111-4111-8111-111111111111/imports/apply")
      .send({
        source: { type: "inline", files: { "COMPANY.md": "---\nname: Test\n---\n" } },
        include: { space: true, agents: true, projects: false, issues: false },
        target: { mode: "existing_space", spaceId: "11111111-1111-4111-8111-111111111111" },
        collisionStrategy: "replace",
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("does not allow replace");
    expect(mockSpacePortabilityService.importBundle).not.toHaveBeenCalled();
  });

  it("rejects agents without an explicit create grant from import preview routes", async () => {
    mockAccessService.decide.mockResolvedValueOnce({
      allowed: false,
      action: "agents:create",
      reason: "deny_missing_grant",
      explanation: "Missing permission: agents:create.",
    });
    const app = await createApp({
      type: "agent",
      agentId: workerAgentId,
      spaceId: "11111111-1111-4111-8111-111111111111",
      source: "agent_key",
      runId: "run-1",
    });

    const res = await request(app)
      .post("/api/spaces/11111111-1111-4111-8111-111111111111/imports/preview")
      .send({
        source: { type: "inline", files: { "COMPANY.md": "---\nname: Test\n---\n" } },
        include: { space: true, agents: true, projects: false, issues: false },
        target: { mode: "existing_space", spaceId: "11111111-1111-4111-8111-111111111111" },
        collisionStrategy: "rename",
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Missing explicit permission to manage space imports");
    expect(mockSpacePortabilityService.previewImport).not.toHaveBeenCalled();
  });

  it("rejects import preview callers without an explicit grant before validating request shape", async () => {
    mockAccessService.decide.mockResolvedValueOnce({
      allowed: false,
      action: "agents:create",
      reason: "deny_missing_grant",
      explanation: "Missing permission: agents:create.",
    });
    const app = await createApp({
      type: "agent",
      agentId: workerAgentId,
      spaceId: "11111111-1111-4111-8111-111111111111",
      source: "agent_key",
      runId: "run-1",
    });

    const res = await request(app)
      .post("/api/spaces/11111111-1111-4111-8111-111111111111/imports/preview")
      .send({ target: { mode: "existing_space", spaceId: "not-a-uuid" } });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Missing explicit permission to manage space imports");
    expect(mockSpacePortabilityService.previewImport).not.toHaveBeenCalled();
  });

  it("rejects agents without an explicit create grant from import apply routes", async () => {
    mockAccessService.decide.mockResolvedValueOnce({
      allowed: false,
      action: "agents:create",
      reason: "deny_missing_grant",
      explanation: "Missing permission: agents:create.",
    });
    const app = await createApp({
      type: "agent",
      agentId: workerAgentId,
      spaceId: "11111111-1111-4111-8111-111111111111",
      source: "agent_key",
      runId: "run-1",
    });

    const res = await request(app)
      .post("/api/spaces/11111111-1111-4111-8111-111111111111/imports/apply")
      .send({
        source: { type: "inline", files: { "COMPANY.md": "---\nname: Test\n---\n" } },
        include: { space: true, agents: true, projects: false, issues: false },
        target: { mode: "existing_space", spaceId: "11111111-1111-4111-8111-111111111111" },
        collisionStrategy: "rename",
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Missing explicit permission to manage space imports");
    expect(mockSpacePortabilityService.importBundle).not.toHaveBeenCalled();
  });

  it("requires instance admin for new-space import apply", async () => {
    const app = await createApp({
      type: "operator",
      userId: "user-1",
      spaceIds: ["11111111-1111-4111-8111-111111111111"],
      source: "session",
      isInstanceAdmin: false,
    });

    const res = await request(app)
      .post("/api/spaces/import")
      .send({
        source: { type: "inline", files: { "COMPANY.md": "---\nname: Test\n---\n" } },
        include: { space: true, agents: true, projects: false, issues: false },
        target: { mode: "new_space", newSpaceName: "Imported Test" },
        collisionStrategy: "rename",
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Instance admin");
    expect(mockSpacePortabilityService.importBundle).not.toHaveBeenCalled();
  });

  it("accepts trusted Cloud async import jobs and reports success by job id", async () => {
    let resolveImport: (value: ReturnType<typeof createImportResult>) => void = () => undefined;
    const pendingImport = new Promise<ReturnType<typeof createImportResult>>((resolve) => {
      resolveImport = resolve;
    });
    mockSpacePortabilityService.importBundle.mockReturnValueOnce(pendingImport);
    const app = await createApp(cloudTenantActor());

    const accepted = await request(app)
      .post("/api/spaces/import")
      .set("x-outpost-cloud-async-import", "1")
      .set(cloudHeaders)
      .send(importRequest);

    expect(accepted.status).toBe(202);
    expect(accepted.body.job.status).toBe("running");
    expect(accepted.body.statusUrl).toMatch(/^\/api\/spaces\/import\/jobs\/tenant-import-/);
    expect(accepted.body.retryAfterMs).toBe(1000);
    await waitForCondition(() => mockSpacePortabilityService.importBundle.mock.calls.length === 1, "import job start");
    expect(mockSpacePortabilityService.importBundle).toHaveBeenCalledWith(importRequest, "cloud-user-1", { pauseAutomations: false });
    expect(mockLogActivity).not.toHaveBeenCalled();

    resolveImport(createImportResult("updated"));
    const succeeded = await waitForImportJobStatus(app, accepted.body.statusUrl, "succeeded");

    expect(succeeded.status).toBe(200);
    expect(succeeded.body.job.status).toBe("succeeded");
    expect(succeeded.body.job.result.spaceId).toBe(spaceId);
    expect(succeeded.body.retryAfterMs).toBeUndefined();
    expect(mockLogActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "space.imported",
      spaceId,
      details: expect.objectContaining({
        agentCount: 1,
        warningCount: 0,
        spaceAction: "updated",
      }),
    }));

    const completedAtMs = Date.parse(succeeded.body.job.completedAt);

    // A completed job stays resolvable well past the old 5-minute retention so a
    // user who steps away during a long import never polls into a false 404.
    const withinWindow = vi.spyOn(Date, "now").mockReturnValue(completedAtMs + (5 * 60 * 1000) + 1);
    try {
      const stillThere = await request(app).get(accepted.body.statusUrl).set(cloudHeaders);
      expect(stillThere.status).toBe(200);
      expect(stillThere.body.job.status).toBe("succeeded");
      expect(stillThere.body.job.result.spaceId).toBe(spaceId);
    } finally {
      withinWindow.mockRestore();
    }

    // Only past the extended 60-minute window is the in-memory record finally
    // dropped, and only then does the status route report the job as gone.
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(completedAtMs + (60 * 60 * 1000) + 1);
    try {
      const expired = await request(app).get(accepted.body.statusUrl).set(cloudHeaders);
      expect(expired.status).toBe(404);
      expect(expired.body.error).toBe("Import job not found");
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("reports trusted Cloud async import job failures with the tenant error message", async () => {
    mockSpacePortabilityService.importBundle.mockRejectedValueOnce(new Error("tenant import exploded"));
    const app = await createApp(cloudTenantActor());

    const accepted = await request(app)
      .post("/api/spaces/import")
      .set("x-outpost-cloud-async-import", "1")
      .set(cloudHeaders)
      .send(importRequest);

    expect(accepted.status).toBe(202);
    const failed = await waitForImportJobStatus(app, accepted.body.statusUrl, "failed");

    expect(failed.status).toBe(200);
    expect(failed.body.job.status).toBe("failed");
    expect(failed.body.job.error.message).toBe("tenant import exploded");
    expect(failed.body.retryAfterMs).toBeUndefined();
    expect(failed.body.message).toBe("tenant import exploded");
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("accepts trusted Cloud async import jobs before validating the full import payload", async () => {
    const app = await createApp(cloudTenantActor());

    const accepted = await request(app)
      .post("/api/spaces/import")
      .set("x-outpost-cloud-async-import", "1")
      .set(cloudHeaders)
      .send({ target: { mode: "existing_space", spaceId } });

    expect(accepted.status).toBe(202);
    expect(accepted.body.job.status).toBe("running");
    expect(mockSpacePortabilityService.importBundle).not.toHaveBeenCalled();

    const failed = await waitForImportJobStatus(app, accepted.body.statusUrl, "failed");

    expect(failed.status).toBe(200);
    expect(failed.body.job.status).toBe("failed");
    expect(failed.body.job.error.message).toEqual(expect.any(String));
    expect(mockSpacePortabilityService.importBundle).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("floors global import apply on a cloud-managed instance, even for the trusted tenant actor", async () => {
    // The trusted-tenant tests above run without the cloud env signal on
    // purpose: the import floor keys on isCloudManagedInstance(), not on the
    // actor. With the signal present, even the trusted tenant actor is
    // floored — importing is disabled on cloud-managed instances outright.
    vi.stubEnv("OUTPOST_CLOUD_TENANT_SERVER_TOKEN", "tenant-secret");
    try {
      const app = await createApp(cloudTenantActor());

      const res = await request(app)
        .post("/api/spaces/import")
        .set(cloudHeaders)
        .send(importRequest);

      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ code: "cloud_managed" });
      expect(mockSpacePortabilityService.importBundle).not.toHaveBeenCalled();
      expect(mockLogActivity).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("forwards pauseAutomations from the global import body to the portability service", async () => {
    mockSpacePortabilityService.importBundle.mockResolvedValueOnce(createImportResult("created"));
    const app = await createApp(cloudTenantActor());

    const res = await request(app)
      .post("/api/spaces/import")
      .set(cloudHeaders)
      .send({ ...importRequest, pauseAutomations: true });

    expect(res.status).toBe(200);
    expect(mockSpacePortabilityService.importBundle).toHaveBeenCalledWith(
      { ...importRequest, pauseAutomations: true },
      "cloud-user-1",
      { pauseAutomations: true },
    );
  });

  it("runs operator-session async imports as jobs and reports the full result by job id", async () => {
    let resolveImport: (value: ReturnType<typeof createImportResult>) => void = () => undefined;
    const pendingImport = new Promise<ReturnType<typeof createImportResult>>((resolve) => {
      resolveImport = resolve;
    });
    mockSpacePortabilityService.importBundle.mockReturnValueOnce(pendingImport);
    const app = await createOperatorApp();

    const accepted = await request(app)
      .post("/api/spaces/import")
      .set("x-outpost-cloud-async-import", "1")
      .set(TEST_USER_HEADER, "operator-user-a")
      .send(importRequest);

    expect(accepted.status).toBe(202);
    expect(accepted.body.job.status).toBe("running");
    // Operator jobs get their own id prefix, distinct from the tenant-import prefix.
    expect(accepted.body.statusUrl).toMatch(/^\/api\/spaces\/import\/jobs\/import-/);
    expect(accepted.body.statusUrl).not.toMatch(/\/jobs\/tenant-import-/);
    await waitForCondition(() => mockSpacePortabilityService.importBundle.mock.calls.length === 1, "operator import start");
    expect(mockSpacePortabilityService.importBundle).toHaveBeenCalledWith(importRequest, "operator-user-a", { pauseAutomations: false });

    const fullResult = createImportResult("created");
    resolveImport(fullResult);
    const succeeded = await waitForImportJobStatusAs(app, accepted.body.statusUrl, "succeeded", {
      [TEST_USER_HEADER]: "operator-user-a",
    });

    expect(succeeded.status).toBe(200);
    expect(succeeded.body.job.status).toBe("succeeded");
    expect(succeeded.body.job.result.spaceId).toBe(spaceId);
    // Parity with the synchronous response: the operator job carries the full
    // import result so the import page can run the same activation path.
    expect(succeeded.body.job.importResult).toEqual(fullResult);
    expect(mockLogActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "space.imported",
      spaceId,
    }));
  });

  it("hides an operator import job from other operator users", async () => {
    mockSpacePortabilityService.importBundle.mockReturnValueOnce(new Promise(() => undefined));
    const app = await createOperatorApp();

    const accepted = await request(app)
      .post("/api/spaces/import")
      .set("x-outpost-cloud-async-import", "1")
      .set(TEST_USER_HEADER, "operator-user-a")
      .send(importRequest);

    expect(accepted.status).toBe(202);

    const crossUser = await request(app).get(accepted.body.statusUrl).set(TEST_USER_HEADER, "operator-user-b");
    expect(crossUser.status).toBe(404);
    expect(crossUser.body.error).toBe("Import job not found");

    const owner = await request(app).get(accepted.body.statusUrl).set(TEST_USER_HEADER, "operator-user-a");
    expect(owner.status).toBe(200);
    expect(owner.body.job.status).toBe("running");
  });

  it("returns 409 with the running job when an operator user resubmits an import", async () => {
    mockSpacePortabilityService.importBundle.mockReturnValueOnce(new Promise(() => undefined));
    const app = await createOperatorApp();

    const first = await request(app)
      .post("/api/spaces/import")
      .set("x-outpost-cloud-async-import", "1")
      .set(TEST_USER_HEADER, "operator-user-a")
      .send(importRequest);

    expect(first.status).toBe(202);

    const duplicate = await request(app)
      .post("/api/spaces/import")
      .set("x-outpost-cloud-async-import", "1")
      .set(TEST_USER_HEADER, "operator-user-a")
      .send(importRequest);

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.job.id).toBe(first.body.job.id);
    expect(duplicate.body.statusUrl).toBe(first.body.statusUrl);
    // The duplicate submit must not start a second import of the same bundle.
    expect(mockSpacePortabilityService.importBundle).toHaveBeenCalledTimes(1);

    // A different operator user is not blocked by the first user's running job.
    mockSpacePortabilityService.importBundle.mockReturnValueOnce(new Promise(() => undefined));
    const otherUser = await request(app)
      .post("/api/spaces/import")
      .set("x-outpost-cloud-async-import", "1")
      .set(TEST_USER_HEADER, "operator-user-b")
      .send(importRequest);

    expect(otherUser.status).toBe(202);
    expect(otherUser.body.job.id).not.toBe(first.body.job.id);
  });

  it(
    "rejects a concurrent different import without adopting the running job",
    async () => {
      mockSpacePortabilityService.importBundle.mockReturnValueOnce(new Promise(() => undefined));
      const app = await createOperatorApp();

      const first = await request(app)
        .post("/api/spaces/import")
        .set("x-outpost-cloud-async-import", "1")
        .set(TEST_USER_HEADER, "operator-user-a")
        .send(importRequest);

      expect(first.status).toBe(202);

      // Same user, a *different* import (another destination) while the first
      // still runs. It must NOT adopt the first job — adopting would show the
      // wrong result and switch to the wrong space — so the 409 carries no
      // job to watch, and no second import starts.
      const different = await request(app)
        .post("/api/spaces/import")
        .set("x-outpost-cloud-async-import", "1")
        .set(TEST_USER_HEADER, "operator-user-a")
        .send({ ...importRequest, target: { mode: "new_space", newSpaceName: "A Different Destination" } });

      expect(different.status).toBe(409);
      expect(different.body.job).toBeUndefined();
      expect(different.body.statusUrl).toBeUndefined();
      expect(different.body.error).toMatch(/different import is already running/i);
      expect(mockSpacePortabilityService.importBundle).toHaveBeenCalledTimes(1);
    },
  );

  it("fails an operator async import job when the bundle import throws", async () => {
    mockSpacePortabilityService.importBundle.mockRejectedValueOnce(new Error("import payload is incomplete"));
    const app = await createOperatorApp();

    const accepted = await request(app)
      .post("/api/spaces/import")
      .set("x-outpost-cloud-async-import", "1")
      .set(TEST_USER_HEADER, "operator-user-a")
      .send(importRequest);

    expect(accepted.status).toBe(202);

    const failed = await waitForImportJobStatusAs(app, accepted.body.statusUrl, "failed", {
      [TEST_USER_HEADER]: "operator-user-a",
    });

    expect(failed.status).toBe(200);
    expect(failed.body.job.status).toBe("failed");
    expect(failed.body.job.error.message).toBe("import payload is incomplete");
    expect(failed.body.job.importResult).toBeUndefined();
    // A resubmit is allowed once the job is terminal.
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("keeps the import job status route operator-only", async () => {
    const app = await createApp({
      type: "agent",
      agentId: workerAgentId,
      spaceId,
      source: "agent_key",
      runId: "run-1",
    });

    const res = await request(app).get("/api/spaces/import/jobs/import-does-not-exist");

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Operator access required");
  });

  it("returns 404 for an unknown import job id", async () => {
    const app = await createOperatorApp();

    const res = await request(app)
      .get("/api/spaces/import/jobs/import-missing")
      .set(TEST_USER_HEADER, "operator-user-a");

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Import job not found");
  });

  it("forwards pauseAutomations from agent-safe import apply bodies to the portability service", async () => {
    mockSpacePortabilityService.importBundle.mockResolvedValueOnce(createImportResult("created"));
    const app = await createApp({
      type: "agent",
      agentId: rootAgentId,
      spaceId,
      source: "agent_key",
      runId: "run-1",
    });

    const res = await request(app)
      .post(`/api/spaces/${spaceId}/imports/apply`)
      .send({ ...importRequest, pauseAutomations: true });

    expect(res.status).toBe(200);
    expect(mockSpacePortabilityService.importBundle).toHaveBeenCalledWith(
      { ...importRequest, pauseAutomations: true },
      null,
      { mode: "agent_safe", sourceSpaceId: spaceId, actorAgentId: rootAgentId, actorAgentSpaceId: spaceId, pauseAutomations: true, assertCanCreateAgents: expect.any(Function) },
    );
  });

  it("refuses an agent whose create grant is revoked while its import creates agents", async () => {
    mockAccessService.decide
      .mockResolvedValueOnce({
        allowed: true,
        action: "agents:create",
        reason: "allow_explicit_grant",
        explanation: "Explicit permission granted.",
      })
      .mockResolvedValueOnce({
        allowed: false,
        action: "agents:create",
        reason: "deny_missing_grant",
        explanation: "Missing permission: agents:create.",
      });
    mockSpacePortabilityService.importBundle.mockImplementationOnce(async (_body: unknown, _user: unknown, options: { assertCanCreateAgents?: () => Promise<void> }) => {
      await options.assertCanCreateAgents?.();
      return createImportResult("created");
    });
    const app = await createApp({ type: "agent", agentId: rootAgentId, spaceId, source: "agent_key", runId: "run-1" });

    const res = await request(app).post(`/api/spaces/${spaceId}/imports/apply`).send(importRequest);

    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toContain("Missing permission: agents:create.");
    expect(res.body.error).toContain("Importing new agents is creation");
    expect(mockAccessService.decide).toHaveBeenCalledWith(expect.objectContaining({
      action: "agents:create", resource: { type: "space", spaceId },
    }));
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("imports a space from a multipart zip upload, unzipping into the same inline bundle", async () => {
    const app = await createOperatorApp();
    const files = { "COMPANY.md": "---\nname: Test\n---\n", "agents/lead/AGENTS.md": "---\nname: Lead\n---\n" };
    const zip = buildStoreZip(files, "outpost");

    const res = await request(app)
      .post("/api/spaces/import")
      .set(TEST_USER_HEADER, "operator-user-a")
      .field("meta", JSON.stringify(importMeta))
      .attach("package", zip, "outpost-demo.zip");

    expect(res.status).toBe(200);
    expect(mockSpacePortabilityService.importBundle).toHaveBeenCalledTimes(1);
    const call = mockSpacePortabilityService.importBundle.mock.calls[0]!;
    // The uploaded zip is unzipped into the exact inline source the importer
    // consumes; the other import fields ride along from the JSON meta field.
    expect(call[0]).toEqual({ ...importMeta, source: { type: "inline", rootPath: "outpost", files } });
    expect(call[1]).toBe("operator-user-a");
    expect(call[2]).toEqual({ pauseAutomations: false });
  });

  it("previews a space from a multipart zip upload", async () => {
    const app = await createOperatorApp();
    const files = { "COMPANY.md": "---\nname: Test\n---\n" };
    const zip = buildStoreZip(files, "outpost");

    const res = await request(app)
      .post("/api/spaces/import/preview")
      .set(TEST_USER_HEADER, "operator-user-a")
      .field("meta", JSON.stringify(importMeta))
      .attach("package", zip, "outpost-demo.zip");

    expect(res.status).toBe(200);
    expect(mockSpacePortabilityService.previewImport).toHaveBeenCalledTimes(1);
    const call = mockSpacePortabilityService.previewImport.mock.calls[0]!;
    expect(call[0]).toEqual({ ...importMeta, source: { type: "inline", rootPath: "outpost", files } });
  });

  it("runs a multipart zip import as an async operator job via ?async=1", async () => {
    let resolveImport: (value: ReturnType<typeof createImportResult>) => void = () => undefined;
    const pendingImport = new Promise<ReturnType<typeof createImportResult>>((resolve) => {
      resolveImport = resolve;
    });
    mockSpacePortabilityService.importBundle.mockReturnValueOnce(pendingImport);
    const app = await createOperatorApp();
    const files = { "COMPANY.md": "---\nname: Test\n---\n" };
    const zip = buildStoreZip(files, "outpost");

    const accepted = await request(app)
      .post("/api/spaces/import?async=1")
      .set(TEST_USER_HEADER, "operator-user-a")
      .field("meta", JSON.stringify(importMeta))
      .attach("package", zip, "outpost-demo.zip");

    expect(accepted.status).toBe(202);
    expect(accepted.body.job.status).toBe("running");
    expect(accepted.body.statusUrl).toMatch(/^\/api\/spaces\/import\/jobs\/import-/);
    await waitForCondition(
      () => mockSpacePortabilityService.importBundle.mock.calls.length === 1,
      "multipart async import start",
    );
    expect(mockSpacePortabilityService.importBundle.mock.calls[0]![0]).toEqual({
      ...importMeta,
      source: { type: "inline", rootPath: "outpost", files },
    });

    const fullResult = createImportResult("created");
    resolveImport(fullResult);
    const succeeded = await waitForImportJobStatusAs(app, accepted.body.statusUrl, "succeeded", {
      [TEST_USER_HEADER]: "operator-user-a",
    });
    expect(succeeded.body.job.status).toBe("succeeded");
    expect(succeeded.body.job.importResult).toEqual(fullResult);
  });

  it("engages the async path for operator sessions via ?async=1, not the stripped cloud header", async () => {
    mockSpacePortabilityService.importBundle.mockReturnValueOnce(new Promise(() => undefined));
    const app = await createOperatorApp();

    // The Cloud harness strips inbound x-outpost-cloud-* headers, so a browser
    // can only opt into async with the proxy-safe query parameter.
    const accepted = await request(app)
      .post("/api/spaces/import?async=1")
      .set(TEST_USER_HEADER, "operator-user-a")
      .send(importRequest);

    expect(accepted.status).toBe(202);
    expect(accepted.body.job.status).toBe("running");
    expect(accepted.body.statusUrl).toMatch(/^\/api\/spaces\/import\/jobs\/import-/);
  });

  it("keeps an operator import synchronous when neither async signal is present", async () => {
    const app = await createOperatorApp();

    const res = await request(app)
      .post("/api/spaces/import")
      .set(TEST_USER_HEADER, "operator-user-a")
      .send(importRequest);

    expect(res.status).toBe(200);
    expect(res.body.space.id).toBe(spaceId);
  });

  it("still engages the async path for cloud tenants via the x-outpost-cloud-async-import header", async () => {
    mockSpacePortabilityService.importBundle.mockReturnValueOnce(new Promise(() => undefined));
    const app = await createApp(cloudTenantActor());

    const accepted = await request(app)
      .post("/api/spaces/import")
      .set("x-outpost-cloud-async-import", "1")
      .set(cloudHeaders)
      .send(importRequest);

    expect(accepted.status).toBe(202);
    expect(accepted.body.statusUrl).toMatch(/^\/api\/spaces\/import\/jobs\/tenant-import-/);
  });

  it("rejects a truncated zip upload without importing anything", async () => {
    const app = await createOperatorApp();
    const zip = buildStoreZip({ "COMPANY.md": "---\nname: Test\n---\n" }, "outpost");
    const truncated = zip.subarray(0, 40);

    const res = await request(app)
      .post("/api/spaces/import")
      .set(TEST_USER_HEADER, "operator-user-a")
      .field("meta", JSON.stringify(importMeta))
      .attach("package", truncated, "outpost-demo.zip");

    expect(res.status).toBe(400);
    expect(mockSpacePortabilityService.importBundle).not.toHaveBeenCalled();
  });
});
