import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const spaceAId = "11111111-1111-4111-8111-111111111111";
const spaceBId = "22222222-2222-4222-8222-222222222222";
const rootAgentId = "root-agent-a";

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
  ensureRoleDefaultGrants: vi.fn(),
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

function registerSpaceRouteMocks() {
  vi.doMock("../services/index.js", () => ({
    accessService: () => mockAccessService,
    agentService: () => mockAgentService,
    budgetService: () => mockBudgetService,
    spaceArtifactsService: () => mockSpaceArtifactsService,
    spacePortabilityService: () => mockSpacePortabilityService,
    spaceService: () => mockSpaceService,
    logActivity: mockLogActivity,
  }));
}

let appImportCounter = 0;

async function createApp(actor: Record<string, unknown>) {
  registerSpaceRouteMocks();
  appImportCounter += 1;
  const routeModulePath = `../routes/spaces.js?cross-space-authz-${appImportCounter}`;
  const middlewareModulePath = `../middleware/index.js?cross-space-authz-${appImportCounter}`;
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

function createSpace(id: string) {
  const now = new Date("2026-06-18T00:00:00.000Z");
  return {
    id,
    name: id === spaceAId ? "Space A" : "Space B",
    description: null,
    status: "active",
    issuePrefix: id === spaceAId ? "CPA" : "CPB",
    issueCounter: 1,
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    requireOperatorApprovalForNewAgents: false,
    feedbackDataSharingEnabled: false,
    logoAssetId: null,
    logoUrl: null,
    createdAt: now,
    updatedAt: now,
  };
}

const exportRequest = {
  include: { space: true, agents: true, projects: true },
};

function exportResult() {
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
      generatedAt: "2026-06-18T00:00:00.000Z",
      source: null,
    },
    files: {},
    warnings: [],
  };
}

function exportPreviewResult() {
  return {
    ...exportResult(),
    fileInventory: [],
    counts: { files: 0, agents: 0, skills: 0, projects: 0, issues: 0 },
    outpostExtensionPath: ".outpost.yaml",
  };
}

function importRequest(targetSpaceId = spaceBId) {
  return {
    source: { type: "inline", files: { "COMPANY.md": "---\nname: Imported\n---\n" } },
    include: { space: true, agents: true, projects: false, issues: false },
    target: { mode: "existing_space", spaceId: targetSpaceId },
    collisionStrategy: "rename",
  };
}

function importResult(spaceId = spaceBId) {
  return {
    space: { id: spaceId, action: "updated" },
    agents: [],
    warnings: [],
  };
}

function resetMockDefaults() {
  mockSpaceService.getById.mockImplementation(async (id: string) => {
    if (id === spaceAId || id === spaceBId) return createSpace(id);
    return null;
  });
  mockSpaceService.update.mockImplementation(async (id: string, body: Record<string, unknown>) => ({
    ...createSpace(id),
    ...body,
  }));
  mockSpaceService.archive.mockImplementation(async (id: string) => ({
    ...createSpace(id),
    status: "archived",
  }));
  mockSpaceService.remove.mockImplementation(async (id: string) => createSpace(id));
  mockAgentService.getById.mockImplementation(async (id: string) => {
    if (id === rootAgentId) return { id, spaceId: spaceAId, role: "general", reportsTo: null };
    return null;
  });
  mockAgentService.list.mockResolvedValue([]);
  mockSpacePortabilityService.exportBundle.mockResolvedValue(exportResult());
  mockSpacePortabilityService.previewExport.mockResolvedValue(exportPreviewResult());
  mockSpacePortabilityService.previewImport.mockResolvedValue({ ok: true });
  mockSpacePortabilityService.importBundle.mockResolvedValue(importResult());
  mockAccessService.decide.mockResolvedValue({
    allowed: true,
    action: "space_scope:read",
    reason: "allow_explicit_grant",
    explanation: "Explicit permission granted.",
  });
}

