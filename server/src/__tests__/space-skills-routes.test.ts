import express from "express";
import { createHash } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hoistModuleGraph } from "./helpers/hoist-module-graph.js";
import type { PluginWorkerManager } from "../services/plugin-worker-manager.js";

const mockCaptureRunIdentity = vi.hoisted(() => vi.fn());

const mockSkillSourceService = vi.hoisted(() => ({ sourceForSkill: vi.fn(), importFromUrl: vi.fn(), discover: vi.fn(), branches: vi.fn() }));

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  canUser: vi.fn(),
  decide: vi.fn(),
  hasPermission: vi.fn(),
}));

const mockSpaceSkillService = vi.hoisted(() => ({
  list: vi.fn(),
  categoryCounts: vi.fn(),
  detail: vi.fn(),
  listVersions: vi.fn(),
  getVersion: vi.fn(),
  createVersion: vi.fn(),
  starSkill: vi.fn(),
  unstarSkill: vi.fn(),
  forkSkill: vi.fn(),
  renameSkill: vi.fn(),
  forkPrecheck: vi.fn(),
  listComments: vi.fn(),
  createComment: vi.fn(),
  updateComment: vi.fn(),
  deleteComment: vi.fn(),
  importFromSource: vi.fn(),
  createLocalSkill: vi.fn(),
  updateSkill: vi.fn(),
  updateFile: vi.fn(),
  deleteFile: vi.fn(),
  scanProjectWorkspaces: vi.fn(),
  deleteSkill: vi.fn(),
  auditSkill: vi.fn(),
  getById: vi.fn(),
  getByRouteRef: vi.fn(),
  installUpdate: vi.fn(),
  listTestInputs: vi.fn(),
  createTestInput: vi.fn(),
  updateTestInput: vi.fn(),
  deleteTestInput: vi.fn(),
  listTestRunTemplates: vi.fn(),
  createTestRunTemplate: vi.fn(),
  updateTestRunTemplate: vi.fn(),
  deleteTestRunTemplate: vi.fn(),
  createTestRun: vi.fn(),
  listTestRuns: vi.fn(),
  getTestRunDetail: vi.fn(),
  cancelTestRun: vi.fn(),
  deleteTestRun: vi.fn(),
  pruneExpiredTestHarnessIssues: vi.fn(),
}));

const mockSpaceSkillPolicyService = vi.hoisted(() => ({
  resolveAgentPrincipal: vi.fn(),
  evaluate: vi.fn(),
}));

const mockIssueService = vi.hoisted(() => ({
  create: vi.fn(),
  getById: vi.fn(),
  update: vi.fn(),
}));

const mockHeartbeatService = vi.hoisted(() => ({
  wakeup: vi.fn(),
  cancelRun: vi.fn(),
}));
const mockHeartbeatFactory = vi.hoisted(() => vi.fn());

const mockLogActivity = vi.hoisted(() => vi.fn());
const mockTrackSkillImported = vi.hoisted(() => vi.fn());
const mockGetTelemetryClient = vi.hoisted(() => vi.fn());
const mockReflectionCoachMutationGate = vi.hoisted(() => ({
  assertConsented: vi.fn(),
}));

function allowSkillChangeDecision(reason = "allow_direct_change") {
  return {
    allowed: true,
    action: "skill_config:update",
    reason,
    explanation: "Allowed.",
    grant: {
      principalType: "agent",
      principalId: "agent-1",
      permissionKey: reason === "allow_consented_change" ? "skills:suggest-changes" : "skills:create",
      scope: null,
    },
  };
}

function denySkillChangeDecision(reason = "deny_no_grant", explanation = "Missing permission: skills:create or skills:suggest-changes.") {
  return {
    allowed: false,
    action: "skill_config:update",
    reason,
    explanation,
  };
}

function denyTaskAssignDecision(reason = "deny_missing_grant", explanation = "Missing permission: tasks:assign") {
  return {
    allowed: false,
    action: "tasks:assign",
    reason,
    explanation,
  };
}

function denySkillPolicy(action = "skills.import") {
  return {
    allowed: false,
    action,
    reason: "explicit_rule",
    policyRevision: 1,
    matchedRuleId: "deny-skill-mutation",
    remediation: "Contact a space administrator to change the skill policy.",
  };
}

function registerModuleMocks() {
  vi.doMock("../services/run-identity.js", async () => ({
    ...await vi.importActual<typeof import("../services/run-identity.js")>("../services/run-identity.js"),
    captureRunIdentity: mockCaptureRunIdentity,
  }));
  vi.doMock("../services/skill-sources.js", () => ({ skillSourceService: () => mockSkillSourceService }));
  vi.doMock("../routes/authz.js", async () => vi.importActual("../routes/authz.js"));



  vi.doMock("../services/access.js", () => ({
    accessService: () => mockAccessService,
  }));

  vi.doMock("../services/activity-log.js", () => ({
    persistActivity: vi.fn(),
    publishActivity: vi.fn(),
    logActivity: mockLogActivity,
  }));

  vi.doMock("../services/agents.js", () => ({
    agentService: () => mockAgentService,
  }));

  // This route-contract harness supplies no database. Private-source decisions
  // are exercised with the real database in project-skill-sources.test.ts.
  vi.doMock("../services/skill-access.js", async () => {
    const actual = await vi.importActual<typeof import("../services/skill-access.js")>("../services/skill-access.js");
    return { ...actual, skillAccessService: (db: Parameters<typeof actual.skillAccessService>[0]) => ({
      ...actual.skillAccessService(db), assertSource: async () => {},
    }) };
  });

  vi.doMock("../services/space-skills.js", async () => {
    const actual = await vi.importActual<typeof import("../services/space-skills.js")>(
      "../services/space-skills.js",
    );
    return {
      ...actual,
      spaceSkillService: () => mockSpaceSkillService,
    };
  });

  vi.doMock("../services/space-skill-policy.js", async () => {
    const actual = await vi.importActual<typeof import("../services/space-skill-policy.js")>(
      "../services/space-skill-policy.js",
    );
    return {
      ...actual,
      spaceSkillPolicyService: () => mockSpaceSkillPolicyService,
    };
  });

  vi.doMock("../services/change-consent-gate.js", async () => {
    const actual = await vi.importActual<typeof import("../services/change-consent-gate.js")>(
      "../services/change-consent-gate.js",
    );
    return {
      ...actual,
      changeConsentGateService: () => mockReflectionCoachMutationGate,
    };
  });

  vi.doMock("../services/index.js", () => ({
    accessService: () => mockAccessService,
    agentService: () => mockAgentService,
    spaceSkillService: () => mockSpaceSkillService,
    issueService: () => mockIssueService,
    heartbeatService: mockHeartbeatFactory,
    logActivity: mockLogActivity,
  }));
}

function operatorActor(userId = "local-operator", source = "local_implicit") {
  return {
    type: "operator",
    userId: userId,
    spaceIds: ["space-1"],
    source: source,
    isInstanceAdmin: false,
  };
}

function assignedAgentActor() {
  return {
    type: "agent",
    agentId: "55555555-5555-4555-8555-555555555555",
    spaceId: "space-1",
    runId: "run-1",
  };
}

function createSkillTestRunDetails(overrides: Record<string, unknown> = {}) {
  return {
  id: "22222222-2222-4222-8222-222222222222",
  spaceId: "space-1",
  skillId: "skill-1",
  inputId: "11111111-1111-4111-8111-111111111111",
  inputSnapshot: "Try the skill",
  skillVersionId: "33333333-3333-4333-8333-333333333333",
  agentId: "55555555-5555-4555-8555-555555555555",
  agentConfigSnapshot: { adapterType: "codex_local" },
  issueId: "44444444-4444-4444-8444-444444444444",
  templateId: "built-in:default-test-template",
  templateName: "Default test template",
  templateBody: "Default {{skillName}}",
  renderedTemplateBody: "Default Review",
  harnessIssueDescription: "Try the skill\n\n---\n\nDefault Review",
  status: "queued",
  outputDocumentKey: "output",
  outputSnapshot: "",
  error: null,
  deletedAt: null,
  supersededAt: null,
  harnessIssueExpiresAt: null,
  harnessIssueDeletedAt: null,
    ...overrides,
  };
}

