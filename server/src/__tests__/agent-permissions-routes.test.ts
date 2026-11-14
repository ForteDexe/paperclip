import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LOW_TRUST_REVIEW_PRESET } from "@outpost/shared";
import { hoistModuleGraph } from "./helpers/hoist-module-graph.js";

vi.mock("acpx/runtime", () => ({
  createAcpRuntime: vi.fn(),
  createAgentRegistry: vi.fn(),
  createRuntimeStore: vi.fn(),
  isAcpRuntimeError: vi.fn(() => false),
}));

const agentId = "11111111-1111-4111-8111-111111111111";
const spaceId = "22222222-2222-4222-8222-222222222222";

const baseAgent = {
  id: agentId,
  spaceId,
  name: "Builder",
  urlKey: "builder",
  role: "engineer",
  title: "Builder",
  icon: null,
  status: "idle",
  leadAgentId: null,
  capabilities: null,
  adapterType: "process",
  adapterConfig: {},
  runtimeConfig: {},
  budgetMonthlyCents: 0,
  spentMonthlyCents: 0,
  pauseReason: null,
  pausedAt: null,
  permissions: { canCreateAgents: false },
  lastHeartbeatAt: null,
  metadata: null,
  createdAt: new Date("2026-03-19T00:00:00.000Z"),
  updatedAt: new Date("2026-03-19T00:00:00.000Z"),
};

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
  getConfigRevision: vi.fn(),
  listConfigRevisions: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  activatePendingApproval: vi.fn(),
  terminate: vi.fn(),
  update: vi.fn(),
  updateAndTransition: vi.fn(),
  rollbackConfigRevision: vi.fn(),
  updatePermissions: vi.fn(),
  getCoordinationChain: vi.fn(),
  resolveByReference: vi.fn(),
}));

const mockBuiltInAgentService = vi.hoisted(() => ({
  ensureSpaceDefaultAgentGrants: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  canUser: vi.fn(),
  decide: vi.fn(),
  hasPermission: vi.fn(),
  getMembership: vi.fn(),
  ensureMembership: vi.fn(),
  listPrincipalGrants: vi.fn(),
  setPrincipalPermission: vi.fn(),
}));

const mockApprovalService = vi.hoisted(() => ({
  create: vi.fn(),
  getById: vi.fn(),
  findOpenCreationApprovalForAgent: vi.fn(),
  approveCreation: vi.fn(),
  rejectCreation: vi.fn(),
}));

const mockBudgetService = vi.hoisted(() => ({
  upsertPolicy: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  listTaskSessions: vi.fn(),
  resetRuntimeSession: vi.fn(),
  getRun: vi.fn(),
  cancelRun: vi.fn(),
  cancelInvocationsForAgents: vi.fn(),
  cancelActiveForAgent: vi.fn(),
}));

const mockIssueApprovalService = vi.hoisted(() => ({
  linkManyForApproval: vi.fn(),
}));

const mockIssueService = vi.hoisted(() => ({
  list: vi.fn(),
}));

const mockSecretService = vi.hoisted(() => ({
  normalizeAdapterConfigForPersistence: vi.fn(),
  resolveAdapterConfigForRuntime: vi.fn(),
}));

const mockAgentInstructionsService = vi.hoisted(() => ({
  materializeManagedBundle: vi.fn(),
}));
const mockSpaceSkillService = vi.hoisted(() => ({
  listRuntimeSkillEntries: vi.fn(),
  resolveRequestedSkillKeys: vi.fn(),
}));
const mockWorkspaceOperationService = vi.hoisted(() => ({}));
const mockLogActivity = vi.hoisted(() => vi.fn());
const mockTrackAgentCreated = vi.hoisted(() => vi.fn());
const mockGetTelemetryClient = vi.hoisted(() => vi.fn());
const mockSyncInstructionsBundleConfigFromFilePath = vi.hoisted(() => vi.fn());
const mockEnvironmentService = vi.hoisted(() => ({
  getById: vi.fn(),
  listBoundSpaceIds: vi.fn(),
}));

const mockInstanceSettingsService = vi.hoisted(() => ({
  get: vi.fn(),
  getGeneral: vi.fn(),
  getExperimental: vi.fn(),
}));

const mockRunSshCommand = vi.hoisted(() => vi.fn());

function registerModuleMocks() {
  vi.doMock("../lib/agent-runner-platform.js", () => ({
    localAgentRunnerTarget: () => ({ driver: "local", platform: "linux", architecture: "x64", libc: "glibc", glibcVersion: "2.39" }),
    localOutpostRunnerSupported: () => true,
  }));
  vi.doMock("@outpost/adapter-utils/ssh", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@outpost/adapter-utils/ssh")>()),
    runSshCommand: mockRunSshCommand,
  }));

  vi.doMock("@outpost/shared/telemetry", () => ({
    trackAgentCreated: mockTrackAgentCreated,
    trackErrorHandlerCrash: vi.fn(),
  }));

  vi.doMock("../telemetry.js", () => ({
    getTelemetryClient: mockGetTelemetryClient,
  }));

  vi.doMock("../services/agents.js", () => ({
    agentService: () => mockAgentService,
  }));

  vi.doMock("../services/access.js", () => ({
    accessService: () => mockAccessService,
  }));

  vi.doMock("../services/approvals.js", () => ({
    approvalService: () => mockApprovalService,
  }));

  vi.doMock("../services/space-skills.js", () => ({
    spaceSkillService: () => mockSpaceSkillService,
  }));

  vi.doMock("../services/budgets.js", () => ({
    budgetService: () => mockBudgetService,
  }));

  vi.doMock("../services/heartbeat.js", () => ({
    heartbeatService: () => mockHeartbeatService,
  }));

  vi.doMock("../services/issue-approvals.js", () => ({
    issueApprovalService: () => mockIssueApprovalService,
  }));

  vi.doMock("../services/issues.js", () => ({
    issueService: () => mockIssueService,
  }));

  vi.doMock("../services/secrets.js", () => ({
    secretService: () => mockSecretService,
  }));

  vi.doMock("../services/environments.js", () => ({
    environmentService: () => mockEnvironmentService,
  }));

  vi.doMock("../services/agent-instructions.js", () => ({
    agentInstructionsService: () => mockAgentInstructionsService,
    agentInstructionsBundleMode: (agent: { adapterConfig?: unknown }) => {
      const config = agent.adapterConfig as Record<string, unknown> | undefined;
      return config?.instructionsBundleMode === "external" ? "external" : "managed";
    },
    syncInstructionsBundleConfigFromFilePath: mockSyncInstructionsBundleConfigFromFilePath,
  }));

  vi.doMock("../services/workspace-operations.js", () => ({
    workspaceOperationService: () => mockWorkspaceOperationService,
  }));

  vi.doMock("../services/activity-log.js", () => ({
    logActivity: mockLogActivity,
  }));

  vi.doMock("../services/instance-settings.js", () => ({
    instanceSettingsService: () => mockInstanceSettingsService,
  }));

  vi.doMock("../services/index.js", () => ({
    agentService: () => mockAgentService,
    agentInstructionsService: () => mockAgentInstructionsService,
    accessService: () => mockAccessService,
    approvalService: () => mockApprovalService,
    builtInAgentService: () => mockBuiltInAgentService,
    spaceSkillService: () => mockSpaceSkillService,
    budgetService: () => mockBudgetService,
    heartbeatService: () => mockHeartbeatService,
    ISSUE_LIST_DEFAULT_LIMIT: 500,
    issueApprovalService: () => mockIssueApprovalService,
    issueService: () => mockIssueService,
    logActivity: mockLogActivity,
    secretService: () => mockSecretService,
    syncInstructionsBundleConfigFromFilePath: mockSyncInstructionsBundleConfigFromFilePath,
    workspaceOperationService: () => mockWorkspaceOperationService,
    environmentService: () => mockEnvironmentService,
  }));
}

function createDbStub(options: { requireOperatorApprovalForNewAgents?: boolean } = {}) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          then: vi.fn((resolve) =>
            Promise.resolve(resolve([{
              id: spaceId,
              name: "Outpost",
              issuePrefix: "PAP",
              requireOperatorApprovalForNewAgents: options.requireOperatorApprovalForNewAgents ?? false,
            }])),
          ),
        }),
      }),
    }),
  };
}

async function requestApp(
  app: express.Express,
  buildRequest: (baseUrl: string) => request.Test,
) {
  const { createServer } = await vi.importActual<typeof import("node:http")>("node:http");
  const server = createServer(app);
  try {
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected HTTP server to listen on a TCP port");
    }
    return await buildRequest(`http://127.0.0.1:${address.port}`);
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  }
}