function assertNoTargetMutationSideEffects() {
  expect(mockSpaceService.update).not.toHaveBeenCalled();
  expect(mockSpaceService.archive).not.toHaveBeenCalled();
  expect(mockSpaceService.remove).not.toHaveBeenCalled();
  expect(mockSpacePortabilityService.exportBundle).not.toHaveBeenCalled();
  expect(mockSpacePortabilityService.previewExport).not.toHaveBeenCalled();
  expect(mockSpacePortabilityService.previewImport).not.toHaveBeenCalled();
  expect(mockSpacePortabilityService.importBundle).not.toHaveBeenCalled();
  expect(mockLogActivity).not.toHaveBeenCalled();
}

function spaceARootAgent() {
  return {
    type: "agent",
    agentId: rootAgentId,
    spaceId: spaceAId,
    source: "agent_key",
    runId: "run-1",
  };
}

function operatorActor(input: {
  userId: string;
  spaceIds?: string[];
  memberships?: Array<{ spaceId: string; membershipRole: string; status: string }>;
  isInstanceAdmin?: boolean;
  source?: string;
}) {
  return {
    type: "operator",
    userId: input.userId,
    source: input.source ?? "session",
    spaceIds: input.spaceIds ?? [],
    memberships: input.memberships ?? [],
    isInstanceAdmin: input.isInstanceAdmin ?? false,
  };
}