describe("space skill mutation permissions", () => {
  const routeModules = hoistModuleGraph(registerModuleMocks, async () => {
    const [{ spaceSkillRoutes }, { errorHandler }] = await Promise.all([
      vi.importActual<typeof import("../routes/space-skills.js")>("../routes/space-skills.js"),
      vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
    ]);
    return { spaceSkillRoutes, errorHandler };
  });

  function createApp(actor: Record<string, unknown>, onResponse?: (res: express.Response) => void, database: any = {},
    options: { pluginWorkerManager?: PluginWorkerManager } = {}) {
    const { spaceSkillRoutes, errorHandler } = routeModules.value;
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      (req as any).actor = actor;
      onResponse?.(res);
      next();
    });
    app.use("/api", spaceSkillRoutes(database, options));
    app.use(errorHandler);
    return app;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockSpaceSkillService.getByRouteRef.mockImplementation(async (spaceId: string, ref: string) => {
      const skill = await mockSpaceSkillService.getById(spaceId, ref);
      return skill ? { ...skill, id: ref } : skill;
    });
    mockHeartbeatFactory.mockReturnValue(mockHeartbeatService);
    mockCaptureRunIdentity.mockResolvedValue({ run: { responsibleUserId: "validated-owner" } });
    mockSkillSourceService.sourceForSkill.mockResolvedValue(null);
    mockSkillSourceService.importFromUrl.mockImplementation((spaceId, source) => mockSpaceSkillService.importFromSource(spaceId, source));
    mockGetTelemetryClient.mockReturnValue({ track: vi.fn() });
    mockSpaceSkillService.importFromSource.mockResolvedValue({
      imported: [],
      warnings: [],
    });
    mockSpaceSkillService.scanProjectWorkspaces.mockResolvedValue({
      scannedProjects: 0,
      scannedWorkspaces: 0,
      discovered: 0,
      imported: [],
      updated: [],
      skipped: [],
      conflicts: [],
      candidates: [],
      warnings: [],
    });
    mockSpaceSkillService.list.mockResolvedValue([]);
    mockSpaceSkillService.categoryCounts.mockResolvedValue([]);
    mockSpaceSkillService.detail.mockResolvedValue(null);
    mockSpaceSkillService.listVersions.mockResolvedValue([]);
    mockSpaceSkillService.getVersion.mockResolvedValue(null);
    mockSpaceSkillService.createVersion.mockResolvedValue({
      id: "version-1",
      spaceId: "space-1",
      spaceSkillId: "skill-1",
      revisionNumber: 1,
      label: "v1",
      fileInventory: [{ path: "SKILL.md", kind: "skill", content: "# Skill" }],
      authorAgentId: null,
      authorUserId: "operator",
      createdAt: new Date("2026-05-26T00:00:00.000Z"),
    });
    mockSpaceSkillService.starSkill.mockResolvedValue({
      skillId: "skill-1",
      starred: true,
      starCount: 1,
    });
    mockSpaceSkillService.unstarSkill.mockResolvedValue({
      skillId: "skill-1",
      starred: false,
      starCount: 0,
    });
    const forkedSkill = {
      id: "skill-fork",
      spaceId: "space-1",
      key: "space/space-1/review-fork",
      slug: "review-fork",
      name: "Review Fork",
      description: null,
      markdown: "# Review",
      sourceType: "local_path",
      sourceLocator: "/tmp/review-fork",
      sourceRef: null,
      trustLevel: "markdown_only",
      compatibility: "compatible",
      fileInventory: [{ path: "SKILL.md", kind: "skill" }],
      iconUrl: null,
      color: null,
      tagline: null,
      authorName: null,
      homepageUrl: null,
      categories: [],
      sharingScope: "space",
      publicShareToken: null,
      forkedFromSkillId: "skill-1",
      forkedFromSpaceId: "space-1",
      starCount: 0,
      installCount: 1,
      forkCount: 0,
      currentVersionId: null,
      metadata: null,
      createdAt: new Date("2026-05-26T00:00:00.000Z"),
      updatedAt: new Date("2026-05-26T00:00:00.000Z"),
    };
    mockSpaceSkillService.forkSkill.mockResolvedValue({
      skill: forkedSkill,
      original: {
        id: "skill-1",
        name: "Review",
        slug: "review",
        sourceType: "github",
        sourceLocator: "https://github.com/acme/review",
        sourceRef: "abc123",
      },
      reassignments: [],
    });
    mockSpaceSkillService.renameSkill.mockResolvedValue({
      skill: { ...forkedSkill, id: "skill-1", name: "Ship PR", slug: "ship-pr", key: "space/space-1/ship-pr" },
      previousName: "Review",
      previousSlug: "review",
      previousKey: "space/space-1/review",
      reassignments: [
        { agentId: "11111111-1111-4111-8111-111111111111", previousSkillKey: "space/space-1/review", nextSkillKey: "space/space-1/ship-pr" },
      ],
    });
    mockSpaceSkillService.forkPrecheck.mockResolvedValue({
      skillId: "skill-1",
      original: {
        id: "skill-1",
        name: "Review",
        slug: "review",
        sourceType: "github",
        sourceLocator: "https://github.com/acme/review",
        sourceRef: "abc123",
      },
      agentUsageCount: 0,
      usedByAgents: [],
      existingForks: [],
    });
    mockSpaceSkillService.listComments.mockResolvedValue([]);
    mockSpaceSkillService.createComment.mockResolvedValue({
      id: "comment-1",
      spaceId: "space-1",
      spaceSkillId: "skill-1",
      parentCommentId: null,
      authorAgentId: null,
      authorUserId: "operator",
      body: "Looks good",
      deletedAt: null,
      createdAt: new Date("2026-05-26T00:00:00.000Z"),
      updatedAt: new Date("2026-05-26T00:00:00.000Z"),
    });
    mockSpaceSkillService.updateComment.mockResolvedValue({
      id: "comment-1",
      spaceId: "space-1",
      spaceSkillId: "skill-1",
      parentCommentId: null,
      authorAgentId: null,
      authorUserId: "operator",
      body: "Updated",
      deletedAt: null,
      createdAt: new Date("2026-05-26T00:00:00.000Z"),
      updatedAt: new Date("2026-05-26T00:00:00.000Z"),
    });
    mockSpaceSkillService.deleteComment.mockResolvedValue({
      id: "comment-1",
      spaceId: "space-1",
      spaceSkillId: "skill-1",
      parentCommentId: null,
      authorAgentId: null,
      authorUserId: "operator",
      body: "Updated",
      deletedAt: new Date("2026-05-26T00:01:00.000Z"),
      createdAt: new Date("2026-05-26T00:00:00.000Z"),
      updatedAt: new Date("2026-05-26T00:01:00.000Z"),
    });
    mockSpaceSkillService.createLocalSkill.mockResolvedValue({
      id: "skill-1",
      spaceId: "space-1",
      key: "space/space-1/review",
      slug: "review",
      name: "Review",
      description: null,
      markdown: "# Review",
      sourceType: "local_path",
      sourceLocator: "/tmp/review",
      sourceRef: null,
      trustLevel: "markdown_only",
      compatibility: "compatible",
      fileInventory: [{ path: "SKILL.md", kind: "skill" }],
      iconUrl: null,
      color: null,
      tagline: null,
      authorName: null,
      homepageUrl: null,
      categories: [],
      sharingScope: "space",
      publicShareToken: null,
      forkedFromSkillId: null,
      forkedFromSpaceId: null,
      starCount: 0,
      installCount: 1,
      forkCount: 0,
      currentVersionId: null,
      metadata: null,
      createdAt: new Date("2026-05-26T00:00:00.000Z"),
      updatedAt: new Date("2026-05-26T00:00:00.000Z"),
    });
    mockSpaceSkillService.updateSkill.mockResolvedValue({
      id: "skill-1",
      slug: "review",
      categories: ["memory", "review"],
      sharingScope: "space",
    });
    mockSpaceSkillService.updateFile.mockResolvedValue({
      skillId: "skill-1",
      path: "SKILL.md",
      kind: "skill",
      content: "# Review",
      language: "markdown",
      markdown: true,
      editable: true,
    });
    mockSpaceSkillService.deleteFile.mockResolvedValue({
      skillId: "skill-1",
      path: "references",
      target: "folder",
      deletedPaths: ["references/example.md"],
    });
    mockSpaceSkillService.scanProjectWorkspaces.mockResolvedValue({
      scannedProjects: 0,
      scannedWorkspaces: 0,
      discovered: 0,
      imported: [],
      updated: [],
      skipped: [],
      conflicts: [],
      warnings: [],
    });
    mockSpaceSkillService.deleteSkill.mockResolvedValue({
      id: "skill-1",
      slug: "find-skills",
      name: "Find Skills",
    });
    mockSpaceSkillService.auditSkill.mockResolvedValue({
      skillId: "skill-1",
      installedHash: "sha256:abc",
      originHash: "sha256:abc",
      verdict: "pass",
      codes: [],
      findings: [],
      scannedAt: "2026-05-26T00:00:00.000Z",
      scanVersion: "1",
    });
    mockSpaceSkillService.getById.mockResolvedValue({
      id: "skill-1",
      slug: "review",
      sourceRef: "sha256:abc",
      metadata: { originHash: "sha256:abc" },
    });
    mockSpaceSkillService.installUpdate.mockResolvedValue({
      id: "skill-1",
      slug: "review",
      sourceRef: "sha256:def",
      metadata: { originHash: "sha256:def" },
    });
    mockSpaceSkillService.pruneExpiredTestHarnessIssues.mockResolvedValue({ pruned: 0 });
    mockSpaceSkillService.listTestInputs.mockResolvedValue([]);
    mockSpaceSkillService.createTestInput.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      spaceId: "space-1",
      skillId: "skill-1",
      name: "smoke/input",
      content: "Try the skill",
      createdBy: "operator",
      deletedAt: null,
      createdAt: new Date("2026-05-26T00:00:00.000Z"),
      updatedAt: new Date("2026-05-26T00:00:00.000Z"),
    });
    mockSpaceSkillService.updateTestInput.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      spaceId: "space-1",
      skillId: "skill-1",
      name: "smoke/renamed",
      content: "Try the skill again",
      createdBy: "operator",
      deletedAt: null,
      createdAt: new Date("2026-05-26T00:00:00.000Z"),
      updatedAt: new Date("2026-05-26T00:01:00.000Z"),
    });
    mockSpaceSkillService.deleteTestInput.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      spaceId: "space-1",
      skillId: "skill-1",
      name: "smoke/renamed",
      content: "Try the skill again",
      createdBy: "operator",
      deletedAt: new Date("2026-05-26T00:02:00.000Z"),
      createdAt: new Date("2026-05-26T00:00:00.000Z"),
      updatedAt: new Date("2026-05-26T00:02:00.000Z"),
    });
    const templateResponse = {
      id: "66666666-6666-4666-8666-666666666666",
      spaceId: "space-1",
      name: "Custom template",
      description: "Custom run guidance",
      body: "Run {{skillName}} into {{outputDocumentKey}}.",
      builtIn: false,
      createdByAgentId: null,
      createdByUserId: "local-operator",
      updatedByAgentId: null,
      updatedByUserId: "local-operator",
      deletedAt: null,
      createdAt: new Date("2026-05-26T00:00:00.000Z"),
      updatedAt: new Date("2026-05-26T00:00:00.000Z"),
    };
    mockSpaceSkillService.listTestRunTemplates.mockResolvedValue([{
      ...templateResponse,
      id: "built-in:default-test-template",
      name: "Default test template",
      description: "Outpost default",
      body: "Default {{skillName}}",
      builtIn: true,
      createdByUserId: null,
      updatedByUserId: null,
    }, templateResponse]);
    mockSpaceSkillService.createTestRunTemplate.mockResolvedValue(templateResponse);
    mockSpaceSkillService.updateTestRunTemplate.mockResolvedValue({
      ...templateResponse,
      name: "Renamed template",
      updatedAt: new Date("2026-05-26T00:01:00.000Z"),
    });
    mockSpaceSkillService.deleteTestRunTemplate.mockResolvedValue({
      ...templateResponse,
      deletedAt: new Date("2026-05-26T00:02:00.000Z"),
      updatedAt: new Date("2026-05-26T00:02:00.000Z"),
    });
    mockSpaceSkillService.listTestRuns.mockResolvedValue([]);
    mockSpaceSkillService.getTestRunDetail.mockResolvedValue(null);
    mockSpaceSkillService.createTestRun.mockResolvedValue({
      ...createSkillTestRunDetails(),
      createdAt: new Date("2026-05-26T00:00:00.000Z"),
      updatedAt: new Date("2026-05-26T00:00:00.000Z"),
      cost: { costCents: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
      taskExpired: false,
    });
    mockSpaceSkillService.cancelTestRun.mockResolvedValue({
      ...createSkillTestRunDetails({ status: "cancelled", error: "Cancelled by operator" }),
      createdAt: new Date("2026-05-26T00:00:00.000Z"),
      updatedAt: new Date("2026-05-26T00:01:00.000Z"),
      cost: { costCents: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
      taskExpired: false,
    });
    mockIssueService.create.mockResolvedValue({
      id: "44444444-4444-4444-8444-444444444444",
      spaceId: "space-1",
      identifier: "PAP-999",
      title: "Skill test: Review",
    });
    mockIssueService.getById.mockResolvedValue({
      id: "44444444-4444-4444-8444-444444444444",
      spaceId: "space-1",
      status: "in_progress",
      executionRunId: "run-1",
    });
    mockIssueService.update.mockResolvedValue({});
    mockHeartbeatService.wakeup.mockResolvedValue({});
    mockHeartbeatService.cancelRun.mockResolvedValue({});
    mockLogActivity.mockResolvedValue(undefined);
    mockAccessService.canUser.mockResolvedValue(true);
    mockAccessService.decide.mockResolvedValue(allowSkillChangeDecision());
    mockAccessService.hasPermission.mockResolvedValue(false);
    mockSpaceSkillPolicyService.resolveAgentPrincipal.mockImplementation(async (_spaceId, agentId) => ({
      type: "agent",
      id: agentId,
      role: "engineer",
    }));
    mockSpaceSkillPolicyService.evaluate.mockImplementation(async (input) => ({
      allowed: true,
      action: input.action,
      reason: "no_policy_default",
      policyRevision: 0,
      matchedRuleId: null,
      remediation: null,
    }));
    mockReflectionCoachMutationGate.assertConsented.mockResolvedValue(undefined);
  });

  it("replays a concurrent identical save committed after the first receipt lookup", async () => {
    const expectedVersionId = "11111111-1111-4111-8111-111111111111";
    const input = { path: "SKILL.md", content: "# Saved", expectedVersionId };
    const receipt = { skillId: "skill-1", path: "SKILL.md", versionId: "22222222-2222-4222-8222-222222222222", studioPath: "/skills/studio/skill-1" };
    const where = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ details: {
      fingerprint: createHash("sha256").update(JSON.stringify(input)).digest("hex"), receipt,
    } }]);
    const database = { select: () => ({ from: () => ({ where }) }), execute: vi.fn(), transaction: vi.fn() };
    database.transaction.mockImplementation(callback => callback(database));
    mockSpaceSkillService.getById.mockResolvedValue({ id: "skill-1", sourceType: "managed" });
    mockSpaceSkillService.updateFile.mockRejectedValueOnce(Object.assign(new Error("Skill version changed"), { status: 409 }));
    const app = createApp(operatorActor(), undefined, database);
    const response = await request(app).patch("/api/spaces/space-1/skills/skill-1/files")
      .send({ ...input, idempotencyKey: "same-save" }).expect(200);
    expect(response.body).toEqual(receipt);
    expect(database.execute).toHaveBeenCalledOnce();
    expect(where).toHaveBeenCalledTimes(2);
  });

  it("allows local operators to mutate space skills", async () => {
    const res = await request(await createApp(operatorActor()))
      .post("/api/spaces/space-1/skills/import")
      .send({ source: "https://github.com/vercel-labs/agent-browser" });

    expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
    expect(res.body).toEqual({
      imported: [],
      warnings: [],
    });
  });

  it("forwards preview and selective scan-projects requests through the existing skill mutation gate", async () => {
    const workspaceId = "11111111-1111-4111-8111-111111111111";
    mockSpaceSkillService.scanProjectWorkspaces.mockResolvedValue({
      scannedProjects: 1,
      scannedWorkspaces: 1,
      discovered: 1,
      imported: [],
      updated: [],
      skipped: [],
      conflicts: [],
      candidates: [{
        slug: "review",
        name: "Review",
        description: null,
        workspaceId,
        workspaceName: "Primary",
        projectId: "22222222-2222-4222-8222-222222222222",
        projectName: "Outpost",
        directoryRoot: ".codex/skills",
        relativePath: ".codex/skills/review",
        status: "new",
      }],
      warnings: [],
    });
    const app = await createApp(operatorActor());

    const preview = await request(app)
      .post("/api/spaces/space-1/skills/scan-projects")
      .send({ mode: "preview", workspaceIds: [workspaceId] });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.candidates).toHaveLength(1);
    expect(mockSpaceSkillService.scanProjectWorkspaces).toHaveBeenCalledWith("space-1", {
      mode: "preview",
      workspaceIds: [workspaceId],
    });

    const selective = await request(app)
      .post("/api/spaces/space-1/skills/scan-projects")
      .send({
        mode: "import",
        workspaceIds: [workspaceId],
        selection: [{ workspaceId, path: ".codex/skills/review", slug: "review-project" }],
      });
    expect(selective.status, JSON.stringify(selective.body)).toBe(200);
    expect(mockSpaceSkillService.scanProjectWorkspaces).toHaveBeenLastCalledWith("space-1", {
      mode: "import",
      workspaceIds: [workspaceId],
      selection: [{ workspaceId, path: ".codex/skills/review", slug: "review-project" }],
    });
    expect(mockAccessService.decide).toHaveBeenCalledWith(expect.objectContaining({
      action: "skill_config:update",
      resource: { type: "space", spaceId: "space-1" },
    }));
    expect(mockLogActivity).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      action: "space.skills_scanned",
      details: expect.objectContaining({ mode: "import", candidateCount: 1 }),
    }));
  });

  it("blocks unauthorized preview scan-projects requests before candidate data is returned", async () => {
    const workspaceId = "11111111-1111-4111-8111-111111111111";
    mockAccessService.decide.mockResolvedValue(denySkillChangeDecision(
      "deny_actor_restricted",
      "Actor is restricted from changing skill configuration.",
    ));

    const res = await request(await createApp(operatorActor("operator-user", "session")))
      .post("/api/spaces/space-1/skills/scan-projects")
      .send({ mode: "preview", workspaceIds: [workspaceId] });

    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toBe("Actor is restricted from changing skill configuration.");
    expect(mockSpaceSkillService.scanProjectWorkspaces).not.toHaveBeenCalled();
  });

  it("resolves skill slugs in the skillId param to the canonical skill id", async () => {
    const skillId = "22222222-2222-4222-8222-222222222222";
    mockSpaceSkillService.getByRouteRef.mockResolvedValue({ id: skillId, slug: "inbox-triage" });
    const app = await createApp(operatorActor("operator-user", "session"));

    await request(app)
      .post("/api/spaces/space-1/skills/inbox-triage/audit")
      .send({})
      .expect(200);

    expect(mockSpaceSkillService.getByRouteRef).toHaveBeenCalledWith("space-1", "inbox-triage");
    expect(mockSpaceSkillService.auditSkill).toHaveBeenCalledWith("space-1", skillId);
  });

  it("returns 404 when the skillId param does not match any skill", async () => {
    mockSpaceSkillService.getByRouteRef.mockResolvedValue(null);
    const app = await createApp(operatorActor("operator-user", "session"));

    await request(app)
      .post("/api/spaces/space-1/skills/missing-skill/audit")
      .send({})
      .expect(404);

    expect(mockSpaceSkillService.auditSkill).not.toHaveBeenCalled();
  });

  it("allows operator users with skills:create to create, import, update, delete, and audit space skills", async () => {
    const app = await createApp(operatorActor("operator-user", "session"));

    await request(app)
      .post("/api/spaces/space-1/skills")
      .send({ name: "Review", slug: "review", markdown: "# Review" })
      .expect(201);
    await request(app)
      .post("/api/spaces/space-1/skills/import")
      .send({ source: "https://github.com/vercel-labs/agent-browser" })
      .expect(201);
    await request(app)
      .patch("/api/spaces/space-1/skills/skill-1")
      .send({ description: "Updated" })
      .expect(200);
    await request(app)
      .delete("/api/spaces/space-1/skills/skill-1")
      .expect(200);
    await request(app)
      .post("/api/spaces/space-1/skills/skill-1/audit")
      .send({})
      .expect(200);

    expect(mockAccessService.decide).toHaveBeenCalledWith(expect.objectContaining({
      action: "skill_config:update",
      resource: { type: "space", spaceId: "space-1" },
    }));
    expect(mockAccessService.canUser).not.toHaveBeenCalledWith("space-1", "operator-user", "agents:create");
    expect(mockSpaceSkillService.createLocalSkill).toHaveBeenCalled();
    expect(mockSpaceSkillService.importFromSource).toHaveBeenCalled();
    expect(mockSpaceSkillService.updateSkill).toHaveBeenCalled();
    expect(mockSpaceSkillService.deleteSkill).toHaveBeenCalled();
    expect(mockSpaceSkillService.auditSkill).toHaveBeenCalled();
  });

  it("allows operator users without skills:create when no explicit skill policy exists", async () => {
    mockAccessService.decide.mockResolvedValue(denySkillChangeDecision());

    const res = await request(await createApp(operatorActor("operator-user", "session")))
      .post("/api/spaces/space-1/skills/import")
      .send({ source: "https://github.com/vercel-labs/agent-browser" });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockAccessService.decide).toHaveBeenCalledWith(expect.objectContaining({
      action: "skill_config:update",
      resource: { type: "space", spaceId: "space-1" },
    }));
    expect(mockAccessService.canUser).not.toHaveBeenCalledWith("space-1", "operator-user", "agents:create");
    expect(mockSpaceSkillService.importFromSource).toHaveBeenCalled();
  });

  it("returns a structured denial when an explicit skill policy blocks the action", async () => {
    mockAccessService.decide.mockResolvedValue(denySkillChangeDecision());
    mockSpaceSkillPolicyService.evaluate.mockResolvedValue({
      allowed: false,
      action: "skills.import",
      reason: "explicit_rule",
      policyRevision: 4,
      matchedRuleId: "deny-external",
      remediation: "Contact a space administrator to change the skill policy.",
    });

    const res = await request(await createApp(assignedAgentActor()))
      .post("/api/spaces/space-1/skills/import")
      .send({ source: "https://packages.example.com/skill.tgz" });

    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body).toEqual({
      error: "Skill action denied by space policy",
      code: "skill_policy_denied",
      reason: "explicit_rule",
      remediation: "Contact a space administrator to change the skill policy.",
    });
    expect(JSON.stringify(res.body)).not.toContain("deny-external");
    expect(JSON.stringify(res.body)).not.toContain("policyRevision");
    expect(mockSpaceSkillService.importFromSource).not.toHaveBeenCalled();
  });

  it("rejects secret-bearing remote import URLs without echoing the secret", async () => {
    const source = "https://github.com/acme/private-skill?token=secret#token=secret";

    const res = await request(await createApp(operatorActor()))
      .post("/api/spaces/space-1/skills/import")
      .send({ source });

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body).toEqual({
      error: "Remote skill source URLs cannot include credentials, query parameters, or fragments.",
    });
    expect(JSON.stringify(res.body)).not.toContain("secret");
    expect(mockSpaceSkillPolicyService.evaluate).not.toHaveBeenCalled();
    expect(mockSpaceSkillService.importFromSource).not.toHaveBeenCalled();
  });

  it("rejects malformed remote import URLs before policy evaluation", async () => {
    const res = await request(await createApp(operatorActor()))
      .post("/api/spaces/space-1/skills/import")
      .send({ source: "https://" });

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body).toEqual({
      error: "Invalid remote skill source URL.",
    });
    expect(mockSpaceSkillPolicyService.evaluate).not.toHaveBeenCalled();
    expect(mockSpaceSkillService.importFromSource).not.toHaveBeenCalled();
  });

  it("keeps platform actor restrictions separate from optional policy denials", async () => {
    mockAccessService.decide.mockResolvedValue(denySkillChangeDecision(
      "deny_low_trust_boundary",
      "Low-trust agents cannot use space-wide skill APIs.",
    ));

    const res = await request(await createApp(assignedAgentActor()))
      .post("/api/spaces/space-1/skills/import")
      .send({ source: "https://github.com/vercel-labs/agent-browser" });

    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body).toMatchObject({
      code: "skill_actor_restricted",
      details: { reason: "platform_invariant" },
    });
    expect(mockSpaceSkillPolicyService.evaluate).not.toHaveBeenCalled();
  });

  it("blocks shorthand GitHub imports when policy denies the canonical git source locator", async () => {
    mockAccessService.decide.mockResolvedValue(denySkillChangeDecision());
    mockSpaceSkillPolicyService.evaluate.mockImplementation(async (input: { resource?: { sourceType?: string; sourceLocator?: string } }) => {
      const resource = input.resource ?? {};
      return resource.sourceType === "git" && resource.sourceLocator === "https://github.com/vercel-labs/agent-browser"
        ? denySkillPolicy("skills.import")
        : {
          allowed: true,
          action: "skills.import",
          reason: "policy_default",
          policyRevision: 1,
          matchedRuleId: null,
          remediation: null,
        };
    });

    const res = await request(await createApp(operatorActor("operator-user", "session")))
      .post("/api/spaces/space-1/skills/import")
      .send({ source: "vercel-labs/agent-browser" });

    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toBe("Skill action denied by space policy");
    expect(mockSpaceSkillPolicyService.evaluate).toHaveBeenCalledWith(expect.objectContaining({
      spaceId: "space-1",
      action: "skills.import",
      resource: expect.objectContaining({
        sourceType: "git",
        sourceLocator: "https://github.com/vercel-labs/agent-browser",
      }),
    }));
    expect(mockSpaceSkillService.importFromSource).not.toHaveBeenCalled();
  });

  it("normalizes stored GitHub locators before evaluating mutation policy", async () => {
    mockAccessService.decide.mockResolvedValue(denySkillChangeDecision());
    mockSpaceSkillService.getById.mockResolvedValue({
      id: "skill-1",
      key: "space/space-1/review",
      sourceType: "github",
      sourceLocator: "https://WWW.GitHub.com/Acme/Review.git",
    });
    mockSpaceSkillPolicyService.evaluate.mockImplementation(async (input: { resource?: { sourceLocator?: string } }) => (
      input.resource?.sourceLocator === "https://github.com/acme/review"
        ? denySkillPolicy("skills.edit")
        : {
          allowed: true,
          action: "skills.edit",
          reason: "policy_default",
          policyRevision: 1,
          matchedRuleId: null,
          remediation: null,
        }
    ));

    const res = await request(await createApp(operatorActor("operator-user", "session")))
      .patch("/api/spaces/space-1/skills/skill-1")
      .send({ name: "Updated review" });

    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(mockSpaceSkillPolicyService.evaluate).toHaveBeenCalledWith(expect.objectContaining({
      action: "skills.edit",
      resource: expect.objectContaining({
        sourceType: "git",
        sourceLocator: "https://github.com/acme/review",
      }),
    }));
    expect(mockSpaceSkillService.updateSkill).not.toHaveBeenCalled();
  });

  it("evaluates skill version creation with the skills.create policy action", async () => {
    mockAccessService.decide.mockResolvedValue(denySkillChangeDecision());
    mockSpaceSkillService.getById.mockResolvedValue({
      id: "skill-1",
      key: "space/space-1/review",
      sourceType: "github",
      sourceLocator: "https://github.com/acme/review",
    });
    mockSpaceSkillPolicyService.evaluate.mockResolvedValue(denySkillPolicy("skills.create"));

    const res = await request(await createApp(operatorActor("operator-user", "session")))
      .post("/api/spaces/space-1/skills/skill-1/versions")
      .send({ label: "v1" });

    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(mockSpaceSkillPolicyService.evaluate).toHaveBeenCalledWith(expect.objectContaining({
      action: "skills.create",
      spaceId: "space-1",
      resource: expect.objectContaining({
        skillId: "skill-1",
      }),
    }));
    expect(mockSpaceSkillService.createVersion).not.toHaveBeenCalled();
  });

  it("blocks npx skills add imports when policy denies the canonical git source locator", async () => {
    mockAccessService.decide.mockResolvedValue(denySkillChangeDecision());
    mockSpaceSkillPolicyService.evaluate.mockImplementation(async (input: { resource?: { sourceType?: string; sourceLocator?: string } }) => {
      const resource = input.resource ?? {};
      return resource.sourceType === "git" && resource.sourceLocator === "https://github.com/vercel-labs/agent-browser"
        ? denySkillPolicy("skills.import")
        : {
          allowed: true,
          action: "skills.import",
          reason: "policy_default",
          policyRevision: 1,
          matchedRuleId: null,
          remediation: null,
        };
    });

    const res = await request(await createApp(operatorActor("operator-user", "session")))
      .post("/api/spaces/space-1/skills/import")
      .send({ source: "npx skills add Vercel-Labs/Agent-Browser --skill agent-browser -g" });

    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toBe("Skill action denied by space policy");
    expect(mockSpaceSkillPolicyService.evaluate).toHaveBeenCalledWith(expect.objectContaining({
      spaceId: "space-1",
      action: "skills.import",
      resource: expect.objectContaining({
        sourceType: "git",
        sourceLocator: "https://github.com/vercel-labs/agent-browser",
      }),
    }));
    expect(mockSpaceSkillService.importFromSource).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "tree directory",
      source: "https://github.com/Vercel-Labs/Agent-Browser/tree/main/skills/Upper.MD",
      sourceLocator: "https://github.com/vercel-labs/agent-browser/tree/main/skills/Upper.MD",
    },
    {
      label: "blob file",
      source: "https://github.com/Vercel-Labs/Agent-Browser/blob/main/skills/Upper/SKILL.MD",
      sourceLocator: "https://github.com/vercel-labs/agent-browser/blob/main/skills/Upper/SKILL.MD",
    },
  ])("blocks uppercase .MD GitHub $label imports when policy denies the canonical git source locator", async ({ source, sourceLocator }) => {
    mockAccessService.decide.mockResolvedValue(denySkillChangeDecision());
    mockSpaceSkillPolicyService.evaluate.mockImplementation(async (input: { resource?: { sourceType?: string; sourceLocator?: string } }) => {
      const resource = input.resource ?? {};
      return resource.sourceType === "git" && resource.sourceLocator === sourceLocator
        ? denySkillPolicy("skills.import")
        : {
          allowed: true,
          action: "skills.import",
          reason: "policy_default",
          policyRevision: 1,
          matchedRuleId: null,
          remediation: null,
        };
    });

    const res = await request(await createApp(operatorActor("operator-user", "session")))
      .post("/api/spaces/space-1/skills/import")
      .send({ source });

    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toBe("Skill action denied by space policy");
    expect(mockSpaceSkillPolicyService.evaluate).toHaveBeenCalledWith(expect.objectContaining({
      spaceId: "space-1",
      action: "skills.import",
      resource: expect.objectContaining({
        sourceType: "git",
        sourceLocator,
      }),
    }));
    expect(mockSpaceSkillService.importFromSource).not.toHaveBeenCalled();
  });



  it("rejects unauthenticated skill imports before parsing source details", async () => {
    const app = await createApp({ type: "none" });

    const res = await request(app)
      .post("/api/spaces/space-1/skills/import")
      .send({ source: "https://github.com/acme/private-skill?token=secret#token=secret" });

    expect(res.status, JSON.stringify(res.body)).toBe(401);
    expect(res.body).toEqual({ error: "Authentication required" });
    expect(JSON.stringify(res.body)).not.toContain("secret");
    expect(mockAccessService.decide).not.toHaveBeenCalled();
    expect(mockSpaceSkillPolicyService.evaluate).not.toHaveBeenCalled();
    expect(mockSpaceSkillService.importFromSource).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated skill edits before loading stored policy resources", async () => {
    const app = await createApp({ type: "none" });

    const res = await request(app)
      .patch("/api/spaces/space-1/skills/skill-1")
      .send({ description: "Updated" });

    expect(res.status, JSON.stringify(res.body)).toBe(401);
    expect(res.body).toEqual({ error: "Authentication required" });
    expect(mockSpaceSkillService.getById).not.toHaveBeenCalled();
    expect(mockSpaceSkillPolicyService.evaluate).not.toHaveBeenCalled();
    expect(mockSpaceSkillService.updateSkill).not.toHaveBeenCalled();
  });



  it("tracks public GitHub skill imports with an explicit skill reference", async () => {
    mockSpaceSkillService.importFromSource.mockResolvedValue({
      imported: [
        {
          id: "skill-1",
          spaceId: "space-1",
          key: "vercel-labs/agent-browser/find-skills",
          slug: "find-skills",
          name: "Find Skills",
          description: null,
          markdown: "# Find Skills",
          sourceType: "github",
          sourceLocator: "https://github.com/vercel-labs/agent-browser",
          sourceRef: null,
          trustLevel: "markdown_only",
          compatibility: "compatible",
          fileInventory: [],
          metadata: {
            hostname: "github.com",
            owner: "vercel-labs",
            repo: "agent-browser",
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      warnings: [],
    });

    const res = await request(await createApp(operatorActor()))
      .post("/api/spaces/space-1/skills/import")
      .send({ source: "https://github.com/vercel-labs/agent-browser" });

    expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
    expect(mockTrackSkillImported).toHaveBeenCalledWith(expect.anything(), {
      sourceType: "github",
      skillRef: "vercel-labs/agent-browser/find-skills",
    });
  });

  it.each(["responsible-person", "local-operator"])("does not persist API-key refresh authority from %s", async (onBehalfOfUserId) => {
    const agent = { ...assignedAgentActor(), source: "agent_key", runId: undefined, onBehalfOfUserId,
      onBehalfOfMemberships: [{ spaceId: "space-1", membershipRole: "member", status: "active" }] };
    const response = await request(createApp(agent)).post("/api/spaces/space-1/skills/import")
      .send({ source: "https://github.com/acme/public-skills" });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(mockSkillSourceService.importFromUrl).toHaveBeenCalledWith("space-1", expect.anything(),
      expect.objectContaining({ setup: { userId: null, agentId: agent.agentId, localTrusted: false } }));
  });

  it("derives refresh authority from the authenticated run instead of caller responsibility", async () => {
    const agent = { ...assignedAgentActor(), source: "agent_jwt", onBehalfOfUserId: "unverified-person",
      onBehalfOfMemberships: [{ spaceId: "space-1", membershipRole: "member", status: "active" }] };
    const response = await request(createApp(agent)).post("/api/spaces/space-1/skills/import")
      .send({ source: "https://github.com/acme/public-skills" });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(mockCaptureRunIdentity).toHaveBeenCalledWith(expect.anything(), { spaceId: "space-1", agentId: agent.agentId, runId: "run-1" }, { readScope: "identity" });
    expect(mockSkillSourceService.importFromUrl).toHaveBeenCalledWith("space-1", expect.anything(),
      expect.objectContaining({ setup: { userId: "validated-owner", agentId: agent.agentId, localTrusted: false } }));
  });

  it("rejects a run-authenticated import without a run identity", async () => {
    await request(createApp({ ...assignedAgentActor(), source: "agent_jwt", runId: undefined }))
      .post("/api/spaces/space-1/skills/import").send({ source: "https://github.com/acme/public-skills" }).expect(403);
    expect(mockSkillSourceService.importFromUrl).not.toHaveBeenCalled();
  });

  it('streams discovery updates and a final result while retaining JSON compatibility', async () => {
    const result = { candidates: [], commitSha: 'a'.repeat(40) };
    mockSkillSourceService.discover.mockImplementation(async (_input, _context, options) => {
      await options?.onProgress({ type: 'progress', phase: 'listing', totalSkills: null, checkedSkills: 0, currentPath: null, checkedFiles: 0, totalFiles: null });
      return result;
    });
    const app = createApp({ type: 'operator', userId: 'operator', spaceIds: ['space-1'], source: 'local_implicit' });
    const base = '/api/spaces/space-1/skill-sources/discover';
    const stream = await request(app).post(base).set('Accept', 'application/x-ndjson').send({ repositoryUrl: 'https://github.com/acme/skills' }).expect(200);
    expect(stream.headers['content-type']).toContain('application/x-ndjson');
    expect(stream.headers['cache-control']).toBe('no-cache, no-transform');
    expect(stream.text.trim().split('\n').map((line: string) => JSON.parse(line))).toEqual([
      expect.objectContaining({ type: 'progress', phase: 'listing' }), { type: 'complete', discovery: result },
    ]);
    const json = await request(app).post(base).send({ repositoryUrl: 'https://github.com/acme/skills' }).expect(200);
    expect(json.body).toEqual(result);
  });
  it('terminates failed streams with an error instead of a complete or partial discovery', async () => {
    mockSkillSourceService.discover.mockImplementation(async (_input, _context, options) => {
      await options.onProgress({ type: 'progress', phase: 'listing' });
      throw new Error('Internal credential detail must not leak');
    });
    const res = await request(createApp({ type: 'operator', userId: 'operator', spaceIds: ['space-1'], source: 'local_implicit' }))
      .post('/api/spaces/space-1/skill-sources/discover').set('Accept', 'application/x-ndjson').send({ repositoryUrl: 'https://github.com/acme/skills' }).expect(200);
    const events = res.text.trim().split('\n').map((line: string) => JSON.parse(line));
    expect(events.at(-1)).toEqual({ type: 'error', error: 'Repository scan interrupted. Try again.', status: 500 });
    expect(events.some((event: { type: string }) => event.type === 'complete')).toBe(false);
    expect(res.text).not.toContain('credential detail');
  });
  it('aborts discovery and closes a connected client whose progress stream never drains', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let response: express.Response | undefined;
    let signal: AbortSignal | undefined;
    const write = vi.fn(() => false);
    mockSkillSourceService.discover.mockImplementation(async (_input, _context, options) => {
      signal = options.signal;
      await options.onProgress({ type: 'progress', phase: 'downloading' });
      throw new Error('A stalled scan must abort before continuing');
    });
    try {
      const app = createApp({ type: 'operator', userId: 'operator', spaceIds: ['space-1'], source: 'local_implicit' }, res => {
        response = res;
        res.write = write;
      });
      const pending = request(app).post('/api/spaces/space-1/skill-sources/discover')
        .set('Accept', 'application/x-ndjson').send({ repositoryUrl: 'https://github.com/acme/skills' })
        .then(() => null, error => error);
      await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await pending).toBeTruthy();
      expect(signal?.aborted).toBe(true);
      expect(response?.destroyed).toBe(true);
      expect(response?.listenerCount('drain')).toBe(0);
      expect(write).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      response?.destroy();
    }
  });

  it("requires an explicit skill disposition and revision when removing a source", async () => {
    const app = createApp({ type: "operator", userId: "member", spaceIds: ["space-1"], source: "session" });
    const path = "/api/spaces/space-1/skill-sources/source-id";
    for (const body of [{}, { revision: 0 }, { skills: "delete" }, { revision: 0, skills: "ignore" }]) {
      await request(app).delete(path).send(body).expect(400);
    }
  });

  it('lists authorized source branches with a validated connection override', async () => {
    const app = createApp({ type: 'operator', userId: 'member', spaceIds: ['space-1'], source: 'session' });
    const connectionId = '00000000-0000-4000-8000-000000000042';
    const data = { defaultBranch: 'master', branches: [{ name: 'master', isDefault: true }], truncated: false };
    mockSkillSourceService.branches.mockResolvedValue(data);
    const path = '/api/spaces/space-1/skill-sources/source-id/branches';
    expect((await request(app).get(path).query({ connectionId }).expect(200)).body).toEqual(data);
    expect(mockSkillSourceService.branches).toHaveBeenCalledWith('space-1', 'source-id', { connectionId }, expect.objectContaining({ read: expect.any(Function) }), expect.any(AbortSignal));
    await request(app).get(path).query({ connectionId: 'invalid' }).expect(400);
  });

  it("rejects cross-space source reads and mutations for operator users and agents", async () => {
    for (const actor of [
      { type: "operator", userId: "member", spaceIds: ["space-1"], isInstanceAdmin: true, source: "session" },
      { type: "agent", agentId: "agent-1", spaceId: "space-1" },
    ]) {
      const app = createApp(actor);
      const base = "/api/spaces/space-2/skill-sources";
      const responses = await Promise.all([
        request(app).get(base), request(app).get(`${base}/repositories`), request(app).get(`${base}/source-id`), request(app).get(`${base}/source-id/branches`),
        request(app).post(`${base}/discover`).send({ repositoryUrl: "https://github.com/acme/skills" }),
        request(app).post(`${base}/discover`).set('Accept', 'application/x-ndjson').send({ repositoryUrl: "https://github.com/acme/skills" }),
        request(app).post(`${base}/preview`).send({ repositoryUrl: "https://github.com/acme/skills", commitSha: "a".repeat(40), skillPath: "SKILL.md", filePath: "SKILL.md" }),
        request(app).post(base).send({ repositoryUrl: "https://github.com/acme/skills", commitSha: "a".repeat(40), selectedPaths: [] }),
        request(app).patch(`${base}/source-id`).send({ revision: 0, selectedPaths: [], excludedFolders: [] }),
        request(app).post(`${base}/source-id/refresh`), request(app).delete(`${base}/source-id`),
      ]);
      for (const response of responses) expect(response.status).toBe(403);
    }
    expect(mockSpaceSkillService.importFromSource).not.toHaveBeenCalled();
  });

  it("omits source-managed repository identities from import telemetry", async () => {
    mockSpaceSkillService.importFromSource.mockResolvedValue({ imported: [{
      sourceType: "github", key: "github/private-repo/private-skill-name", slug: "private-skill-name",
      metadata: { hostname: "github.com", skillSourceId: "source-1" },
    }], warnings: [] });
    await request(createApp({ type: "operator", userId: "local-operator", spaceIds: ["space-1"], source: "local_implicit" }))
      .post("/api/spaces/space-1/skills/import").send({ source: "https://github.com/acme/private" }).expect(201);
    expect(mockTrackSkillImported).toHaveBeenCalledWith(expect.anything(), { sourceType: "github", skillRef: null });
  });

  it("does not expose a skill reference for non-public skill imports", async () => {
    mockSpaceSkillService.importFromSource.mockResolvedValue({
      imported: [
        {
          id: "skill-1",
          spaceId: "space-1",
          key: "private-skill",
          slug: "private-skill",
          name: "Private Skill",
          description: null,
          markdown: "# Private Skill",
          sourceType: "github",
          sourceLocator: "https://ghe.example.com/acme/private-skill",
          sourceRef: null,
          trustLevel: "markdown_only",
          compatibility: "compatible",
          fileInventory: [],
          metadata: {
            hostname: "ghe.example.com",
            owner: "acme",
            repo: "private-skill",
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      warnings: [],
    });

    const res = await request(await createApp(operatorActor()))
      .post("/api/spaces/space-1/skills/import")
      .send({ source: "https://ghe.example.com/acme/private-skill" });

    expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
    expect(mockTrackSkillImported).toHaveBeenCalledWith(expect.anything(), {
      sourceType: "github",
      skillRef: null,
    });
  });

  it("does not expose a skill reference when GitHub metadata is missing", async () => {
    mockSpaceSkillService.importFromSource.mockResolvedValue({
      imported: [
        {
          id: "skill-1",
          spaceId: "space-1",
          key: "unknown/private-skill",
          slug: "private-skill",
          name: "Private Skill",
          description: null,
          markdown: "# Private Skill",
          sourceType: "github",
          sourceLocator: "https://github.com/acme/private-skill",
          sourceRef: null,
          trustLevel: "markdown_only",
          compatibility: "compatible",
          fileInventory: [],
          metadata: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
      warnings: [],
    });

    const res = await request(await createApp(operatorActor()))
      .post("/api/spaces/space-1/skills/import")
      .send({ source: "https://github.com/acme/private-skill" });

    expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
    expect(mockTrackSkillImported).toHaveBeenCalledWith(expect.anything(), {
      sourceType: "github",
      skillRef: null,
    });
  });

  it("allows same-space agents without skill change grants when no explicit policy exists", async () => {
    mockAccessService.decide.mockResolvedValue(denySkillChangeDecision());
    mockAgentService.getById.mockResolvedValue({
      id: "55555555-5555-4555-8555-555555555555",
      spaceId: "space-1",
      permissions: { canCreateSkills: false },
    });

    const res = await request(await createApp(assignedAgentActor()))
      .post("/api/spaces/space-1/skills/import")
      .send({ source: "https://github.com/vercel-labs/agent-browser" });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockAccessService.decide).toHaveBeenCalledWith(expect.objectContaining({
      action: "skill_config:update",
      resource: { type: "space", spaceId: "space-1" },
    }));
    expect(mockAccessService.hasPermission).not.toHaveBeenCalledWith("space-1", "agent", "55555555-5555-4555-8555-555555555555", "agents:create");
    expect(mockSpaceSkillService.importFromSource).toHaveBeenCalled();
  });


  it("passes store list filters and category count requests to the service", async () => {
    const app = await createApp({ type: "operator", source: "local_implicit" });

    await request(app)
      .get("/api/spaces/space-1/skills?sort=stars&categories[]=memory&category=git&scope=space&q=review&include=lastEditor")
      .expect(200);
    expect(mockSpaceSkillService.list).toHaveBeenCalledWith("space-1", {
      q: "review",
      sort: "stars",
      categories: ["git", "memory"],
      scope: "space",
      include: ["lastEditor"],
    });

    await request(app).get("/api/spaces/space-1/skills/categories").expect(200);
    expect(mockSpaceSkillService.categoryCounts).toHaveBeenCalledWith("space-1");
  });

  it("accepts category updates and logs the skill mutation", async () => {
    const app = await createApp({ type: "operator", source: "local_implicit", userId: "user-1" });

    const res = await request(app)
      .patch("/api/spaces/space-1/skills/skill-1")
      .send({ categories: ["memory", "review"], sharingScope: "space" })
      .expect(200);

    expect(res.body).toMatchObject({
      id: "skill-1",
      categories: ["memory", "review"],
      sharingScope: "space",
    });
    expect(mockSpaceSkillService.updateSkill).toHaveBeenCalledWith("space-1", "skill-1", {
      categories: ["memory", "review"],
      sharingScope: "space",
    });
    expect(mockLogActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      spaceId: "space-1",
      actorType: "user",
      actorId: "user-1",
      action: "space.skill_updated",
      entityType: "space_skill",
      entityId: "skill-1",
      details: {
        slug: "review",
        categories: ["memory", "review"],
        sharingScope: "space",
      },
    }));
  });

  it("creates skill versions and logs the mutation", async () => {
    const app = await createApp({ type: "operator", source: "local_implicit", userId: "user-1" });

    await request(app)
      .post("/api/spaces/space-1/skills/skill-1/versions")
      .send({ label: "v1" })
      .expect(201);

    expect(mockSpaceSkillService.createVersion).toHaveBeenCalledWith("space-1", "skill-1", { label: "v1" }, {
      type: "user",
      userId: "user-1",
   }, { publication: expect.objectContaining({ validate: expect.any(Function), afterPublish: expect.any(Function) }) });
    expect(mockLogActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "space.skill_version_created",
      entityType: "space_skill_version",
      entityId: "version-1",
    }));
  });

  it("deletes skill files and logs the mutation", async () => {
    const app = await createApp({ type: "operator", source: "local_implicit", userId: "user-1" });

    const res = await request(app)
      .delete("/api/spaces/space-1/skills/skill-1/files")
      .send({ path: "references", target: "folder" });

    expect(res.status, JSON.stringify(res.body)).toBe(200);

    expect(mockSpaceSkillService.deleteFile).toHaveBeenCalledWith("space-1", "skill-1", {
      path: "references",
      target: "folder",
    }, {
      type: "user",
      userId: "user-1",
   }, expect.objectContaining({ validate: expect.any(Function), afterPublish: expect.any(Function) }));
    expect(mockLogActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "space.skill_file_deleted",
      entityType: "space_skill",
      entityId: "skill-1",
      details: {
        path: "references",
        target: "folder",
        deletedPaths: ["references/example.md"],
      },
    }));
  });

  it("stars, forks, and comments on skills through space-scoped endpoints", async () => {
    const app = await createApp({ type: "operator", source: "local_implicit", userId: "user-1" });

    await request(app).post("/api/spaces/space-1/skills/skill-1/star").send({}).expect(200);
    expect(mockSpaceSkillService.starSkill).toHaveBeenCalledWith("space-1", "skill-1", {
      type: "user",
      userId: "user-1",
    });

    const forkRes = await request(app)
      .post("/api/spaces/space-1/skills/skill-1/fork")
      .send({ slug: "review-fork", reassignAgentIds: ["11111111-1111-4111-8111-111111111111"] })
      .expect(201);
    expect(forkRes.body).toMatchObject({
      skill: { id: "skill-fork", slug: "review-fork" },
      original: { id: "skill-1", slug: "review" },
      reassignments: [],
    });
    expect(mockSpaceSkillService.forkSkill).toHaveBeenCalledWith(
      "space-1",
      "skill-1",
      { slug: "review-fork", reassignAgentIds: ["11111111-1111-4111-8111-111111111111"] },
      {
        type: "user",
        userId: "user-1",
      },
      expect.objectContaining({ validate: expect.any(Function), afterPublish: expect.any(Function) }),
    );

    await request(app).get("/api/spaces/space-1/skills/skill-1/fork-precheck").expect(200);
    expect(mockSpaceSkillService.forkPrecheck).toHaveBeenCalledWith("space-1", "skill-1", {
      type: "user",
      userId: "user-1",
    });

    await request(app).post("/api/spaces/space-1/skills/skill-1/comments").send({ body: "Looks good" }).expect(201);
    expect(mockSpaceSkillService.createComment).toHaveBeenCalledWith("space-1", "skill-1", { body: "Looks good" }, {
      type: "user",
      userId: "user-1",
    });

    expect(mockLogActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "space.skill_starred",
      entityId: "skill-1",
    }));
    expect(mockLogActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "space.skill_forked",
      entityId: "skill-fork",
    }));
    expect(mockLogActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "space.skill_comment_created",
      entityId: "comment-1",
    }));
  });

  it("renames a skill and logs the rename activity", async () => {
    const app = await createApp({ type: "operator", source: "local_implicit", userId: "user-1" });

    const res = await request(app)
      .post("/api/spaces/space-1/skills/skill-1/rename")
      .send({ name: "Ship PR", slug: "ship-pr" })
      .expect(200);

    expect(res.body).toMatchObject({
      skill: { id: "skill-1", name: "Ship PR", slug: "ship-pr", key: "space/space-1/ship-pr" },
      previousName: "Review",
      previousSlug: "review",
      previousKey: "space/space-1/review",
    });
    expect(mockSpaceSkillService.renameSkill).toHaveBeenCalledWith(
      "space-1",
      "skill-1",
      { name: "Ship PR", slug: "ship-pr" },
      expect.objectContaining({ validate: expect.any(Function), afterPublish: expect.any(Function) }),
    );
    expect(mockLogActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "space.skill_renamed",
      entityType: "space_skill",
      entityId: "skill-1",
      details: expect.objectContaining({
        previousSlug: "review",
        slug: "ship-pr",
        reassignedAgentIds: ["11111111-1111-4111-8111-111111111111"],
      }),
    }));
  });

  it("does not log rename activity for a normalized no-op", async () => {
    mockSpaceSkillService.renameSkill.mockResolvedValueOnce({
      skill: {
        id: "skill-1",
        name: "Review",
        slug: "review",
        key: "space/space-1/review",
      },
      previousName: "Review",
      previousSlug: "review",
      previousKey: "space/space-1/review",
      reassignments: [],
    });
    const app = await createApp({ type: "operator", source: "local_implicit", userId: "user-1" });

    await request(app)
      .post("/api/spaces/space-1/skills/skill-1/rename")
      .send({ name: "Review", slug: "review" })
      .expect(200);

    expect(mockLogActivity).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "space.skill_renamed",
    }));
  });

  it("attributes rename activity to the calling agent API key", async () => {
    const app = await createApp({
      type: "agent",
      agentId: "55555555-5555-4555-8555-555555555555",
      spaceId: "space-1",
      runId: "run-1",
      keyId: "agent-key-1",
      source: "agent_key",
    });

    await request(app)
      .post("/api/spaces/space-1/skills/skill-1/rename")
      .send({ name: "Ship PR", slug: "ship-pr" })
      .expect(200);

    expect(mockLogActivity).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "space.skill_renamed",
      actorType: "agent",
      agentId: "55555555-5555-4555-8555-555555555555",
      runId: "run-1",
      agentApiKeyId: "agent-key-1",
    }));
  });

  it("rejects a rename request with a missing name", async () => {
    const app = await createApp({ type: "operator", source: "local_implicit", userId: "user-1" });

    await request(app)
      .post("/api/spaces/space-1/skills/skill-1/rename")
      .send({ slug: "ship-pr" })
      .expect(400);
    expect(mockSpaceSkillService.renameSkill).not.toHaveBeenCalled();
  });

  it("rejects a rename request with a multiline name", async () => {
    const app = await createApp({ type: "operator", source: "local_implicit", userId: "user-1" });

    await request(app)
      .post("/api/spaces/space-1/skills/skill-1/rename")
      .send({ name: "Ship PR\nslug: injected" })
      .expect(400);
    expect(mockSpaceSkillService.renameSkill).not.toHaveBeenCalled();
  });

  it("does not synthesize a shared operator user id for operator actors without user ids", async () => {
    const app = await createApp({ type: "operator", source: "local_implicit" });

    await request(app).post("/api/spaces/space-1/skills/skill-1/star").send({}).expect(200);

    expect(mockSpaceSkillService.starSkill).toHaveBeenCalledWith("space-1", "skill-1", {
      type: "user",
      userId: null,
    });
  });

  it("allows agents with direct skills:create grants to mutate space skills", async () => {
    mockAccessService.decide.mockResolvedValue(allowSkillChangeDecision("allow_direct_change"));
    mockAgentService.getById.mockResolvedValue({
      id: "55555555-5555-4555-8555-555555555555",
      spaceId: "space-1",
      permissions: { canCreateSkills: false },
    });

    const res = await request(await createApp(assignedAgentActor()))
      .post("/api/spaces/space-1/skills/import")
      .send({ source: "https://github.com/vercel-labs/agent-browser" });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockAccessService.decide).toHaveBeenCalledWith(expect.objectContaining({
      action: "skill_config:update",
      resource: { type: "space", spaceId: "space-1" },
    }));
    expect(mockReflectionCoachMutationGate.assertConsented).not.toHaveBeenCalled();
    expect(mockSpaceSkillService.importFromSource).toHaveBeenCalledWith(
      "space-1",
      "https://github.com/vercel-labs/agent-browser",
    );
  });

  it("does not require consent for suggest-tier skill mutations under the open default", async () => {
    const { forbidden } = await import("../errors.js");
    mockAccessService.decide.mockResolvedValue(denySkillChangeDecision(
      "deny_missing_consent",
      "Permission skills:suggest-changes requires accepted change consent before applying this mutation.",
    ));
    mockReflectionCoachMutationGate.assertConsented.mockRejectedValue(forbidden("gate required", {
      code: "reflection_coach_mutation_gate_required",
    }));

    const res = await request(await createApp({
      type: "agent",
      agentId: "reflection-coach",
      spaceId: "space-1",
      runId: "run-apply",
    }))
      .post("/api/spaces/space-1/skills")
      .send({ name: "Reflection Draft", slug: "reflection-draft", markdown: "# Draft" });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockReflectionCoachMutationGate.assertConsented).not.toHaveBeenCalled();
    expect(mockSpaceSkillService.createLocalSkill).toHaveBeenCalled();
  });



  it("allows suggest-tier skill mutations without a second consent decision", async () => {
    mockAccessService.decide
      .mockResolvedValueOnce(denySkillChangeDecision(
        "deny_missing_consent",
        "Permission skills:suggest-changes requires accepted change consent before applying this mutation.",
      ))
      .mockResolvedValueOnce(allowSkillChangeDecision("allow_consented_change"));
    mockAgentService.getById.mockResolvedValue({
      id: "55555555-5555-4555-8555-555555555555",
      spaceId: "space-1",
      permissions: {},
    });

    const res = await request(await createApp(assignedAgentActor()))
      .post("/api/spaces/space-1/skills/import")
      .send({ source: "https://github.com/vercel-labs/agent-browser" });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockReflectionCoachMutationGate.assertConsented).not.toHaveBeenCalled();
    expect(mockAccessService.decide).toHaveBeenCalledTimes(1);
    expect(mockSpaceSkillService.importFromSource).toHaveBeenCalledWith(
      "space-1",
      "https://github.com/vercel-labs/agent-browser",
    );
  });

  it("allows same-space agents without either legacy skill grant", async () => {
    mockAccessService.decide.mockResolvedValue(denySkillChangeDecision());
    mockAgentService.getById.mockResolvedValue({
      id: "55555555-5555-4555-8555-555555555555",
      spaceId: "space-1",
      permissions: {},
    });

    const res = await request(await createApp(assignedAgentActor()))
      .post("/api/spaces/space-1/skills/import")
      .send({ source: "https://github.com/vercel-labs/agent-browser" });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockAccessService.decide).toHaveBeenCalledWith(expect.objectContaining({
      action: "skill_config:update",
      resource: { type: "space", spaceId: "space-1" },
    }));
    expect(mockSpaceSkillService.importFromSource).toHaveBeenCalled();
  });

  it("does not require unrelated agents:create grants for open-default skill mutations", async () => {
    mockAccessService.decide.mockResolvedValue(denySkillChangeDecision());
    mockAgentService.getById.mockResolvedValue({
      id: "agent-1",
      spaceId: "space-1",
      permissions: { canCreateSkills: false },
    });
    mockAccessService.hasPermission.mockImplementation(async (
      _spaceId: string,
      _principalType: string,
      _principalId: string,
      key: string,
    ) => key === "agents:create");

    const res = await request(await createApp({
      type: "agent",
      agentId: "agent-1",
      spaceId: "space-1",
      runId: "run-1",
    }))
      .post("/api/spaces/space-1/skills/import")
      .send({ source: "https://github.com/vercel-labs/agent-browser" });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockAccessService.decide).toHaveBeenCalledWith(expect.objectContaining({
      action: "skill_config:update",
      resource: { type: "space", spaceId: "space-1" },
    }));
    expect(mockAccessService.hasPermission).not.toHaveBeenCalledWith("space-1", "agent", "agent-1", "agents:create");
    expect(mockSpaceSkillService.importFromSource).toHaveBeenCalled();
  });

  it("routes skill test input CRUD through skills mutation permissions", async () => {
    const app = await createApp(operatorActor());

    const created = await request(app)
      .post("/api/spaces/space-1/skills/skill-1/test-inputs")
      .send({ name: "smoke/input", content: "Try the skill" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(mockSpaceSkillService.createTestInput).toHaveBeenCalledWith(
      "space-1",
      "skill-1",
      { name: "smoke/input", content: "Try the skill" },
      { type: "user", userId: "local-operator" },
    );

    const updated = await request(app)
      .patch("/api/spaces/space-1/skills/skill-1/test-inputs/11111111-1111-4111-8111-111111111111")
      .send({ name: "smoke/renamed", content: "Try the skill again" });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    expect(mockSpaceSkillService.updateTestInput).toHaveBeenCalledWith(
      "space-1",
      "skill-1",
      "11111111-1111-4111-8111-111111111111",
      { name: "smoke/renamed", content: "Try the skill again" },
    );

    const removed = await request(app)
      .delete("/api/spaces/space-1/skills/skill-1/test-inputs/11111111-1111-4111-8111-111111111111");
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    expect(mockSpaceSkillService.deleteTestInput).toHaveBeenCalledWith(
      "space-1",
      "skill-1",
      "11111111-1111-4111-8111-111111111111",
    );
  });

  it("routes skill test run template CRUD through skills mutation permissions", async () => {
    const app = await createApp(operatorActor());

    const listed = await request(app).get("/api/spaces/space-1/skill-test-run-templates");
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);
    expect(mockSpaceSkillService.listTestRunTemplates).toHaveBeenCalledWith("space-1");

    const created = await request(app)
      .post("/api/spaces/space-1/skill-test-run-templates")
      .send({ name: "Custom template", description: "Custom run guidance", body: "Run {{skillName}}." });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(mockSpaceSkillService.createTestRunTemplate).toHaveBeenCalledWith(
      "space-1",
      { name: "Custom template", description: "Custom run guidance", body: "Run {{skillName}}." },
      { type: "user", userId: "local-operator" },
    );

    const updated = await request(app)
      .patch("/api/spaces/space-1/skill-test-run-templates/66666666-6666-4666-8666-666666666666")
      .send({ name: "Renamed template" });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    expect(mockSpaceSkillService.updateTestRunTemplate).toHaveBeenCalledWith(
      "space-1",
      "66666666-6666-4666-8666-666666666666",
      { name: "Renamed template" },
      { type: "user", userId: "local-operator" },
    );

    const removed = await request(app)
      .delete("/api/spaces/space-1/skill-test-run-templates/66666666-6666-4666-8666-666666666666");
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    expect(mockSpaceSkillService.deleteTestRunTemplate).toHaveBeenCalledWith(
      "space-1",
      "66666666-6666-4666-8666-666666666666",
    );
  });

  it("creates and cancels skill test runs through hidden issue orchestration", async () => {
    const pluginWorkerManager = {} as PluginWorkerManager;
    mockSpaceSkillService.createTestRun.mockImplementationOnce(async (
      _spaceId: string,
      _skillId: string,
      _body: unknown,
      _actor: unknown,
      deps: {
        createHarnessIssue: (input: Record<string, unknown>) => Promise<unknown>;
        wakeHarnessIssue: (issueId: string, agentId: string) => Promise<unknown>;
      },
    ) => {
      await deps.createHarnessIssue({
        id: "44444444-4444-4444-8444-444444444444",
        title: "Skill test: Review",
        description: "Try the skill",
        assigneeAgentId: "55555555-5555-4555-8555-555555555555",
        harnessKind: "skill_test",
        workMode: "skill_test",
        status: "todo",
        originKind: "skill_test",
        originId: "22222222-2222-4222-8222-222222222222",
        originFingerprint: "skill_test:22222222-2222-4222-8222-222222222222",
      });
      await deps.wakeHarnessIssue("44444444-4444-4444-8444-444444444444", "55555555-5555-4555-8555-555555555555");
      return {
        ...createSkillTestRunDetails(),
        createdAt: new Date("2026-05-26T00:00:00.000Z"),
        updatedAt: new Date("2026-05-26T00:00:00.000Z"),
        cost: { costCents: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
        taskExpired: false,
      };
    });
    mockSpaceSkillService.cancelTestRun.mockImplementationOnce(async (
      _spaceId: string,
      _skillId: string,
      _runId: string,
      deps: { cancelHarnessIssue: (issueId: string) => Promise<unknown> },
    ) => {
      await deps.cancelHarnessIssue("44444444-4444-4444-8444-444444444444");
      return {
        ...createSkillTestRunDetails({ status: "cancelled", error: "Cancelled by operator" }),
        createdAt: new Date("2026-05-26T00:00:00.000Z"),
        updatedAt: new Date("2026-05-26T00:01:00.000Z"),
        cost: { costCents: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
        taskExpired: false,
      };
    });

    const app = await createApp(operatorActor(), undefined, {}, { pluginWorkerManager });
    expect(mockHeartbeatFactory).toHaveBeenCalledWith(expect.anything(), { pluginWorkerManager });

    const created = await request(app)
      .post("/api/spaces/space-1/skills/skill-1/test-runs")
      .send({ inputId: "11111111-1111-4111-8111-111111111111", agentId: "55555555-5555-4555-8555-555555555555" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(mockIssueService.create).toHaveBeenCalledWith("space-1", expect.objectContaining({
      harnessKind: "skill_test",
      workMode: "skill_test",
      assigneeAgentId: "55555555-5555-4555-8555-555555555555",
      description: "Try the skill",
    }));
    expect(mockHeartbeatService.wakeup).toHaveBeenCalledWith("55555555-5555-4555-8555-555555555555", expect.objectContaining({
      reason: "skill_test_run_created",
      payload: expect.objectContaining({ issueId: "44444444-4444-4444-8444-444444444444", skillId: "skill-1" }),
    }));

    const cancelled = await request(app)
      .post("/api/spaces/space-1/skills/skill-1/test-runs/22222222-2222-4222-8222-222222222222/cancel")
      .send({});
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(mockHeartbeatService.cancelRun).toHaveBeenCalledWith("run-1", "Cancelled by skill test run request");
    expect(mockIssueService.update).toHaveBeenCalledWith("44444444-4444-4444-8444-444444444444", expect.objectContaining({
      status: "cancelled",
      actorUserId: "local-operator",
    }));
  });

  it.each([
    ["create", "post", "/api/spaces/space-1/skills/skill-1/test-runs"],
    ["cancel", "post", "/api/spaces/space-1/skills/skill-1/test-runs/22222222-2222-4222-8222-222222222222/cancel"],
    ["delete", "delete", "/api/spaces/space-1/skills/skill-1/test-runs/22222222-2222-4222-8222-222222222222"],
  ] as const)("denies agents without tasks:assign permission from %s test runs", async (_operation, method, path) => {
    mockAccessService.decide.mockImplementation(async (input: { action: string }) => {
      if (input.action === "tasks:assign") return denyTaskAssignDecision();
      return allowSkillChangeDecision();
    });
    mockSpaceSkillService.getTestRunDetail.mockResolvedValue({
      id: "22222222-2222-4222-8222-222222222222",
      spaceId: "space-1",
      skillId: "skill-1",
      issueId: "44444444-4444-4444-8444-444444444444",
      agentId: "55555555-5555-4555-8555-555555555555",
      status: "queued",
    });

    const app = await createApp({
      type: "agent",
      agentId: "agent-1",
      spaceId: "space-1",
      keyScope: null,
      runId: "run-1",
    });
    const response = method === "post"
      ? await request(app)[method](path).send({
        inputId: "11111111-1111-4111-8111-111111111111",
        agentId: "55555555-5555-4555-8555-555555555555",
      })
      : await request(app)[method](path);

    expect(response.status, JSON.stringify(response.body)).toBe(403);
    expect(response.body.error).toBe("Missing permission: tasks:assign");
    expect(mockSpaceSkillPolicyService.evaluate).toHaveBeenCalledWith(expect.objectContaining({
      action: "skills.test",
    }));
    expect(mockAccessService.decide).toHaveBeenCalledWith(expect.objectContaining({
      action: "tasks:assign",
      resource: expect.objectContaining({
        type: "issue",
        spaceId: "space-1",
      }),
    }));
    expect(mockSpaceSkillService.createTestRun).not.toHaveBeenCalled();
    expect(mockSpaceSkillService.cancelTestRun).not.toHaveBeenCalled();
    expect(mockSpaceSkillService.deleteTestRun).not.toHaveBeenCalled();
  });

  it("does not prune expired harness issues from test run reads", async () => {
    mockSpaceSkillService.listTestRuns.mockResolvedValueOnce([]);
    mockSpaceSkillService.getTestRunDetail.mockResolvedValueOnce({
      id: "22222222-2222-4222-8222-222222222222",
      spaceId: "space-1",
      skillId: "skill-1",
      status: "succeeded",
      harnessContent: { available: false, unavailableReason: "expired", documents: [], attachments: [], workProducts: [] },
    });

    const app = await createApp(operatorActor());

    const listed = await request(app)
      .get("/api/spaces/space-1/skills/skill-1/test-runs");
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);

    const detail = await request(app)
      .get("/api/spaces/space-1/skills/skill-1/test-runs/22222222-2222-4222-8222-222222222222");
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);

    expect(mockSpaceSkillService.listTestRuns).toHaveBeenCalledWith("space-1", "skill-1", {});
    expect(mockSpaceSkillService.getTestRunDetail).toHaveBeenCalledWith(
      "space-1",
      "skill-1",
      "22222222-2222-4222-8222-222222222222",
    );
    expect(mockSpaceSkillService.pruneExpiredTestHarnessIssues).not.toHaveBeenCalled();
  });

  it("deletes a terminal test run and hides its harness task", async () => {
    mockIssueService.getById.mockResolvedValueOnce({
      id: "44444444-4444-4444-8444-444444444444",
      spaceId: "space-1",
      status: "done",
      executionRunId: null,
    });
    mockSpaceSkillService.deleteTestRun.mockImplementationOnce(async (
      _spaceId: string,
      _skillId: string,
      _runId: string,
      deps: { hideHarnessIssue: (issueId: string) => Promise<unknown> },
    ) => {
      await deps.hideHarnessIssue("44444444-4444-4444-8444-444444444444");
      return {
        ...createSkillTestRunDetails({ inputId: null, status: "succeeded", deletedAt: new Date("2026-05-26T00:02:00.000Z") }),
        createdAt: new Date("2026-05-26T00:00:00.000Z"),
        updatedAt: new Date("2026-05-26T00:02:00.000Z"),
        cost: { costCents: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 },
        taskExpired: false,
      };
    });

    const app = await createApp(operatorActor());

    const deleted = await request(app)
      .delete("/api/spaces/space-1/skills/skill-1/test-runs/22222222-2222-4222-8222-222222222222");
    expect(deleted.status, JSON.stringify(deleted.body)).toBe(200);
    expect(mockSpaceSkillService.deleteTestRun).toHaveBeenCalled();
    expect(mockIssueService.update).toHaveBeenCalledWith(
      "44444444-4444-4444-8444-444444444444",
      expect.objectContaining({ hiddenAt: expect.any(Date) }),
    );
  });

  it("returns 404 when deleting a missing test run", async () => {
    mockSpaceSkillService.deleteTestRun.mockResolvedValueOnce(null);
    const app = await createApp(operatorActor());
    const res = await request(app)
      .delete("/api/spaces/space-1/skills/skill-1/test-runs/22222222-2222-4222-8222-222222222222");
    expect(res.status).toBe(404);
  });

  it("returns a blocking error when attempting to delete a skill still used by agents", async () => {
    const { unprocessable } = await import("../errors.js");
    mockSpaceSkillService.deleteSkill.mockImplementationOnce(async () => {
      throw unprocessable(
        'Cannot delete skill "Find Skills" while it is still used by Builder, Reviewer. Detach it from those agents first.',
      );
    });

    const res = await request(await createApp(operatorActor()))
      .delete("/api/spaces/space-1/skills/skill-1");

    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body).toEqual({
      error: 'Cannot delete skill "Find Skills" while it is still used by Builder, Reviewer. Detach it from those agents first.',
    });
    expect(mockSpaceSkillService.deleteSkill).toHaveBeenCalledWith("space-1", "skill-1", expect.any(Function), expect.any(Function));
    expect(mockLogActivity).not.toHaveBeenCalled();
  });
});