describe("agent permission routes", () => {
  const routeModules = hoistModuleGraph(registerModuleMocks, async () => {
    const [{ errorHandler }, { agentRoutes }] = await Promise.all([
      vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
      vi.importActual<typeof import("../routes/agents.js")>("../routes/agents.js"),
    ]);
    return { errorHandler, agentRoutes };
  });

  function createApp(actor: Record<string, unknown>, dbOptions: { requireOperatorApprovalForNewAgents?: boolean } = {}) {
    const { errorHandler, agentRoutes } = routeModules.value;
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).actor = {
        ...actor,
        spaceIds: Array.isArray(actor.spaceIds) ? [...actor.spaceIds] : actor.spaceIds,
      };
      next();
    });
    app.use("/api", agentRoutes(createDbStub(dbOptions) as any));
    app.use(errorHandler);
    return app;
  }

  beforeEach(() => {
    vi.resetAllMocks();
    mockAgentService.getById.mockReset();
    mockAgentService.getConfigRevision.mockReset();
    mockAgentService.listConfigRevisions.mockReset();
    mockAgentService.list.mockReset();
    mockAgentService.create.mockReset();
    mockAgentService.activatePendingApproval.mockReset();
    mockAgentService.terminate.mockReset();
    mockAgentService.update.mockReset();
    mockAgentService.rollbackConfigRevision.mockReset();
    mockAgentService.updatePermissions.mockReset();
    mockAgentService.getCoordinationChain.mockReset();
    mockAgentService.resolveByReference.mockReset();
    mockBuiltInAgentService.ensureSpaceDefaultAgentGrants.mockReset();
    mockAccessService.canUser.mockReset();
    mockAccessService.decide.mockReset();
    mockAccessService.hasPermission.mockReset();
    mockAccessService.getMembership.mockReset();
    mockAccessService.ensureMembership.mockReset();
    mockAccessService.listPrincipalGrants.mockReset();
    mockAccessService.setPrincipalPermission.mockReset();
    mockApprovalService.create.mockReset();
    mockApprovalService.getById.mockReset();
    mockApprovalService.findOpenCreationApprovalForAgent.mockReset();
    mockApprovalService.approveCreation.mockReset();
    mockApprovalService.rejectCreation.mockReset();
    mockBudgetService.upsertPolicy.mockReset();
    mockHeartbeatService.listTaskSessions.mockReset();
    mockHeartbeatService.resetRuntimeSession.mockReset();
    mockHeartbeatService.getRun.mockReset();
    mockHeartbeatService.cancelRun.mockReset();
    mockHeartbeatService.cancelInvocationsForAgents.mockReset();
    mockIssueApprovalService.linkManyForApproval.mockReset();
    mockIssueService.list.mockReset();
    mockSecretService.normalizeAdapterConfigForPersistence.mockReset();
    mockSecretService.resolveAdapterConfigForRuntime.mockReset();
    mockAgentInstructionsService.materializeManagedBundle.mockReset();
    mockSpaceSkillService.listRuntimeSkillEntries.mockReset();
    mockSpaceSkillService.resolveRequestedSkillKeys.mockReset();
    mockLogActivity.mockReset();
    mockTrackAgentCreated.mockReset();
    mockGetTelemetryClient.mockReset();
    mockSyncInstructionsBundleConfigFromFilePath.mockReset();
    mockInstanceSettingsService.get.mockReset().mockResolvedValue({ defaultEnvironmentId: null, experimental: {}, general: {} });
    mockInstanceSettingsService.getExperimental.mockReset().mockResolvedValue({});
    mockInstanceSettingsService.getGeneral.mockReset();
    mockEnvironmentService.listBoundSpaceIds.mockReset().mockResolvedValue([]);
    mockRunSshCommand.mockReset().mockResolvedValue({ stdout: "Linux\nx86_64\n", stderr: "", code: 0 });
    mockEnvironmentService.getById.mockReset();
    mockSyncInstructionsBundleConfigFromFilePath.mockImplementation((_agent, config) => config);
    mockGetTelemetryClient.mockReturnValue({ track: vi.fn() });
    mockAgentService.getById.mockResolvedValue(baseAgent);
    mockAgentService.getConfigRevision.mockResolvedValue(null);
    mockAgentService.listConfigRevisions.mockResolvedValue([]);
    mockAgentService.list.mockResolvedValue([baseAgent]);
    mockAgentService.getCoordinationChain.mockResolvedValue([]);
    mockAgentService.resolveByReference.mockResolvedValue({ ambiguous: false, agent: baseAgent });
    mockAgentService.create.mockResolvedValue(baseAgent);
    mockAgentService.activatePendingApproval.mockResolvedValue({
      agent: baseAgent,
      activated: false,
    });
    mockAgentService.update.mockResolvedValue(baseAgent);
    mockAgentService.updatePermissions.mockResolvedValue(baseAgent);
    mockBuiltInAgentService.ensureSpaceDefaultAgentGrants.mockResolvedValue(0);
    mockAccessService.canUser.mockResolvedValue(true);
    mockAccessService.decide.mockImplementation(async (input: { action?: string }) => {
      const allowed = Boolean(await mockAccessService.canUser());
      return {
        allowed,
        reason: allowed ? "allow_explicit_grant" : "deny_missing_grant",
        explanation: allowed ? "Allowed by test grant" : `Missing test grant for ${input.action ?? "action"}`,
      };
    });
    mockAccessService.hasPermission.mockResolvedValue(false);
    mockAccessService.getMembership.mockResolvedValue({
      id: "membership-1",
      spaceId,
      principalType: "agent",
      principalId: agentId,
      status: "active",
      membershipRole: "member",
      createdAt: new Date("2026-03-19T00:00:00.000Z"),
      updatedAt: new Date("2026-03-19T00:00:00.000Z"),
    });
    mockAccessService.listPrincipalGrants.mockResolvedValue([]);
    mockAccessService.ensureMembership.mockResolvedValue(undefined);
    mockAccessService.setPrincipalPermission.mockResolvedValue(undefined);
    mockSpaceSkillService.listRuntimeSkillEntries.mockResolvedValue([]);
    mockSpaceSkillService.resolveRequestedSkillKeys.mockImplementation(async (_spaceId, requested) => requested);
    mockBudgetService.upsertPolicy.mockResolvedValue(undefined);
    mockAgentInstructionsService.materializeManagedBundle.mockImplementation(
      async (agent: Record<string, unknown>, files: Record<string, string>) => ({
        bundle: null,
        adapterConfig: {
          ...((agent.adapterConfig as Record<string, unknown> | undefined) ?? {}),
          instructionsBundleMode: "managed",
          instructionsRootPath: `/tmp/${String(agent.id)}/instructions`,
          instructionsEntryFile: "AGENTS.md",
          instructionsFilePath: `/tmp/${String(agent.id)}/instructions/AGENTS.md`,
          promptTemplate: files["AGENTS.md"] ?? "",
        },
      }),
    );
    mockSpaceSkillService.listRuntimeSkillEntries.mockResolvedValue([]);
    mockSpaceSkillService.resolveRequestedSkillKeys.mockImplementation(
      async (_spaceId: string, requested: string[]) => requested,
    );
    mockSecretService.normalizeAdapterConfigForPersistence.mockImplementation(async (_spaceId, config) => config);
    mockSecretService.resolveAdapterConfigForRuntime.mockImplementation(async (_spaceId, config) => ({ config }));
    mockInstanceSettingsService.getGeneral.mockResolvedValue({
      censorUsernameInLogs: false,
    });
    mockLogActivity.mockResolvedValue(undefined);
  });

  it("redacts agent detail for authenticated space members without agent admin permission", async () => {
    mockAccessService.canUser.mockResolvedValue(false);
    mockAccessService.decide.mockImplementation(async (input: { action?: string }) => ({
      allowed: input.action === "agent:read",
      reason: input.action === "agent:read" ? "allow_test_read" : "deny_missing_grant",
      explanation: input.action === "agent:read" ? "Allowed by test read grant." : "Missing test grant.",
    }));

    const app = await createApp({
      type: "operator",
      userId: "member-user",
      source: "session",
      isInstanceAdmin: false,
      spaceIds: [spaceId],
    });

    const res = await requestApp(app, (baseUrl) => request(baseUrl).get(`/api/agents/${agentId}`));

    expect(res.status).toBe(200);
    expect(res.body.adapterConfig).toEqual({});
    expect(res.body.runtimeConfig).toEqual({});
  }, 20_000);

  it("redacts env values in operator agent detail responses", async () => {
    const plaintextValue = "plain-value-must-not-leak";
    mockAgentService.getById.mockResolvedValue({
      ...baseAgent,
      permissions: {
        ...baseAgent.permissions,
        trustPreset: LOW_TRUST_REVIEW_PRESET,
      },
      adapterConfig: {
        command: "pnpm agent:run",
        env: {
          LEGACY_VALUE: plaintextValue,
          PLAIN_VALUE: { type: "plain", value: plaintextValue },
          SECRET_REFERENCE: {
            type: "secret_ref",
            secretId: "33333333-3333-4333-8333-333333333333",
            version: "latest",
          },
        },
      },
      runtimeConfig: {
        heartbeat: { enabled: false },
      },
    });

    const app = await createApp({
      type: "operator",
      userId: "operator-user",
      source: "local_implicit",
      isInstanceAdmin: true,
      spaceIds: [spaceId],
    });

    const res = await requestApp(app, (baseUrl) => request(baseUrl).get(`/api/agents/${agentId}`));

    expect(res.status).toBe(200);
    expect(res.body.adapterConfig).toMatchObject({
      command: "pnpm agent:run",
      env: {
        LEGACY_VALUE: { type: "plain", value: "***REDACTED***" },
        PLAIN_VALUE: { type: "plain", value: "***REDACTED***" },
        SECRET_REFERENCE: {
          type: "secret_ref",
          secretId: "33333333-3333-4333-8333-333333333333",
          version: "latest",
        },
      },
    });
    expect(JSON.stringify(res.body)).not.toContain(plaintextValue);
    expect(res.body.runtimeConfig).toMatchObject({
      heartbeat: { enabled: false },
    });
    expect(res.body.permissions).toMatchObject({ trustPreset: LOW_TRUST_REVIEW_PRESET });
  }, 20_000);

  // TEC-7032 reported the leak against the space agent-list endpoint, which
  // serialises rows directly instead of going through buildAgentDetail.
  it("redacts env values in operator GET /api/spaces/:spaceId/agents responses", async () => {
    const plaintextValue = "listed-value-must-not-leak";
    mockAgentService.list.mockResolvedValue([
      {
        ...baseAgent,
        adapterConfig: {
          command: "pnpm agent:run",
          env: {
            LEGACY_VALUE: plaintextValue,
            PLAIN_VALUE: { type: "plain", value: plaintextValue },
            SECRET_REFERENCE: {
              type: "secret_ref",
              secretId: "55555555-5555-4555-8555-555555555555",
              version: "latest",
            },
          },
        },
      },
    ]);

    const app = await createApp({
      type: "operator",
      userId: "operator-user",
      source: "local_implicit",
      isInstanceAdmin: true,
      spaceIds: [spaceId],
    });

    const res = await requestApp(app, (baseUrl) =>
      request(baseUrl).get(`/api/spaces/${spaceId}/agents`),
    );

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].adapterConfig).toMatchObject({
      command: "pnpm agent:run",
      env: {
        LEGACY_VALUE: { type: "plain", value: "***REDACTED***" },
        PLAIN_VALUE: { type: "plain", value: "***REDACTED***" },
        SECRET_REFERENCE: {
          type: "secret_ref",
          secretId: "55555555-5555-4555-8555-555555555555",
          version: "latest",
        },
      },
    });
    expect(JSON.stringify(res.body)).not.toContain(plaintextValue);
  }, 20_000);

  // Mutation routes echo the stored row back, so they leak the same values the
  // GET paths redact.
  it("redacts env values in agent mutation responses", async () => {
    const plaintextValue = "mutation-value-must-not-leak";
    const storedAgent = {
      ...baseAgent,
      adapterConfig: {
        env: { PLAIN_VALUE: { type: "plain", value: plaintextValue } },
      },
    };
    mockAgentService.getById.mockResolvedValue(storedAgent);
    mockAgentService.update.mockResolvedValue(storedAgent);

    const app = await createApp({
      type: "operator",
      userId: "operator-user",
      source: "local_implicit",
      isInstanceAdmin: true,
      spaceIds: [spaceId],
    });

    const res = await requestApp(app, (baseUrl) =>
      request(baseUrl).patch(`/api/agents/${agentId}`).send({ title: "Renamed" }),
    );

    expect(res.status).toBe(200);
    expect(res.body.adapterConfig.env).toEqual({
      PLAIN_VALUE: { type: "plain", value: "***REDACTED***" },
    });
    expect(JSON.stringify(res.body)).not.toContain(plaintextValue);
  }, 20_000);

  it("redacts env values in GET /api/agents/me responses", async () => {
    const plaintextValue = "self-value-must-not-leak";
    mockAgentService.getById.mockResolvedValue({
      ...baseAgent,
      adapterConfig: {
        env: {
          EXISTING_VALUE: plaintextValue,
          NEW_VALUE: { type: "plain", value: plaintextValue },
          SECRET_REFERENCE: {
            type: "secret_ref",
            secretId: "44444444-4444-4444-8444-444444444444",
            version: 2,
          },
        },
      },
    });

    const app = await createApp({
      type: "agent",
      agentId,
      spaceId,
      runId: null,
      source: "agent_key",
    });

    const res = await requestApp(app, (baseUrl) => request(baseUrl).get("/api/agents/me"));

    expect(res.status).toBe(200);
    expect(res.body.adapterConfig.env).toEqual({
      EXISTING_VALUE: { type: "plain", value: "***REDACTED***" },
      NEW_VALUE: { type: "plain", value: "***REDACTED***" },
      SECRET_REFERENCE: {
        type: "secret_ref",
        secretId: "44444444-4444-4444-8444-444444444444",
        version: 2,
      },
    });
    expect(JSON.stringify(res.body)).not.toContain(plaintextValue);
  }, 20_000);

  it("preserves stored env values when a redacted detail response is submitted unchanged", async () => {
    const plaintextValue = "stored-value-must-be-preserved";
    mockAgentService.getById.mockResolvedValue({
      ...baseAgent,
      adapterConfig: {
        env: {
          EXISTING_VALUE: { type: "plain", value: plaintextValue },
        },
      },
    });
    mockAgentService.update.mockResolvedValue(baseAgent);

    const app = await createApp({
      type: "operator",
      userId: "operator-user",
      source: "local_implicit",
      isInstanceAdmin: true,
      spaceIds: [spaceId],
    });

    const redactedResponse = await requestApp(app, (baseUrl) =>
      request(baseUrl).get(`/api/agents/${agentId}`),
    );
    expect(redactedResponse.status).toBe(200);
    const redactedEnv = redactedResponse.body.adapterConfig.env as Record<string, unknown>;
    expect(redactedEnv.EXISTING_VALUE).toEqual({ type: "plain", value: "***REDACTED***" });

    const patchRes = await requestApp(app, (baseUrl) =>
      request(baseUrl).patch(`/api/agents/${agentId}`).send({
        title: "Renamed while redacted env round-trips",
        adapterConfig: redactedResponse.body.adapterConfig,
      }),
    );

    expect(patchRes.status).toBe(200);
    const updateCallArgs = mockAgentService.update.mock.calls[0]?.[1] as
      | { adapterConfig?: Record<string, unknown> }
      | undefined;
    expect(updateCallArgs?.adapterConfig?.env).toEqual({
      EXISTING_VALUE: { type: "plain", value: plaintextValue },
    });
    expect(JSON.stringify(updateCallArgs?.adapterConfig ?? {})).not.toContain("***REDACTED***");
  }, 20_000);

  it("redacts space agent list for authenticated space members without agent admin permission", async () => {
    mockAccessService.canUser.mockResolvedValue(false);
    mockAccessService.decide.mockImplementation(async (input: { action?: string }) => ({
      allowed: input.action === "agent:read",
      reason: input.action === "agent:read" ? "allow_test_read" : "deny_missing_grant",
      explanation: input.action === "agent:read" ? "Allowed by test read grant." : "Missing test grant.",
    }));

    const app = await createApp({
      type: "operator",
      userId: "member-user",
      source: "session",
      isInstanceAdmin: false,
      spaceIds: [spaceId],
    });

    const res = await requestApp(app, (baseUrl) => request(baseUrl).get(`/api/spaces/${spaceId}/agents`));

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({
        id: agentId,
        adapterConfig: {},
        runtimeConfig: {},
      }),
    ]);
  });

  it.each([{ spentMonthlyCents: 0 }, { name: "Renamed", spentMonthlyCents: 0 }])(
    "rejects accounting fields before applying an agent update: %j", async payload => {
      const app = await createApp({ type: "operator", userId: "operator-user", source: "session", isInstanceAdmin: true, spaceIds: [spaceId] });
      const res = await requestApp(app, baseUrl => request(baseUrl).patch(`/api/agents/${agentId}`).send(payload));
      expect(res.status).toBe(400);
      expect(res.body.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: ["spentMonthlyCents"] })]));
      expect(mockAgentService.update).not.toHaveBeenCalled();
    },
  );

  it("blocks agent updates for authenticated space members without agent admin permission", async () => {
    mockAccessService.canUser.mockResolvedValue(false);

    const app = await createApp({
      type: "operator",
      userId: "member-user",
      source: "session",
      isInstanceAdmin: false,
      spaceIds: [spaceId],
    });

    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .patch(`/api/agents/${agentId}`)
      .send({ title: "Compromised" }));

    expect(res.status).toBe(403);
  });

  it("requires instance administration to enable agent-scoped raw provider traces", async () => {
    const app = await createApp({
      type: "operator",
      userId: "agent-admin-user",
      source: "session",
      isInstanceAdmin: false,
      spaceIds: [spaceId],
    });

    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .patch(`/api/agents/${agentId}`)
      .send({ runtimeConfig: { debug: { providerTrace: "raw" } } }));

    expect(res.status).toBe(403);
    expect(mockAgentService.update).not.toHaveBeenCalled();
  });

  it("allows instance administrators to enable agent-scoped raw provider traces", async () => {
    const app = await createApp({
      type: "operator",
      userId: "instance-admin-user",
      source: "session",
      isInstanceAdmin: true,
      spaceIds: [spaceId],
    });

    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .patch(`/api/agents/${agentId}`)
      .send({ runtimeConfig: { debug: { providerTrace: "raw" } } }));

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockAgentService.update).toHaveBeenCalledWith(
      agentId,
      expect.objectContaining({
        runtimeConfig: { debug: { providerTrace: "raw" } },
      }),
      expect.anything(),
    );
  });

  it.each([
    ["direct creation", `/api/spaces/${spaceId}/agents`],
    ["create creation", `/api/spaces/${spaceId}/agent-creations`],
  ])("requires instance administration for raw provider traces during %s", async (_label, path) => {
    const app = await createApp({
      type: "operator",
      userId: "agent-admin-user",
      source: "session",
      isInstanceAdmin: false,
      spaceIds: [spaceId],
    });

    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .post(path)
      .send({
        name: "Trace attempt",
        role: "engineer",
        adapterType: "process",
        adapterConfig: {},
        runtimeConfig: { debug: { providerTrace: "raw" } },
      }));

    expect(res.status).toBe(403);
    expect(mockAgentService.create).not.toHaveBeenCalled();
  });

  it("allows instance administrators to create and create with raw provider traces", async () => {
    const app = await createApp({
      type: "operator",
      userId: "instance-admin-user",
      source: "session",
      isInstanceAdmin: true,
      spaceIds: [spaceId],
    });
    const body = {
      name: "Trace capture agent",
      adapterType: "process",
      runtimeConfig: { debug: { providerTrace: "raw" } },
    };

    const directResponse = await requestApp(app, (baseUrl) =>
      request(baseUrl)
        .post(`/api/spaces/${spaceId}/agents`)
        .send(body),
    );
    const creationResponse = await requestApp(app, (baseUrl) =>
      request(baseUrl)
        .post(`/api/spaces/${spaceId}/agent-creations`)
        .send(body),
    );

    expect(directResponse.status, JSON.stringify(directResponse.body)).toBe(201);
    expect(creationResponse.status, JSON.stringify(creationResponse.body)).toBe(201);
    expect(mockAgentService.create).toHaveBeenCalledTimes(2);
  });

  it("rejects non-admin rollback into raw provider trace capture", async () => {
    mockAgentService.getConfigRevision.mockResolvedValue({
      id: "33333333-3333-4333-8333-333333333333",
      afterConfig: {
        adapterType: "process",
        adapterConfig: {},
        runtimeConfig: { debug: { providerTrace: "raw" } },
      },
    });
    const app = await createApp({
      type: "operator",
      userId: "agent-admin-user",
      source: "session",
      isInstanceAdmin: false,
      spaceIds: [spaceId],
    });

    const response = await requestApp(app, (baseUrl) =>
      request(baseUrl).post(
        `/api/agents/${agentId}/config-revisions/33333333-3333-4333-8333-333333333333/rollback`,
      ),
    );

    expect(response.status).toBe(403);
    expect(mockAgentService.rollbackConfigRevision).not.toHaveBeenCalled();
  });

  it("redacts plaintext env values in configuration rollback responses", async () => {
    const revisionId = "33333333-3333-4333-8333-333333333333";
    const plaintextValue = "rollback-value-must-not-leak";
    mockAgentService.getConfigRevision.mockResolvedValue({
      id: revisionId,
      afterConfig: {
        adapterType: "process",
        adapterConfig: {},
        runtimeConfig: {},
      },
    });
    mockAgentService.rollbackConfigRevision.mockResolvedValue({
      ...baseAgent,
      adapterConfig: {
        env: { GENERIC_NAME: { type: "plain", value: plaintextValue } },
      },
    });

    const app = await createApp({
      type: "operator",
      userId: "instance-admin-user",
      source: "session",
      isInstanceAdmin: true,
      spaceIds: [spaceId],
    });

    const res = await requestApp(app, (baseUrl) =>
      request(baseUrl).post(`/api/agents/${agentId}/config-revisions/${revisionId}/rollback`),
    );

    expect(res.status).toBe(200);
    expect(res.body.adapterConfig.env).toEqual({
      GENERIC_NAME: { type: "plain", value: "***REDACTED***" },
    });
    expect(JSON.stringify(res.body)).not.toContain(plaintextValue);
  });

  it("blocks api key creation for authenticated space members without agent admin permission", async () => {
    mockAccessService.canUser.mockResolvedValue(false);

    const app = await createApp({
      type: "operator",
      userId: "member-user",
      source: "session",
      isInstanceAdmin: false,
      spaceIds: [spaceId],
    });

    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .post(`/api/agents/${agentId}/keys`)
      .send({ name: "backdoor" }));

    expect(res.status).toBe(403);
  });

  it("blocks wakeups for authenticated space members without agent admin permission", async () => {
    mockAccessService.canUser.mockResolvedValue(false);

    const app = await createApp({
      type: "operator",
      userId: "member-user",
      source: "session",
      isInstanceAdmin: false,
      spaceIds: [spaceId],
    });

    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .post(`/api/agents/${agentId}/wakeup`)
      .send({}));

    expect(res.status).toBe(403);
  });

  it("blocks agent-authenticated self-updates that set host-executed workspace commands", async () => {
    const app = await createApp({
      type: "agent",
      agentId,
      spaceId,
      source: "agent_key",
      runId: "run-1",
    });

    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .patch(`/api/agents/${agentId}`)
      .send({
        adapterConfig: {
          workspaceStrategy: {
            type: "git_worktree",
            provisionCommand: "touch /tmp/outpost-rce",
          },
        },
      }));

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("host-executed workspace commands");
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it.each([
    ["command", { command: "sh" }],
    ["arguments", { args: ["-c", "id"] }],
    ["environment", { env: { PATH: "/tmp" } }],
  ])("blocks agent-authenticated process adapter %s updates", async (_label, adapterConfig) => {
    const app = await createApp({
      type: "agent",
      agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      spaceId,
      source: "agent_key",
      runId: "run-1",
    });
    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .patch(`/api/agents/${agentId}`)
      .send({ adapterConfig }));

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("host-executed process adapters");
    expect(mockAgentService.update).not.toHaveBeenCalled();
  });

  it("blocks an agent from switching a peer onto the process adapter", async () => {
    mockAgentService.getById.mockResolvedValue({ ...baseAgent, adapterType: "codex_local" });
    const app = await createApp({
      type: "agent",
      agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      spaceId,
      source: "agent_key",
      runId: "run-1",
    });
    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .patch(`/api/agents/${agentId}`)
      .send({ adapterType: "process" }));

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("host-executed process adapters");
    expect(mockAgentService.update).not.toHaveBeenCalled();
  });

  it.each([
    ["claude_local", { engine: "cli", command: "/tmp/untrusted" }],
    ["codex_local", { args: ["-c", "id"] }],
    ["cursor_local", { env: { PATH: "/tmp" } }],
    ["hermes_local", { hermesCommand: "/tmp/untrusted" }],
    ["gemini_local", { cwd: "/tmp" }],
    ["opencode_local", { filesystemSandboxCommand: "/tmp/untrusted" }],
  ])("blocks agent-authenticated host settings for %s", async (adapterType, adapterConfig) => {
    mockAgentService.getById.mockResolvedValue({ ...baseAgent, adapterType });
    const app = await createApp({
      type: "agent",
      agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      spaceId,
      source: "agent_key",
      runId: "run-1",
    });
    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .patch(`/api/agents/${agentId}`)
      .send({ adapterConfig }));

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("host-executed local adapter settings");
    expect(mockAgentService.update).not.toHaveBeenCalled();
  });

  it("allows an agent to update a peer's local model without host settings", async () => {
    mockAgentService.getById.mockResolvedValue({ ...baseAgent, adapterType: "claude_local" });
    const app = await createApp({ type: "agent", agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", spaceId, source: "agent_key", runId: "run-1" });
    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .patch(`/api/agents/${agentId}`)
      .send({ adapterConfig: { model: "claude-sonnet-4-5" } }));

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockAgentService.update).toHaveBeenCalledOnce();
  });

  it("allows a provider credential reference without allowing arbitrary environment variables", async () => {
    mockAgentService.getById.mockResolvedValue({ ...baseAgent, adapterType: "claude_local" });
    const app = await createApp({ type: "agent", agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", spaceId, source: "agent_key", runId: "run-1" });
    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .patch(`/api/agents/${agentId}`)
      .send({ adapterConfig: { env: { ANTHROPIC_API_KEY: { type: "secret_ref", secretId: "33333333-3333-4333-8333-333333333333" } } } }));

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockAgentService.update).toHaveBeenCalledOnce();
  });

  it.each(["ANTHROPIC_BASE_URL", "HTTP_PROXY", "NODE_OPTIONS"])("blocks agent-supplied %s on native Claude updates", async key => {
    mockAgentService.getById.mockResolvedValue({ ...baseAgent, adapterType: "outpost_runner",
      adapterConfig: { provider: "acpx", acpxAgent: "claude" } });
    const app = await createApp({ type: "agent", agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", spaceId, source: "agent_key", runId: "run-1" });
    const res = await requestApp(app, baseUrl => request(baseUrl).patch(`/api/agents/${agentId}`)
      .send({ adapterConfig: { env: { [key]: "untrusted-setting" } } }));
    expect(res.status).toBe(403);
    expect(mockAgentService.update).not.toHaveBeenCalled();
  });

  it("allows native Claude credential references in partial updates using the saved harness", async () => {
    mockAgentService.getById.mockResolvedValue({ ...baseAgent, adapterType: "outpost_runner",
      adapterConfig: { provider: "acpx", acpxAgent: "claude" } });
    const app = await createApp({ type: "agent", agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", spaceId, source: "agent_key", runId: "run-1" });
    const res = await requestApp(app, baseUrl => request(baseUrl).patch(`/api/agents/${agentId}`)
      .send({ adapterConfig: { env: { ANTHROPIC_API_KEY: { type: "secret_ref", secretId: "33333333-3333-4333-8333-333333333333" } } } }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockAgentService.update).toHaveBeenCalledOnce();
  });

  it("blocks an agent from activating inherited host settings by switching onto a local adapter", async () => {
    mockAgentService.getById.mockResolvedValue({
      ...baseAgent,
      adapterType: "outpost_runner",
      adapterConfig: { env: { PATH: "/tmp" } },
    });
    const app = await createApp({ type: "agent", agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", spaceId, source: "agent_key", runId: "run-1" });
    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .patch(`/api/agents/${agentId}`)
      .send({ adapterType: "claude_local", adapterConfig: { engine: "cli" } }));

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("host-executed local adapter settings");
    expect(mockAgentService.update).not.toHaveBeenCalled();
  });

  it.each([
    ["create", `/api/spaces/${spaceId}/agents`],
    ["create", `/api/spaces/${spaceId}/agent-creations`],
  ])("blocks agent-authenticated process adapter commands on %s", async (_label, path) => {
    const app = await createApp({ type: "agent", agentId, spaceId, source: "agent_key", runId: "run-1" });
    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .post(path)
      .send({ name: "Host process", role: "engineer", adapterType: "process", adapterConfig: { command: "sh" } }));

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("host-executed process adapters");
    expect(mockAgentService.create).not.toHaveBeenCalled();
  });

  it.each([
    ["create", `/api/spaces/${spaceId}/agents`],
    ["create", `/api/spaces/${spaceId}/agent-creations`],
  ])("blocks agent-authenticated local adapter commands on %s", async (_label, path) => {
    const app = await createApp({ type: "agent", agentId, spaceId, source: "agent_key", runId: "run-1" });
    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .post(path)
      .send({ name: "Local peer", role: "engineer", adapterType: "claude_local", adapterConfig: { engine: "cli", command: "/tmp/untrusted" } }));

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("host-executed local adapter settings");
    expect(mockAgentService.create).not.toHaveBeenCalled();
  });

  it("blocks agent-authenticated rollback into process adapter configuration", async () => {
    mockAgentService.getConfigRevision.mockResolvedValue({
      id: "33333333-3333-4333-8333-333333333333",
      afterConfig: { adapterType: "process", adapterConfig: { command: "sh" }, runtimeConfig: {} },
    });
    const app = await createApp({ type: "agent", agentId, spaceId, source: "agent_key", runId: "run-1" });
    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .post(`/api/agents/${agentId}/config-revisions/33333333-3333-4333-8333-333333333333/rollback`));

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("host-executed process adapters");
    expect(mockAgentService.rollbackConfigRevision).not.toHaveBeenCalled();
  });

  it("blocks agent-authenticated rollback into local adapter command configuration", async () => {
    const revisionId = "33333333-3333-4333-8333-333333333333";
    mockAgentService.getConfigRevision.mockResolvedValue({
      id: revisionId,
      afterConfig: { adapterType: "claude_local", adapterConfig: { engine: "cli", command: "/tmp/untrusted" }, runtimeConfig: {} },
    });
    const app = await createApp({ type: "agent", agentId, spaceId, source: "agent_key", runId: "run-1" });
    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .post(`/api/agents/${agentId}/config-revisions/${revisionId}/rollback`));

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("host-executed local adapter settings");
    expect(mockAgentService.rollbackConfigRevision).not.toHaveBeenCalled();
  });

  it.each(["provisionCommand", "runtimeProvisionCommand", "teardownCommand"])(
    "blocks agent-authenticated rollback of workspace %s",
    async (commandKey) => {
      const revisionId = "33333333-3333-4333-8333-333333333333";
      mockAgentService.getConfigRevision.mockResolvedValue({
        id: revisionId,
        afterConfig: {
          adapterType: "codex_local",
          adapterConfig: { workspaceStrategy: { type: "git_worktree", [commandKey]: "sh -c id" } },
          runtimeConfig: {},
        },
      });
      const app = await createApp({
        type: "agent",
        agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        spaceId,
        source: "agent_key",
        runId: "run-1",
      });
      const res = await requestApp(app, (baseUrl) => request(baseUrl)
        .post(`/api/agents/${agentId}/config-revisions/${revisionId}/rollback`));

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("host-executed workspace commands");
      expect(mockAgentService.rollbackConfigRevision).not.toHaveBeenCalled();
    },
  );

  it("allows an agent to restore a non-process revision for a process peer", async () => {
    const revisionId = "33333333-3333-4333-8333-333333333333";
    mockAgentService.getConfigRevision.mockResolvedValue({
      id: revisionId,
      afterConfig: { adapterType: "codex_local", adapterConfig: {}, runtimeConfig: {} },
    });
    mockAgentService.rollbackConfigRevision.mockResolvedValue({
      ...baseAgent,
      adapterType: "codex_local",
    });
    const app = await createApp({
      type: "agent",
      agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      spaceId,
      source: "agent_key",
      runId: "run-1",
    });
    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .post(`/api/agents/${agentId}/config-revisions/${revisionId}/rollback`));

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockAgentService.rollbackConfigRevision).toHaveBeenCalledOnce();
  });

  it("blocks agent-authenticated self-updates that set instructions bundle roots", async () => {
    const app = await createApp({
      type: "agent",
      agentId,
      spaceId,
      source: "agent_key",
      runId: "run-1",
    });

    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .patch(`/api/agents/${agentId}`)
      .send({
        adapterConfig: {
          instructionsRootPath: "/etc",
          instructionsEntryFile: "passwd",
        },
      }));

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("instructions path or bundle configuration");
    expect(mockLogActivity).not.toHaveBeenCalled();
  }, 15_000);

  it("blocks agent-authenticated instructions-path updates", async () => {
    const app = await createApp({
      type: "agent",
      agentId,
      spaceId,
      source: "agent_key",
      runId: "run-1",
    });

    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .patch(`/api/agents/${agentId}/instructions-path`)
      .send({ path: "/etc/passwd" }));

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("instructions path or bundle configuration");
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("blocks agent-authenticated creations that set instructions bundle config", async () => {
    mockAccessService.hasPermission.mockResolvedValue(true);

    const app = await createApp({
      type: "agent",
      agentId,
      spaceId,
      source: "agent_key",
      runId: "run-1",
    });

    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .post(`/api/spaces/${spaceId}/agent-creations`)
      .send({
        name: "Injected",
        role: "engineer",
        adapterType: "codex_local",
        adapterConfig: {
          instructionsRootPath: "/etc",
          instructionsEntryFile: "passwd",
        },
      }));

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("instructions path or bundle configuration");
    expect(mockInstanceSettingsService.get).not.toHaveBeenCalled();
    expect(mockEnvironmentService.getById).not.toHaveBeenCalled();
    expect(mockRunSshCommand).not.toHaveBeenCalled();
    expect(mockAgentService.create).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("blocks direct creation for authenticated space members without agent create permission", async () => {
    mockAccessService.canUser.mockResolvedValue(false);

    const app = await createApp({
      type: "operator",
      userId: "member-user",
      source: "session",
      isInstanceAdmin: false,
      spaceIds: [spaceId],
    });

    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .post(`/api/spaces/${spaceId}/agents`)
      .send({
        name: "Backdoor",
        role: "engineer",
        adapterType: "process",
        adapterConfig: {},
      }));

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("agents:create");
    expect(mockAgentService.create).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it.each(["agents", "agent-creations"])("tells a denied agent that its creation denial is final and where a person can act via %s", async (route) => {
    mockAccessService.decide.mockImplementation(async (input: { action?: string }) => ({
      allowed: input.action !== "agents:create",
      action: input.action,
      reason: input.action === "agents:create" ? "deny_missing_grant" : "allow_test",
      explanation: input.action === "agents:create" ? "Missing permission: agents:create." : "Allowed in test.",
    }));
    const app = createApp({ type: "agent", agentId, spaceId, source: "agent_jwt" });
    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .post(`/api/spaces/${spaceId}/${route}`)
      .send({ name: "Morgan", role: "qa", adapterType: "process", adapterConfig: {} }));

    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toContain("Missing permission: agents:create.");
    expect(res.body.error).toContain("no other route overrides this denial");
    expect(res.body.error).toContain("An operator user can create the agent directly");
    expect(mockAgentService.create).not.toHaveBeenCalled();
    expect(mockApprovalService.create).not.toHaveBeenCalled();
  });

  it("keeps the plain denial on agents:create checks that are not creation", async () => {
    mockAccessService.decide.mockImplementation(async (input: { action?: string }) => ({
      allowed: input.action !== "agents:create",
      action: input.action,
      reason: input.action === "agents:create" ? "deny_missing_grant" : "allow_test",
      explanation: input.action === "agents:create" ? "Missing permission: agents:create." : "Allowed in test.",
    }));
    const app = createApp({ type: "agent", agentId, spaceId, source: "agent_jwt" });
    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .post(`/api/spaces/${spaceId}/adapters/process/test-environment`)
      .send({ adapterConfig: {} }));

    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toBe("Missing permission: agents:create.");
  });

  it.each(["agents", "agent-creations"])("rejects agent-supplied Codex host commands before resolving the runner via %s", async (route) => {
    mockAccessService.hasPermission.mockResolvedValue(true);
    mockInstanceSettingsService.get.mockRejectedValue(new Error("Denied requests must not inspect execution targets"));
    const app = createApp({ type: "agent", agentId, spaceId, source: "agent_key" });
    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .post(`/api/spaces/${spaceId}/${route}`)
      .send({ name: "Injected", role: "engineer", adapterType: "codex_local", adapterConfig: { command: "untrusted-codex" } }));

    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toContain("host-executed local adapter settings");
    expect(mockInstanceSettingsService.get).not.toHaveBeenCalled();
    expect(mockEnvironmentService.getById).not.toHaveBeenCalled();
    expect(mockRunSshCommand).not.toHaveBeenCalled();
    expect(mockAgentService.create).not.toHaveBeenCalled();
  });

  it.each(["agents", "agent-creations"])("requires instance admin for external instructions before resolving the runner via %s", async (route) => {
    mockInstanceSettingsService.get.mockRejectedValue(new Error("Denied requests must not inspect execution targets"));
    const app = createApp({ type: "operator", userId: "member-user", source: "session", spaceIds: [spaceId], isInstanceAdmin: false });
    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .post(`/api/spaces/${spaceId}/${route}`)
      .send({ name: "External", role: "engineer", adapterType: "codex_local", adapterConfig: { instructionsBundleMode: "external" } }));

    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(mockInstanceSettingsService.get).not.toHaveBeenCalled();
    expect(mockEnvironmentService.getById).not.toHaveBeenCalled();
    expect(mockRunSshCommand).not.toHaveBeenCalled();
    expect(mockAgentService.create).not.toHaveBeenCalled();
  });

  it("allows direct creation for authenticated operator users with agent create permission when approval is not required", async () => {
    mockAccessService.canUser.mockResolvedValue(true);

    const app = await createApp({
      type: "operator",
      userId: "agent-admin-user",
      source: "session",
      isInstanceAdmin: false,
      spaceIds: [spaceId],
    });

    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .post(`/api/spaces/${spaceId}/agents`)
      .send({
        name: "Builder",
        role: "engineer",
        adapterType: "process",
        adapterConfig: {},
      }));

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockAgentService.create).toHaveBeenCalledWith(
      spaceId,
      expect.objectContaining({
        status: "idle",
      }),
      { runnerResolved: true, aiConnectionInstall: undefined, createdByAgentId: null, interactionTexts: [expect.any(String)], createdByUserId: "agent-admin-user", responsibleUserId: "agent-admin-user", claudeLogin: { storedSessionId: null, ownerUserId: "agent-admin-user", applyExistingWithoutClaim: false } },
    );
    expect(mockAccessService.setPrincipalPermission).toHaveBeenCalledWith(
      spaceId,
      "agent",
      agentId,
      "tasks:assign",
      true,
      "agent-admin-user",
    );
    expect(mockBuiltInAgentService.ensureSpaceDefaultAgentGrants).toHaveBeenCalledWith(spaceId);
  });

  it("rejects direct creation when new agents require operator approval", async () => {
    const app = await createApp(
      {
        type: "operator",
        userId: "operator-user",
        source: "local_implicit",
        isInstanceAdmin: true,
        spaceIds: [spaceId],
      },
      { requireOperatorApprovalForNewAgents: true },
    );

    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .post(`/api/spaces/${spaceId}/agents`)
      .send({
        name: "Builder",
        role: "engineer",
        adapterType: "process",
        adapterConfig: {},
      }));

    expect(res.status).toBe(409);
    expect(res.body.error).toContain("/agent-creations");
    expect(mockAgentService.create).not.toHaveBeenCalled();
    expect(mockApprovalService.create).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("grants tasks:assign by default when operator creates a new agent", async () => {
    const app = await createApp({
      type: "operator",
      userId: "operator-user",
      source: "local_implicit",
      isInstanceAdmin: true,
      spaceIds: [spaceId],
    });

    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .post(`/api/spaces/${spaceId}/agents`)
      .send({
        name: "Builder",
        role: "engineer",
        adapterType: "process",
        adapterConfig: {},
      }));

    expect([200, 201]).toContain(res.status);
    expect(mockAccessService.ensureMembership).toHaveBeenCalledWith(
      spaceId,
      "agent",
      agentId,
      "member",
      "active",
    );
    expect(mockAccessService.setPrincipalPermission).toHaveBeenCalledWith(
      spaceId,
      "agent",
      agentId,
      "tasks:assign",
      true,
      "operator-user",
    );
  }, 15_000);

  it("rejects unsupported query parameters on the agent list route", async () => {
    const app = await createApp({
      type: "operator",
      userId: "operator-user",
      source: "local_implicit",
      isInstanceAdmin: true,
      spaceIds: [spaceId],
    });

    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .get(`/api/spaces/${spaceId}/agents`)
      .query({ urlKey: "builder" }));

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("urlKey");
    expect(mockAgentService.list).not.toHaveBeenCalled();
  });

  it("normalizes direct creation to disable timer heartbeats by default", async () => {
    const app = await createApp({
      type: "operator",
      userId: "operator-user",
      source: "local_implicit",
      isInstanceAdmin: true,
      spaceIds: [spaceId],
    });

    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .post(`/api/spaces/${spaceId}/agents`)
      .send({
        name: "Builder",
        role: "engineer",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {
          heartbeat: {
            intervalSec: 3600,
          },
        },
      }));

    expect([200, 201]).toContain(res.status);
    expect(mockAgentService.create).toHaveBeenCalledWith(
      spaceId,
      expect.objectContaining({
        runtimeConfig: {
          heartbeat: {
            enabled: false,
            intervalSec: 3600,
            maxConcurrentRuns: 20,
          },
        },
      }),
      { runnerResolved: true, aiConnectionInstall: undefined, createdByAgentId: null, interactionTexts: [expect.any(String)], createdByUserId: "operator-user", responsibleUserId: "operator-user", claudeLogin: { storedSessionId: null, ownerUserId: "operator-user", applyExistingWithoutClaim: false } },
    );
  });

  it("normalizes create requests to disable timer heartbeats by default", async () => {
    const app = await createApp({
      type: "operator",
      userId: "operator-user",
      source: "local_implicit",
      isInstanceAdmin: true,
      spaceIds: [spaceId],
    });

    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .post(`/api/spaces/${spaceId}/agent-creations`)
      .send({
        name: "Builder",
        role: "engineer",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {
          heartbeat: {
            intervalSec: 3600,
          },
        },
      }));

    expect(res.status).toBe(201);
    expect(mockAgentService.create).toHaveBeenCalledWith(
      spaceId,
      expect.objectContaining({
        runtimeConfig: {
          heartbeat: {
            enabled: false,
            intervalSec: 3600,
            maxConcurrentRuns: 20,
          },
        },
      }),
      {
        runnerResolved: true,
        aiConnectionInstall: undefined,
        createdByAgentId: null,
        interactionTexts: [expect.any(String)],
        createdByUserId: "operator-user", responsibleUserId: "operator-user",
        claudeLogin: {
          storedSessionId: null,
          ownerUserId: "operator-user",
          applyExistingWithoutClaim: false,
          inheritedFromAgentId: null,
        },
      },
    );
  });

  it("allows operator users to directly approve pending agents", async () => {
    const pendingAgent = {
      ...baseAgent,
      status: "pending_approval",
    };
    const approvedAgent = {
      ...baseAgent,
      status: "idle",
    };
    mockAgentService.getById.mockResolvedValue(pendingAgent);
    mockApprovalService.approveCreation.mockResolvedValue({
      agent: approvedAgent,
      applied: true,
      approval: null,
    });

    const app = await createApp({
      type: "operator",
      userId: "operator-user",
      source: "local_implicit",
      isInstanceAdmin: true,
      spaceIds: [spaceId],
    });

    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .post(`/api/agents/${agentId}/approve`)
      .send({}));

    expect(res.status).toBe(200);
    expect(mockApprovalService.approveCreation).toHaveBeenCalledWith(agentId, "operator-user");
    expect(mockLogActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      spaceId,
      actorType: "user",
      actorId: "operator-user",
      action: "agent.approved",
      entityType: "agent",
      entityId: agentId,
      details: { source: "agent_detail", approvalId: null },
    }));
  });

  it("resolves the linked create approval when approving from the agent detail page", async () => {
    const pendingAgent = {
      ...baseAgent,
      status: "pending_approval",
    };
    const approvedAgent = {
      ...baseAgent,
      status: "idle",
    };
    mockAgentService.getById.mockResolvedValue(pendingAgent);
    mockApprovalService.approveCreation.mockResolvedValue({
      agent: approvedAgent,
      approval: { id: "approval-1", status: "approved" },
      applied: true,
    });

    const app = await createApp({
      type: "operator",
      userId: "operator-user",
      source: "local_implicit",
      isInstanceAdmin: true,
      spaceIds: [spaceId],
    });

    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .post(`/api/agents/${agentId}/approve`)
      .send({}));

    expect(res.status).toBe(200);
    // The shared approval flow handles activation; we must not double-activate.
    expect(mockApprovalService.approveCreation).toHaveBeenCalledWith(agentId, "operator-user");
    expect(mockAgentService.activatePendingApproval).not.toHaveBeenCalled();
    expect(mockLogActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "agent.approved",
      details: { source: "agent_detail", approvalId: "approval-1" },
    }));
  });

  it("rejects the linked create approval when terminating a still-pending agent without double-terminating", async () => {
    const pendingAgent = {
      ...baseAgent,
      status: "pending_approval",
    };
    const terminatedAgent = {
      ...baseAgent,
      status: "terminated",
    };
    mockAgentService.getById.mockResolvedValue(pendingAgent);
    mockApprovalService.rejectCreation.mockResolvedValue({
      agent: terminatedAgent,
      approval: { id: "approval-1", status: "rejected" },
      applied: true,
    });
    mockHeartbeatService.cancelInvocationsForAgents.mockResolvedValue({
      agentIds: [agentId],
      runsCancelled: 0,
      wakeupsCancelled: 0,
    });

    const app = await createApp({
      type: "operator",
      userId: "operator-user",
      source: "local_implicit",
      isInstanceAdmin: true,
      spaceIds: [spaceId],
    });

    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .post(`/api/agents/${agentId}/terminate`)
      .send({}));

    expect(res.status).toBe(200);
    expect(mockApprovalService.rejectCreation).toHaveBeenCalledWith(agentId, "operator-user");
    // The create decision rejects the pending agent; the route must not terminate again.
    expect(mockAgentService.terminate).not.toHaveBeenCalled();
  });

  it.each([
    ["PATCH status", (base: string) => request(base).patch(`/api/agents/${agentId}`).send({ status: "terminated" })],
    ["POST terminate", (base: string) => request(base).post(`/api/agents/${agentId}/terminate`).send({})],
  ])("keeps agent termination operator-only through %s, even for an agent allowed to configure the target", async (_route, send) => {
    mockAgentService.getById.mockResolvedValue({ ...baseAgent, status: "idle" });
    const app = await createApp({
      type: "agent",
      agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      spaceId,
      source: "agent_key",
      runId: "run-1",
    });

    const res = await requestApp(app, send);

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("only an operator user can terminate an agent");
    expect(res.body.error).toContain(`[the agent's profile](/PAP/agents/${agentId})`);
    expect(mockAgentService.terminate).not.toHaveBeenCalled();
    expect(mockAgentService.update).not.toHaveBeenCalled();
    expect(mockHeartbeatService.cancelInvocationsForAgents).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("still lets an operator user terminate through PATCH status", async () => {
    mockAgentService.getById.mockResolvedValue({ ...baseAgent, status: "idle" });
    mockAgentService.updateAndTransition.mockResolvedValue({ ...baseAgent, status: "terminated" });
    const app = await createApp({
      type: "operator",
      userId: "operator-user",
      source: "local_implicit",
      isInstanceAdmin: true,
      spaceIds: [spaceId],
    });

    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .patch(`/api/agents/${agentId}`)
      .send({ status: "terminated" }));

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe("terminated");
    expect(mockAgentService.updateAndTransition).toHaveBeenCalledWith(agentId, "terminate", expect.anything(), expect.anything());
  });

  it.each([
    ["PATCH status", (base: string) => request(base).patch(`/api/agents/${agentId}`).send({ status: "paused" })],
    ["POST pause", (base: string) => request(base).post(`/api/agents/${agentId}/pause`).send({})],
  ])("keeps pausing an agent operator-only through %s, even for an agent allowed to configure the target", async (_route, send) => {
    mockAgentService.getById.mockResolvedValue({ ...baseAgent, status: "running" });
    const app = await createApp({
      type: "agent",
      agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      spaceId,
      source: "agent_key",
      runId: "run-1",
    });

    const res = await requestApp(app, send);

    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toBe("Operator access required");
    expect(res.body.code).toBe("operator_access_required");
    expect(res.body.remediation).toContain("this denial is final");
    expect(res.body.remediation).toContain(`[Open the agent's profile](/<prefix>/agents/${agentId})`);
    expect(mockAgentService.updateAndTransition).not.toHaveBeenCalled();
    expect(mockAgentService.update).not.toHaveBeenCalled();
    expect(mockHeartbeatService.cancelActiveForAgent).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("still lets an operator user pause through PATCH status", async () => {
    mockAgentService.getById.mockResolvedValue({ ...baseAgent, status: "idle" });
    mockAgentService.updateAndTransition.mockResolvedValue({ ...baseAgent, status: "paused" });
    const app = await createApp({
      type: "operator",
      userId: "operator-user",
      source: "local_implicit",
      isInstanceAdmin: true,
      spaceIds: [spaceId],
    });

    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .patch(`/api/agents/${agentId}`)
      .send({ status: "paused" }));

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockAgentService.updateAndTransition).toHaveBeenCalledWith(agentId, "pause", expect.anything(), expect.anything());
  });

  it("applies the resume change-grant decision to PATCH status idle from an agent", async () => {
    mockAgentService.getById.mockResolvedValue({ ...baseAgent, status: "paused" });
    mockAccessService.decide.mockImplementation(async (input: { action?: string; scope?: { requiresChangeGrant?: boolean } }) => {
      const allowed = !input.scope?.requiresChangeGrant;
      return {
        allowed,
        action: input.action,
        reason: allowed ? "allow_explicit_grant" : "deny_missing_consent",
        explanation: allowed ? "Allowed by test grant" : "Accepted consent is required for this suggested change.",
      };
    });
    const app = await createApp({
      type: "agent",
      agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      spaceId,
      source: "agent_key",
      runId: "run-1",
    });

    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .patch(`/api/agents/${agentId}`)
      .send({ status: "idle" }));

    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(mockAccessService.decide).toHaveBeenCalledWith(expect.objectContaining({
      action: "agent_config:update",
      scope: { requiresChangeGrant: true },
    }));
    expect(mockAgentService.updateAndTransition).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("lets a granted agent resume through PATCH status idle", async () => {
    mockAgentService.getById.mockResolvedValue({ ...baseAgent, status: "paused" });
    mockAgentService.updateAndTransition.mockResolvedValue({ ...baseAgent, status: "idle" });
    const app = await createApp({
      type: "agent",
      agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      spaceId,
      source: "agent_key",
      runId: "run-1",
    });

    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .patch(`/api/agents/${agentId}`)
      .send({ status: "idle" }));

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockAgentService.updateAndTransition).toHaveBeenCalledWith(agentId, "resume", expect.anything(), expect.anything());
  });

  it("keeps the invalid-coordination-chain resume guard on PATCH status idle", async () => {
    mockAgentService.getById.mockResolvedValue({
      ...baseAgent,
      status: "paused",
      coordinationHealth: { status: "invalid_coordination_chain", reason: "missing_lead_agent", repairGuidance: "Repair the coordination chain first." },
    });
    const app = await createApp({
      type: "operator",
      userId: "operator-user",
      source: "local_implicit",
      isInstanceAdmin: true,
      spaceIds: [spaceId],
    });

    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .patch(`/api/agents/${agentId}`)
      .send({ status: "idle" }));

    expect(res.status).toBe(409);
    expect(res.body.error).toBe("Repair the coordination chain first.");
    expect(mockAgentService.updateAndTransition).not.toHaveBeenCalled();
  });

  it("terminates directly when no open create approval is linked", async () => {
    const idleAgent = { ...baseAgent, status: "idle" };
    const terminatedAgent = { ...baseAgent, status: "terminated" };
    mockAgentService.getById.mockResolvedValue(idleAgent);
    mockAgentService.terminate.mockResolvedValue(terminatedAgent);
    mockHeartbeatService.cancelInvocationsForAgents.mockResolvedValue({
      agentIds: [agentId],
      runsCancelled: 0,
      wakeupsCancelled: 0,
    });

    const app = await createApp({
      type: "operator",
      userId: "operator-user",
      source: "local_implicit",
      isInstanceAdmin: true,
      spaceIds: [spaceId],
    });

    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .post(`/api/agents/${agentId}/terminate`)
      .send({}));

    expect(res.status).toBe(200);
    expect(mockAgentService.terminate).toHaveBeenCalledWith(agentId);
    expect(mockApprovalService.findOpenCreationApprovalForAgent).not.toHaveBeenCalled();
    expect(mockApprovalService.rejectCreation).not.toHaveBeenCalled();
  });

  it("rejects direct approval for agents that are not pending approval", async () => {
    const app = await createApp({
      type: "operator",
      userId: "operator-user",
      source: "local_implicit",
      isInstanceAdmin: true,
      spaceIds: [spaceId],
    });

    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .post(`/api/agents/${agentId}/approve`)
      .send({}));

    expect(res.status).toBe(409);
    expect(mockApprovalService.approveCreation).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "agent.approved",
    }));
  });

  it("allows creating an agent with an instance-scoped environment referenced from another space", async () => {
    const environmentId = "33333333-3333-4333-8333-333333333333";
    mockEnvironmentService.getById.mockResolvedValue({
      id: environmentId,
      spaceId: "other-space",
      driver: "local",
      config: {},
    });

    const app = await createApp({
      type: "operator",
      userId: "operator-user",
      source: "local_implicit",
      isInstanceAdmin: true,
      spaceIds: [spaceId],
    });

    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .post(`/api/spaces/${spaceId}/agents`)
      .send({
        name: "Builder",
        role: "engineer",
        adapterType: "process",
        adapterConfig: {},
        defaultEnvironmentId: environmentId,
      }));

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockAgentService.create).toHaveBeenCalledWith(
      spaceId,
      expect.objectContaining({
        defaultEnvironmentId: environmentId,
      }),
      { runnerResolved: true, aiConnectionInstall: undefined, createdByAgentId: null, interactionTexts: [expect.any(String)], createdByUserId: "operator-user", responsibleUserId: "operator-user", claudeLogin: { storedSessionId: null, ownerUserId: "operator-user", applyExistingWithoutClaim: false } },
    );
  });

  it("rejects creating an agent with an unsupported default environment driver", async () => {
    const environmentId = "33333333-3333-4333-8333-333333333333";
    mockEnvironmentService.getById.mockResolvedValue({
      id: environmentId,
      spaceId,
      driver: "ssh",
      config: {},
    });

    const app = await createApp({
      type: "operator",
      userId: "operator-user",
      source: "local_implicit",
      isInstanceAdmin: true,
      spaceIds: [spaceId],
    });

    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .post(`/api/spaces/${spaceId}/agents`)
      .send({
        name: "Builder",
        role: "engineer",
        adapterType: "process",
        adapterConfig: {},
        defaultEnvironmentId: environmentId,
      }));

    expect(res.status).toBe(422);
    expect(res.body.error).toContain('Environment driver "ssh" is not allowed here');
    expect(mockAgentService.create).not.toHaveBeenCalled();
  });

  const sshCapableAdapterCases = [
    { adapterType: "codex_local", name: "Codex Builder", adapterConfig: {} },
    { adapterType: "claude_local", name: "Claude Builder", adapterConfig: {} },
    { adapterType: "gemini_local", name: "Gemini Builder", adapterConfig: {} },
    { adapterType: "opencode_local", name: "OpenCode Builder", adapterConfig: { model: "opencode/gpt-5-nano" } },
    { adapterType: "cursor", name: "Cursor Builder", adapterConfig: {} },
    { adapterType: "pi_local", name: "Pi Builder", adapterConfig: { model: "openai/gpt-5.4-mini" } },
  ];

  for (const adapterCase of sshCapableAdapterCases) {
    it(`allows creating a ${adapterCase.adapterType} agent with an SSH default environment`, async () => {
      const expectedAdapterType = ["codex_local", "claude_local", "opencode_local", "pi_local"].includes(adapterCase.adapterType) ? "outpost_runner" : adapterCase.adapterType;
      const environmentId = "33333333-3333-4333-8333-333333333333";
      mockEnvironmentService.getById.mockResolvedValue({
        id: environmentId,
        spaceId,
        driver: "ssh",
        config: { host: "qa.example.invalid", username: "qa", remoteWorkspacePath: "/workspace" },
      });
      mockAgentService.create.mockResolvedValue({
        ...baseAgent,
        name: adapterCase.name,
        adapterType: expectedAdapterType,
        defaultEnvironmentId: environmentId,
      });

      const app = await createApp({
        type: "operator",
        userId: "operator-user",
        source: "local_implicit",
        isInstanceAdmin: true,
        spaceIds: [spaceId],
      });

      const res = await requestApp(app, (baseUrl) => request(baseUrl)
        .post(`/api/spaces/${spaceId}/agents`)
        .send({
          name: adapterCase.name,
          role: "engineer",
          adapterType: adapterCase.adapterType,
          adapterConfig: adapterCase.adapterConfig,
          defaultEnvironmentId: environmentId,
        }));

      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(mockAgentService.create).toHaveBeenCalledWith(
        spaceId,
        expect.objectContaining({
          adapterType: expectedAdapterType,
          defaultEnvironmentId: environmentId,
        }),
        { runnerResolved: true, aiConnectionInstall: undefined, createdByAgentId: null, interactionTexts: [expect.any(String)], createdByUserId: "operator-user", responsibleUserId: "operator-user", claudeLogin: { storedSessionId: null, ownerUserId: "operator-user", applyExistingWithoutClaim: false } },
      );
      if (["codex_local", "claude_local", "opencode_local", "pi_local"].includes(adapterCase.adapterType)) {
        if (adapterCase.adapterType === "codex_local") expect(mockAgentService.create.mock.calls[0][1].adapterConfig).toMatchObject({ provider: "codex" });
        else if (adapterCase.adapterType === "opencode_local") expect(mockAgentService.create.mock.calls[0][1].adapterConfig).toMatchObject({ provider: "opencode", model: adapterCase.adapterConfig.model });
        else if (adapterCase.adapterType === "pi_local") expect(mockAgentService.create.mock.calls[0][1].adapterConfig).toMatchObject({ provider: "acpx", acpxAgent: "pi", model: adapterCase.adapterConfig.model });
        else expect(mockAgentService.create.mock.calls[0][1].adapterConfig).toMatchObject({ provider: "acpx", acpxAgent: "claude", model: "claude-opus-5-5" });
        const { AGENT_RUNNER_SSH_PLATFORM_COMMAND } = await import("../services/agent-runner-selection.js");
        expect(mockRunSshCommand).toHaveBeenCalledWith(expect.objectContaining({ host: "qa.example.invalid" }), AGENT_RUNNER_SSH_PLATFORM_COMMAND, { timeoutMs: 10_000 });
      } else {
        expect(mockRunSshCommand).not.toHaveBeenCalled();
      }
    });
  }

  it("rejects updating an agent with an unsupported default environment driver", async () => {
    const environmentId = "33333333-3333-4333-8333-333333333333";
    mockEnvironmentService.getById.mockResolvedValue({
      id: environmentId,
      spaceId,
      driver: "ssh",
      config: {},
    });

    const app = await createApp({
      type: "operator",
      userId: "operator-user",
      source: "local_implicit",
      isInstanceAdmin: true,
      spaceIds: [spaceId],
    });

    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .patch(`/api/agents/${agentId}`)
      .send({
        defaultEnvironmentId: environmentId,
      }));

    expect(res.status).toBe(422);
    expect(res.body.error).toContain('Environment driver "ssh" is not allowed here');
    expect(mockAgentService.update).not.toHaveBeenCalled();
  });

  for (const adapterCase of sshCapableAdapterCases) {
    it(`allows updating a ${adapterCase.adapterType} agent with an SSH default environment`, async () => {
      const environmentId = "33333333-3333-4333-8333-333333333333";
      mockEnvironmentService.getById.mockResolvedValue({
        id: environmentId,
        spaceId,
        driver: "ssh",
        config: {},
      });
      mockAgentService.getById.mockResolvedValue({
        ...baseAgent,
        adapterType: adapterCase.adapterType,
        adapterConfig: adapterCase.adapterConfig,
        defaultEnvironmentId: null,
      });
      mockAgentService.update.mockResolvedValue({
        ...baseAgent,
        adapterType: adapterCase.adapterType,
        adapterConfig: adapterCase.adapterConfig,
        defaultEnvironmentId: environmentId,
      });

      const app = await createApp({
        type: "operator",
        userId: "operator-user",
        source: "local_implicit",
        isInstanceAdmin: true,
        spaceIds: [spaceId],
      });

      const res = await requestApp(app, (baseUrl) => request(baseUrl)
        .patch(`/api/agents/${agentId}`)
        .send({
          defaultEnvironmentId: environmentId,
        }));

      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(mockAgentService.update).toHaveBeenCalledWith(
        agentId,
        expect.objectContaining({
          defaultEnvironmentId: environmentId,
        }),
        expect.anything(),
      );
    });
  }

  it("rejects switching an agent away from an SSH-capable runtime without clearing its SSH default", async () => {
    const environmentId = "33333333-3333-4333-8333-333333333333";
    mockEnvironmentService.getById.mockResolvedValue({
      id: environmentId,
      spaceId,
      driver: "ssh",
      config: {},
    });
    mockAgentService.getById.mockResolvedValue({
      ...baseAgent,
      adapterType: "codex_local",
      defaultEnvironmentId: environmentId,
    });

    const app = await createApp({
      type: "operator",
      userId: "operator-user",
      source: "local_implicit",
      isInstanceAdmin: true,
      spaceIds: [spaceId],
    });

    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .patch(`/api/agents/${agentId}`)
      .send({
        adapterType: "process",
      }));

    expect(res.status).toBe(422);
    expect(res.body.error).toContain('Environment driver "ssh" is not allowed here');
    expect(mockAgentService.update).not.toHaveBeenCalled();
  });

  it("exposes explicit task assignment access on agent detail", async () => {
    mockAccessService.listPrincipalGrants.mockResolvedValue([
      {
        id: "grant-1",
        spaceId,
        principalType: "agent",
        principalId: agentId,
        permissionKey: "tasks:assign",
        scope: null,
        grantedByUserId: "operator-user",
        createdAt: new Date("2026-03-19T00:00:00.000Z"),
        updatedAt: new Date("2026-03-19T00:00:00.000Z"),
      },
    ]);

    const app = await createApp({
      type: "operator",
      userId: "operator-user",
      source: "local_implicit",
      isInstanceAdmin: true,
      spaceIds: [spaceId],
    });

    const res = await requestApp(app, (baseUrl) => request(baseUrl).get(`/api/agents/${agentId}`));

    expect(res.status).toBe(200);
    expect(res.body.access.canAssignTasks).toBe(true);
    expect(res.body.access.taskAssignSource).toBe("explicit_grant");
  }, 15_000);

  it("reports simple-mode task assignment as enabled for active space agent members", async () => {
    mockAccessService.listPrincipalGrants.mockResolvedValue([]);

    const app = await createApp({
      type: "operator",
      userId: "operator-user",
      source: "local_implicit",
      isInstanceAdmin: true,
      spaceIds: [spaceId],
    });

    const res = await requestApp(app, (baseUrl) => request(baseUrl).get(`/api/agents/${agentId}`));

    expect(res.status).toBe(200);
    expect(res.body.access.canAssignTasks).toBe(true);
    expect(res.body.access.taskAssignSource).toBe("simple_default");
  }, 15_000);

  it("keeps task assignment independent from creation authority", async () => {
    mockAgentService.updatePermissions.mockResolvedValue({
      ...baseAgent,
      permissions: { canCreateAgents: true },
    });

    const app = await createApp({
      type: "operator",
      userId: "operator-user",
      source: "local_implicit",
      isInstanceAdmin: true,
      spaceIds: [spaceId],
    });

    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .patch(`/api/agents/${agentId}/permissions`)
      .send({ canCreateAgents: true, canAssignTasks: false }));

    expect(res.status).toBe(200);
    expect(mockAccessService.setPrincipalPermission).toHaveBeenCalledWith(
      spaceId,
      "agent",
      agentId,
      "agents:create",
      true,
      "operator-user",
    );
    expect(mockAccessService.setPrincipalPermission).toHaveBeenCalledWith(
      spaceId,
      "agent",
      agentId,
      "tasks:assign",
      false,
      "operator-user",
    );
  });

  it("preserves disabled skill creation when unrelated permission updates omit that field", async () => {
    mockAgentService.updatePermissions.mockResolvedValue({
      ...baseAgent,
      permissions: { canCreateAgents: false, canCreateSkills: false },
    });

    const app = await createApp({
      type: "operator",
      userId: "operator-user",
      source: "local_implicit",
      isInstanceAdmin: true,
      spaceIds: [spaceId],
    });

    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .patch(`/api/agents/${agentId}/permissions`)
      .send({ canCreateAgents: false, canAssignTasks: true }));

    expect(res.status).toBe(200);
    expect(mockAgentService.updatePermissions).toHaveBeenCalledWith(agentId, {
      canCreateAgents: false,
      canAssignTasks: true,
    }, { actorAgentId: null });
    expect(res.body.permissions.canCreateSkills).toBe(false);
  });

  it("does not let a Default agent denied creation restore it for itself or grant it to another agent", async () => {
    const lead = { ...baseAgent, id: "lead-agent", role: "lead", permissions: { canCreateAgents: false, canCreateSkills: true,
      leadCreationDeniedBy: { actorType: "user", actorId: "operator-user", at: "2026-11-08T00:00:00.000Z" } } };
    const worker = { ...baseAgent, permissions: { canCreateAgents: false, canCreateSkills: true } };
    mockAgentService.getById.mockImplementation(async (id: string) => (id === lead.id ? lead : id === worker.id ? worker : null));
    mockAccessService.decide.mockImplementation(async (input: { action?: string }) => ({
      allowed: input.action !== "agents:create",
      action: input.action,
      reason: input.action === "agents:create" ? "deny_missing_grant" : "allow_test",
      explanation: input.action === "agents:create" ? "Missing permission: agents:create." : "Allowed in test.",
    }));
    const app = createApp({ type: "agent", agentId: lead.id, spaceId, runId: "run-1", source: "agent_jwt" });

    for (const target of [lead.id, worker.id]) {
      const res = await requestApp(app, (baseUrl) => request(baseUrl)
        .patch(`/api/agents/${target}/permissions`)
        .send({ canCreateAgents: true, canAssignTasks: true }));
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(res.body.error).toContain("Missing permission: agents:create.");
    }
    expect(mockAgentService.updatePermissions).not.toHaveBeenCalled();
    expect(mockAccessService.setPrincipalPermission).not.toHaveBeenCalled();
  });

  it("writes creation changes as explicit grants without Default agent metadata", async () => {
    const lead = { ...baseAgent, role: "lead", permissions: { canCreateAgents: true, canCreateSkills: true } };
    mockAgentService.getById.mockResolvedValue(lead);
    mockAgentService.updatePermissions.mockResolvedValue({ ...lead, permissions: { canCreateAgents: false, canCreateSkills: true } });
    const app = await createApp({ type: "operator", userId: "operator-user", source: "local_implicit", isInstanceAdmin: true, spaceIds: [spaceId] });

    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .patch(`/api/agents/${agentId}/permissions`)
      .send({ canCreateAgents: false, canAssignTasks: true }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(mockAgentService.updatePermissions).toHaveBeenCalledWith(agentId, {
      canCreateAgents: false,
      canAssignTasks: true,
    }, { actorAgentId: null });

    // The toggle is authoritative: turning it off also removes an explicit agents:create grant.
    expect(mockAccessService.setPrincipalPermission).toHaveBeenCalledWith(
      spaceId, "agent", agentId, "agents:create", false, "operator-user",
    );
  });

  it("rejects Default agent permission updates outside the caller space scope", async () => {
    const app = await createApp({
      type: "agent",
      agentId: "lead-agent",
      spaceId: "33333333-3333-4333-8333-333333333333",
      runId: "run-1",
      source: "agent_key",
    });

    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .patch(`/api/agents/${agentId}/permissions`)
      .send({ canCreateAgents: true, canAssignTasks: true }));

    // Cross-tenant requests return 404 (not 403) so the status code cannot be
    // used as an existence oracle for other tenants' agent ids.
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Agent not found");
    expect(mockAgentService.updatePermissions).not.toHaveBeenCalled();
    expect(mockAccessService.setPrincipalPermission).not.toHaveBeenCalled();
  });

  it("exposes a dedicated agent route for the inbox mine view", async () => {
    mockIssueService.list.mockResolvedValue([
      {
        id: "issue-1",
        identifier: "PAP-910",
        title: "Inbox follow-up",
        status: "todo",
      },
    ]);

    const app = await createApp({
      type: "agent",
      agentId,
      spaceId,
      runId: "run-1",
      source: "agent_key",
    });

    const res = await requestApp(app, (baseUrl) => request(baseUrl)
      .get("/api/agents/me/inbox/mine")
      .query({ userId: "operator-user" }));

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: "issue-1",
        identifier: "PAP-910",
        title: "Inbox follow-up",
        status: "todo",
      },
    ]);
    expect(mockIssueService.list).toHaveBeenCalledWith(spaceId, {
      touchedByUserId: "operator-user",
      inboxArchivedByUserId: "operator-user",
      status: "backlog,todo,in_progress,in_review,blocked,done",
      limit: 500,
    });
  });

  describe("agent configuration read gate", () => {
    it.each(["configuration", "config-revisions", "config-revisions/55555555-5555-4555-8555-555555555555"])("allows self %s reads without peer configuration grants", async (suffix) => {
      const plaintext = "self-config-value-must-not-leak";
      const adapterConfig = { env: { GENERIC_NAME: { type: "plain", value: plaintext } } };
      mockAgentService.getById.mockResolvedValue({ ...baseAgent, adapterConfig });
      const revision = { id: "55555555-5555-4555-8555-555555555555", beforeConfig: { adapterConfig }, afterConfig: { adapterConfig } };
      mockAgentService.listConfigRevisions.mockResolvedValue([revision]);
      mockAgentService.getConfigRevision.mockResolvedValue(revision);
      mockAccessService.decide.mockImplementation(async (input) => ({
        allowed: input.action === "agent_config:read" && input.resource.type === "agent" && input.resource.agentId === agentId,
        reason: "allow_self",
        explanation: "Self configuration read",
      }));
      const app = await createApp({ type: "agent", agentId, spaceId, source: "agent_key" });

      const response = await request(app).get(`/api/agents/${agentId}/${suffix}`);

      expect(response.status).toBe(200);
      expect(JSON.stringify(response.body)).not.toContain(plaintext);
      expect(mockAccessService.decide).toHaveBeenCalledWith(expect.objectContaining({
        action: "agent_config:read",
        resource: { type: "agent", spaceId, agentId },
        scope: { targetAgentId: agentId },
      }));
    });

    it("allows an operator member without agents:create to read agent configuration", async () => {
      // Operator (human) users with space membership but no agents:create
      // grant should still be able to view agent configuration — this is
      // the read-only permission loosening introduced by this PR.
      mockAccessService.canUser.mockResolvedValue(false);
      mockAccessService.hasPermission.mockResolvedValue(false);
      const plaintextValue = "configuration-value-must-not-leak";
      mockAgentService.getById.mockResolvedValue({
        ...baseAgent,
        adapterConfig: {
          env: { GENERIC_NAME: { type: "plain", value: plaintextValue } },
        },
      });

      const app = await createApp({
        type: "operator",
        userId: "operator-user",
        source: "session",
        isInstanceAdmin: false,
        spaceIds: [spaceId],
      });

      const res = await request(app).get(`/api/agents/${agentId}/configuration`);

      expect(res.status).toBe(200);
      expect(res.body.adapterConfig.env).toEqual({
        GENERIC_NAME: { type: "plain", value: "***REDACTED***" },
      });
      expect(JSON.stringify(res.body)).not.toContain(plaintextValue);
    });

    it("redacts plaintext env values in space configuration-list responses", async () => {
      const plaintextValue = "configuration-list-value-must-not-leak";
      mockAgentService.list.mockResolvedValue([
        {
          ...baseAgent,
          adapterConfig: {
            env: { GENERIC_NAME: { type: "plain", value: plaintextValue } },
          },
        },
      ]);

      const app = await createApp({
        type: "operator",
        userId: "operator-user",
        source: "session",
        isInstanceAdmin: false,
        spaceIds: [spaceId],
      });

      const res = await request(app).get(`/api/spaces/${spaceId}/agent-configurations`);

      expect(res.status).toBe(200);
      expect(res.body[0].adapterConfig.env).toEqual({
        GENERIC_NAME: { type: "plain", value: "***REDACTED***" },
      });
      expect(JSON.stringify(res.body)).not.toContain(plaintextValue);
    });

    it("redacts plaintext env values in configuration revisions", async () => {
      const plaintextValue = "revision-value-must-not-leak";
      mockAgentService.listConfigRevisions.mockResolvedValue([
        {
          id: "33333333-3333-4333-8333-333333333333",
          beforeConfig: {
            adapterConfig: {
              env: { GENERIC_NAME: { type: "plain", value: plaintextValue } },
            },
          },
          afterConfig: {
            adapterConfig: {
              env: { GENERIC_NAME: plaintextValue },
            },
          },
        },
      ]);

      const app = await createApp({
        type: "operator",
        userId: "operator-user",
        source: "session",
        isInstanceAdmin: false,
        spaceIds: [spaceId],
      });

      const res = await request(app).get(`/api/agents/${agentId}/config-revisions`);

      expect(res.status).toBe(200);
      expect(res.body[0].beforeConfig.adapterConfig.env.GENERIC_NAME).toEqual({
        type: "plain",
        value: "***REDACTED***",
      });
      expect(res.body[0].afterConfig.adapterConfig.env.GENERIC_NAME).toEqual({
        type: "plain",
        value: "***REDACTED***",
      });
      expect(JSON.stringify(res.body)).not.toContain(plaintextValue);
    });

    it("denies an agent actor without configure or suggest grants when reading peer config", async () => {
      // Agent actors must pass the agent configuration read ladder. A peer
      // agent in the same space without agents:configure or
      // agents:suggest-changes must not read another agent's configuration.
      const peerAgentId = "33333333-3333-4333-8333-333333333333";
      const peerAgent = { ...baseAgent, id: peerAgentId };
      mockAgentService.getById.mockImplementation(async (id: string) => {
        if (id === peerAgentId) return peerAgent;
        if (id === agentId) {
          return { ...baseAgent, permissions: { canCreateAgents: false } };
        }
        return null;
      });
      mockAccessService.decide.mockResolvedValue({
        allowed: false,
        reason: "deny_no_grant",
        explanation: "Missing permission: agents:configure or agents:suggest-changes.",
      });

      const app = await createApp({
        type: "agent",
        agentId,
        spaceId,
        runId: "run-1",
        source: "agent_key",
      });

      const res = await request(app).get(`/api/agents/${peerAgentId}/configuration`);

      expect(res.status).toBe(403);
      expect(mockAccessService.decide).toHaveBeenCalledWith(expect.objectContaining({
        action: "agent_config:read",
        resource: { type: "agent", spaceId, agentId: peerAgentId },
        scope: { targetAgentId: peerAgentId },
      }));
    });

    it.each(["agents:read", "agents:configure", "agents:suggest-changes"])("allows an agent actor with %s grant to read peer config", async (permissionKey) => {
      // Suggest-tier authority implies read access so the agent can prepare a
      // consented diff without receiving direct change authority.
      const peerAgentId = "44444444-4444-4444-8444-444444444444";
      const peerAgent = { ...baseAgent, id: peerAgentId };
      mockAgentService.getById.mockImplementation(async (id: string) => {
        if (id === peerAgentId) return peerAgent;
        if (id === agentId) {
          return { ...baseAgent, permissions: { canCreateAgents: false } };
        }
        return null;
      });
      mockAccessService.decide.mockResolvedValue({
        allowed: true,
        reason: "allow_explicit_grant",
        explanation: `Allowed by explicit grant ${permissionKey}.`,
        grant: {
          principalType: "agent",
          principalId: agentId,
          permissionKey,
          scope: null,
        },
      });

      const app = await createApp({
        type: "agent",
        agentId,
        spaceId,
        runId: "run-1",
        source: "agent_key",
      });

      const res = await request(app).get(`/api/agents/${peerAgentId}/configuration`);

      expect(res.status).toBe(200);
      expect(mockAccessService.decide).toHaveBeenCalledWith(expect.objectContaining({
        action: "agent_config:read",
        resource: { type: "agent", spaceId, agentId: peerAgentId },
        scope: { targetAgentId: peerAgentId },
      }));
    });
  });

  it.each([
    ["its own budget", agentId, 0],
    ["its own budget", agentId, 5000],
    ["another agent's budget as a Default agent", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 5000],
  ])("budget authority: PATCH /agents/:id never lets an agent change %s (%s, %i)", async (_case, actorAgentId, amount) => {
    mockAgentService.getById.mockImplementation(async (id: string) => id === agentId
      ? { ...baseAgent, budgetMonthlyCents: 500 }
      : { ...baseAgent, id, role: "lead", permissions: { canCreateAgents: true } });
    const app = createApp({ type: "agent", agentId: actorAgentId, spaceId, source: "agent_key", runId: "run-1" });
    const response = await requestApp(app, url => request(url).patch(`/api/agents/${agentId}`).send({ budgetMonthlyCents: amount }));
    expect(response.status, JSON.stringify(response.body)).toBe(403);
    expect(response.body.code).toBe("operator_access_required");
    expect(response.body.remediation).toContain("this denial is final");
    expect(response.body.remediation).toContain(`[Open the agent's budget](/<prefix>/agents/${agentId}/budgets)`);
    expect(mockAgentService.update).not.toHaveBeenCalled();
    expect(mockBudgetService.upsertPolicy).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
  });
  it("budget authority: a configuration rollback never lets an agent restore a different budget", async () => {
    mockAgentService.getById.mockResolvedValue({ ...baseAgent, budgetMonthlyCents: 500 });
    mockAgentService.getConfigRevision.mockResolvedValue({
      id: "33333333-3333-4333-8333-333333333333",
      afterConfig: { adapterType: "process", adapterConfig: {}, runtimeConfig: {}, budgetMonthlyCents: 50000 },
    });
    const app = createApp({ type: "agent", agentId, spaceId, source: "agent_key", runId: "run-1" });
    const response = await requestApp(app, url => request(url).post(`/api/agents/${agentId}/config-revisions/33333333-3333-4333-8333-333333333333/rollback`));
    expect(response.status, JSON.stringify(response.body)).toBe(403);
    expect(response.body.code).toBe("operator_access_required");
    expect(response.body.remediation).toContain(`[Open the agent's budget](/<prefix>/agents/${agentId}/budgets)`);
    expect(mockAgentService.rollbackConfigRevision).not.toHaveBeenCalled();
  });
  it("budget authority: accepts an unchanged legacy amount with an unrelated title edit", async () => {
    const app = createApp({ type: "agent", agentId, spaceId, source: "agent_key" });
    const response = await requestApp(app, url => request(url).patch(`/api/agents/${agentId}`).send({ budgetMonthlyCents: 0, title: "New title" }));
    expect(response.status).toBe(200);
    expect(mockAgentService.update).toHaveBeenCalled();
  });
  it.each(["agents", "agent-creations"])("budget authority: rejects agent immediate creation budgets through %s", async route => {
    mockAccessService.hasPermission.mockResolvedValue(true);
    const app = createApp({ type: "agent", agentId, spaceId, source: "agent_key" });
    const response = await requestApp(app, url => request(url).post(`/api/spaces/${spaceId}/${route}`).send({ name: "New agent", role: "engineer", adapterType: "process", budgetMonthlyCents: 5000 }));
    expect(response.status, JSON.stringify(response.body)).toBe(403);
    expect(response.body.code).toBe("operator_access_required");
    expect(response.body.remediation).toContain("[Open budgets](/<prefix>/activity/budgets)");
    expect(mockAgentService.create).not.toHaveBeenCalled();
    expect(mockBudgetService.upsertPolicy).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
  });
  it("budget authority: preserves a proposed budget without applying a policy before approval", async () => {
    mockAccessService.hasPermission.mockResolvedValue(true);
    mockAgentService.create.mockResolvedValue({ ...baseAgent, status: "pending_approval", budgetMonthlyCents: 5000 });
    mockApprovalService.create.mockResolvedValue({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "pending", type: "create_agent", spaceId });
    const app = createApp({ type: "agent", agentId, spaceId, source: "agent_key" }, { requireOperatorApprovalForNewAgents: true });
    const response = await requestApp(app, url => request(url).post(`/api/spaces/${spaceId}/agent-creations`).send({ name: "Proposed agent", role: "engineer", adapterType: "process", budgetMonthlyCents: 5000 }));
    expect(response.status).toBe(201);
    expect(response.body.approval.status).toBe("pending");
    expect(mockApprovalService.create).toHaveBeenCalledWith(spaceId, expect.objectContaining({ payload: expect.objectContaining({ budgetMonthlyCents: 5000 }) }));
    expect(mockBudgetService.upsertPolicy).not.toHaveBeenCalled();
  });
  it("budget authority: forwards the actual operator identity on legacy updates", async () => {
    const app = createApp({ type: "operator", userId: "operator-user", source: "session", spaceIds: [spaceId] });
    const response = await requestApp(app, url => request(url).patch(`/api/agents/${agentId}`).send({ budgetMonthlyCents: 5000 }));
    expect(response.status).toBe(200);
    expect(mockAgentService.update).toHaveBeenCalledWith(agentId, expect.objectContaining({ budgetMonthlyCents: 5000 }), expect.objectContaining({ recordRevision: expect.objectContaining({ createdByUserId: "operator-user", createdByAgentId: null }) }));
    expect(mockLogActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ actorType: "user", actorId: "operator-user", agentId: null }));
  });
  it.each(["agents", "agent-creations"])("budget authority: records the real operator actor for immediate %s budgets", async route => {
    mockAgentService.create.mockResolvedValue({ ...baseAgent, budgetMonthlyCents: 5000 });
    const app = createApp({ type: "operator", userId: "operator-user", source: "local_implicit", spaceIds: [spaceId] });
    const response = await requestApp(app, url => request(url).post(`/api/spaces/${spaceId}/${route}`).send({ name: "New agent", role: "engineer", adapterType: "process", budgetMonthlyCents: 5000 }));
    expect(response.status).toBe(201);
    expect(mockAgentService.create).toHaveBeenCalledWith(spaceId, expect.objectContaining({ budgetMonthlyCents: 5000 }), expect.objectContaining({ createdByUserId: "operator-user" }));
    expect(mockBudgetService.upsertPolicy).not.toHaveBeenCalled();
  });
  it("rejects heartbeat cancellation outside the caller space scope", async () => {
    mockHeartbeatService.getRun.mockResolvedValue({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      spaceId: "33333333-3333-4333-8333-333333333333",
      agentId,
      status: "running",
    });

    const app = await createApp({
      type: "operator",
      userId: "operator-user",
      source: "session",
      isInstanceAdmin: false,
      spaceIds: [spaceId],
    });

    const res = await requestApp(app, (baseUrl) => request(baseUrl).post("/api/heartbeat-runs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/cancel").send({}));

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Heartbeat run not found");
    expect(mockHeartbeatService.cancelRun).not.toHaveBeenCalled();
  });
});

vi.mock("../services/agent-lifecycle.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/agent-lifecycle.js")>();
  return { ...actual, createAgentLifecycle: () => ({
    requestCreation: (...args: unknown[]) => mockAgentService.create(...args),
    approveCreation: (...args: unknown[]) => mockAgentService.activatePendingApproval(...args),
    terminateAgent: (...args: unknown[]) => mockAgentService.terminate(...args),
    updateAndTransition: (...args: unknown[]) => mockAgentService.updateAndTransition(...args),
  }) };
});