describe("space route cross-space authorization", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("../routes/authz.js");
    vi.doUnmock("../middleware/index.js");
    vi.clearAllMocks();
    resetMockDefaults();
  });

  it.each(["session", "operator_key", "cloud_tenant"])(
    "limits navigable spaces to memberships for a %s instance admin",
    async (source) => {
      mockSpaceService.list.mockResolvedValue([createSpace(spaceBId), createSpace(spaceAId)]);
      const app = await createApp(operatorActor({
        userId: "owner-a",
        source,
        isInstanceAdmin: true,
        spaceIds: [spaceAId],
      }));

      const navigation = await request(app).get("/api/spaces?scope=accessible").expect(200);
      expect(navigation.body.map((space: { id: string }) => space.id)).toEqual([spaceAId]);
      await request(app).get(`/api/spaces/${spaceAId}`).expect(200);
      await request(app).get(`/api/spaces/${spaceBId}`).expect(403);

      // The existing directory remains available for instance administration.
      const directory = await request(app).get("/api/spaces").expect(200);
      expect(directory.body.map((space: { id: string }) => space.id)).toEqual([spaceBId, spaceAId]);
    },
  );

  it.each([false, true])("returns no navigable spaces without memberships (admin=%s)", async (isInstanceAdmin) => {
    mockSpaceService.list.mockResolvedValue([createSpace(spaceAId)]);
    const app = await createApp(operatorActor({ userId: "outsider", isInstanceAdmin }));
    const res = await request(app).get("/api/spaces?scope=accessible").expect(200);
    expect(res.body).toEqual([]);
  });

  it.each(["scope=accessible&scope=accessible", "scope=accessible&scope=all", "scope=all", "scope="])(
    "rejects malformed list scope without loading the directory: %s",
    async (query) => {
      const app = await createApp(operatorActor({ userId: "admin", isInstanceAdmin: true }));
      await request(app).get(`/api/spaces?${query}`).expect(400);
      expect(mockSpaceService.list).not.toHaveBeenCalled();
    },
  );

  it("includes additional spaces where a cloud user has membership", async () => {
    mockSpaceService.list.mockResolvedValue([createSpace(spaceAId), createSpace(spaceBId)]);
    const app = await createApp(operatorActor({
      userId: "owner-of-both",
      source: "cloud_tenant",
      spaceIds: [spaceAId, spaceBId],
    }));
    const res = await request(app).get("/api/spaces?scope=accessible").expect(200);
    expect(res.body.map((space: { id: string }) => space.id)).toEqual([spaceAId, spaceBId]);
    await request(app).get(`/api/spaces/${spaceBId}`).expect(200);
  });

  it("keeps all spaces navigable for the local trusted operator", async () => {
    mockSpaceService.list.mockResolvedValue([createSpace(spaceAId), createSpace(spaceBId)]);
    const app = await createApp(operatorActor({ userId: "local-operator", source: "local_implicit" }));
    const res = await request(app).get("/api/spaces?scope=accessible").expect(200);
    expect(res.body.map((space: { id: string }) => space.id)).toEqual([spaceAId, spaceBId]);
  });

  it.each([{ type: "none", source: "none" }, spaceARootAgent()])(
    "rejects navigation list requests from a $type actor",
    async (actor) => {
      const app = await createApp(actor);
      await request(app).get("/api/spaces?scope=accessible").expect(403);
      expect(mockSpaceService.list).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      label: "GET /api/spaces/:spaceId",
      request: (app: express.Express) => request(app).get(`/api/spaces/${spaceBId}`),
    },
    {
      label: "PATCH /api/spaces/:spaceId",
      request: (app: express.Express) => request(app).patch(`/api/spaces/${spaceBId}`).send({ description: "Nope" }),
    },
    {
      label: "PATCH /api/spaces/:spaceId/branding",
      request: (app: express.Express) => request(app).patch(`/api/spaces/${spaceBId}/branding`).send({ description: "Nope" }),
    },
    {
      label: "POST /api/spaces/:spaceId/archive",
      request: (app: express.Express) => request(app).post(`/api/spaces/${spaceBId}/archive`).send({}),
    },
    {
      label: "DELETE /api/spaces/:spaceId",
      request: (app: express.Express) => request(app).delete(`/api/spaces/${spaceBId}`),
    },
    {
      label: "POST /api/spaces/:spaceId/export",
      request: (app: express.Express) => request(app).post(`/api/spaces/${spaceBId}/export`).send(exportRequest),
    },
    {
      label: "POST /api/spaces/:spaceId/exports/preview",
      request: (app: express.Express) => request(app).post(`/api/spaces/${spaceBId}/exports/preview`).send(exportRequest),
    },
    {
      label: "GET /api/spaces/:spaceId/export/fidelity",
      request: (app: express.Express) => request(app).get(`/api/spaces/${spaceBId}/export/fidelity`),
    },
    {
      label: "POST /api/spaces/:spaceId/imports/preview",
      request: (app: express.Express) => request(app).post(`/api/spaces/${spaceBId}/imports/preview`).send(importRequest()),
    },
    {
      label: "POST /api/spaces/:spaceId/imports/apply",
      request: (app: express.Express) => request(app).post(`/api/spaces/${spaceBId}/imports/apply`).send(importRequest()),
    },
  ])("rejects a space A agent attempting space B operation: $label", async ({ request: buildRequest }) => {
    const app = await createApp(spaceARootAgent());

    const res = await buildRequest(app);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/another space|access to this space|active space access/i);
    assertNoTargetMutationSideEffects();
  });

  it("allows a same-Space root agent with explicit permissions to use portability routes without allowing operator settings or lifecycle routes", async () => {
    const app = await createApp(spaceARootAgent());

    await request(app).get(`/api/spaces/${spaceAId}`).expect(200);
    await request(app).patch(`/api/spaces/${spaceAId}`).send({ description: "Branding" }).expect(403);
    await request(app).patch(`/api/spaces/${spaceAId}/branding`).send({ description: "Branding" }).expect(403);
    await request(app).post(`/api/spaces/${spaceAId}/export`).send(exportRequest).expect(200);
    await request(app).post(`/api/spaces/${spaceAId}/exports/preview`).send(exportRequest).expect(200);
    await request(app).post(`/api/spaces/${spaceAId}/imports/preview`).send(importRequest(spaceAId)).expect(200);
    await request(app).post(`/api/spaces/${spaceAId}/imports/apply`).send(importRequest(spaceAId)).expect(200);

    const archive = await request(app).post(`/api/spaces/${spaceAId}/archive`).send({});
    expect(archive.status).toBe(403);
    expect(archive.body.error).toContain("Operator access required");
    const remove = await request(app).delete(`/api/spaces/${spaceAId}`);
    expect(remove.status).toBe(403);
    expect(remove.body.error).toContain("Operator access required");
  });

  it("covers operator actor access for non-member, viewer, active member, local trusted operator, and instance admin without target membership", async () => {
    const nonMemberApp = await createApp(operatorActor({ userId: "outsider" }));
    const nonMember = await request(nonMemberApp).get(`/api/spaces/${spaceBId}`);
    expect(nonMember.status).toBe(403);
    expect(nonMember.body.error).toContain("access to this space");

    vi.clearAllMocks();
    resetMockDefaults();
    const viewerApp = await createApp(operatorActor({
      userId: "viewer",
      spaceIds: [spaceBId],
      memberships: [{ spaceId: spaceBId, membershipRole: "viewer", status: "active" }],
    }));
    await request(viewerApp).get(`/api/spaces/${spaceBId}`).expect(200);
    const viewerWrite = await request(viewerApp).patch(`/api/spaces/${spaceBId}`).send({ description: "Nope" });
    expect(viewerWrite.status).toBe(403);
    expect(viewerWrite.body.error).toContain("Viewer access is read-only");
    expect(mockSpaceService.update).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();

    vi.clearAllMocks();
    resetMockDefaults();
    const memberApp = await createApp(operatorActor({
      userId: "member",
      spaceIds: [spaceBId],
      memberships: [{ spaceId: spaceBId, membershipRole: "member", status: "active" }],
    }));
    await request(memberApp).patch(`/api/spaces/${spaceBId}`).send({ description: "Updated" }).expect(200);
    await request(memberApp).patch(`/api/spaces/${spaceBId}/branding`).send({ description: "Branding" }).expect(200);
    await request(memberApp).post(`/api/spaces/${spaceBId}/archive`).send({}).expect(200);
    await request(memberApp).delete(`/api/spaces/${spaceBId}`).expect(200);
    await request(memberApp).post(`/api/spaces/${spaceBId}/export`).send(exportRequest).expect(200);
    await request(memberApp).post(`/api/spaces/${spaceBId}/exports/preview`).send(exportRequest).expect(200);
    await request(memberApp).post(`/api/spaces/${spaceBId}/imports/preview`).send(importRequest()).expect(200);
    await request(memberApp).post(`/api/spaces/${spaceBId}/imports/apply`).send(importRequest()).expect(200);

    vi.clearAllMocks();
    resetMockDefaults();
    const localTrustedApp = await createApp(operatorActor({
      userId: "local-operator",
      source: "local_implicit",
      isInstanceAdmin: true,
    }));
    await request(localTrustedApp).get(`/api/spaces/${spaceBId}`).expect(200);
    await request(localTrustedApp).patch(`/api/spaces/${spaceBId}`).send({ description: "Local" }).expect(200);

    vi.clearAllMocks();
    resetMockDefaults();
    const adminWithoutMembershipApp = await createApp(operatorActor({
      userId: "instance-admin",
      isInstanceAdmin: true,
    }));
    const adminRead = await request(adminWithoutMembershipApp).get(`/api/spaces/${spaceBId}`);
    expect(adminRead.status).toBe(403);
    expect(adminRead.body.error).toContain("access to this space");
    const adminWrite = await request(adminWithoutMembershipApp).patch(`/api/spaces/${spaceBId}`).send({ description: "Admin" });
    expect(adminWrite.status).toBe(403);
    expect(adminWrite.body.error).toContain("access to this space");
    assertNoTargetMutationSideEffects();
  });
});
