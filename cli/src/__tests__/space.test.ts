import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpacePortabilityPreviewResult } from "@outpost/shared";
import {
  buildSpaceDashboardUrl,
  buildDefaultImportAdapterOverrides,
  buildDefaultImportSelectionState,
  buildImportSelectionCatalog,
  buildSelectedFilesFromImportSelection,
  renderSpaceImportPreview,
  renderSpaceImportResult,
  registerSpaceCommands,
  resolveSpaceImportApplyConfirmationMode,
  resolveSpaceImportApiPath,
} from "../commands/client/space.js";

const ORIGINAL_ENV = { ...process.env };
const SPACE_ID = "22222222-2222-4222-8222-222222222222";

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: () => undefined,
    writeErr: () => undefined,
  });
  registerSpaceCommands(program);
  return program;
}

async function runCommand(args: string[]): Promise<void> {
  await makeProgram().parseAsync(args, { from: "user" });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function space(overrides: Record<string, unknown> = {}) {
  return {
    id: SPACE_ID,
    name: "Outpost",
    description: null,
    status: "active",
    issuePrefix: "PAP",
    issueCounter: 1,
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    requireOperatorApprovalForNewAgents: false,
    feedbackDataSharingEnabled: false,
    feedbackDataSharingConsentAt: null,
    feedbackDataSharingConsentByUserId: null,
    feedbackDataSharingTermsVersion: null,
    logoAssetId: null,
    createdAt: "2026-06-04T00:00:00.000Z",
    updatedAt: "2026-06-04T00:00:00.000Z",
    logoUrl: null,
    ...overrides,
  };
}

function allImportEntities(): SpacePortabilityPreviewResult["include"] {
  return {
    space: true,
    agents: true,
    projects: true,
    issues: true,
    skills: true,
  };
}

function sourceSpaceManifest(): NonNullable<SpacePortabilityPreviewResult["manifest"]["space"]> {
  return {
    path: "COMPANY.md",
    name: "Source Co",
    description: null,
    logoPath: null,
    requireOperatorApprovalForNewAgents: false,
    feedbackDataSharingEnabled: false,
    feedbackDataSharingConsentAt: null,
    feedbackDataSharingConsentByUserId: null,
    feedbackDataSharingTermsVersion: null,
  };
}

function leadManifest(): SpacePortabilityPreviewResult["manifest"]["agents"][number] {
  return {
    slug: "lead",
    name: "Default agent",
    path: "agents/lead/AGENT.md",
    skills: [],
    role: "lead",
    title: null,
    icon: null,
    capabilities: null,
    leadAgentSlug: null,
    existingLeadAgentId: null,
    existingLeadAgentSlug: null,
    adapterType: "codex_local",
    adapterConfig: {},
    runtimeConfig: {},
    permissions: {},
    permissionGrants: [],
    budgetMonthlyCents: 0,
    metadata: null,
  };
}

function alphaProjectManifest(): SpacePortabilityPreviewResult["manifest"]["projects"][number] {
  return {
    slug: "alpha",
    name: "Alpha",
    path: "projects/alpha/PROJECT.md",
    description: null,
    ownerAgentSlug: null,
    leadAgentSlug: null,
    targetDate: null,
    color: null,
    icon: null,
    status: null,
    executionWorkspacePolicy: null,
    workspaces: [],
    env: null,
    metadata: null,
  };
}

function kickoffIssueManifest(): SpacePortabilityPreviewResult["manifest"]["issues"][number] {
  return {
    slug: "kickoff",
    identifier: null,
    title: "Kickoff",
    path: "projects/alpha/issues/kickoff/TASK.md",
    projectSlug: "alpha",
    projectWorkspaceKey: null,
    assigneeAgentSlug: "lead",
    description: null,
    recurring: false,
    routine: null,
    legacyRecurrence: null,
    status: null,
    priority: null,
    labelIds: [],
    billingCode: null,
    executionWorkspaceSettings: null,
    assigneeAdapterOverrides: null,
    comments: [],
    metadata: null,
  };
}

function openAiEnvInput(): SpacePortabilityPreviewResult["envInputs"][number] {
  return {
    key: "OPENAI_API_KEY",
    description: null,
    agentSlug: "lead",
    projectSlug: null,
    kind: "secret",
    requirement: "required",
    defaultValue: null,
    portability: "portable",
  };
}

describe("space CLI commands", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.OUTPOST_API_URL;
    delete process.env.OUTPOST_API_KEY;
    delete process.env.OUTPOST_SPACE_ID;
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("gets the current space from an explicit space context without operator-wide listing", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(space()));

    await runCommand([
      "space",
      "current",
      "--space-id",
      SPACE_ID,
      "--api-base",
      "http://outpost.test",
      "--api-key",
      "agent-token",
      "--json",
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `http://outpost.test/api/spaces/${SPACE_ID}`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({ id: SPACE_ID, name: "Outpost" });
  });

  it("gets the current space from agent authentication when no space context is set", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: "agent-1", spaceId: SPACE_ID }))
      .mockResolvedValueOnce(jsonResponse(space()));

    await runCommand([
      "space",
      "current",
      "--api-base",
      "http://outpost.test",
      "--api-key",
      "agent-token",
      "--json",
    ]);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://outpost.test/api/agents/me",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `http://outpost.test/api/spaces/${SPACE_ID}`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({ id: SPACE_ID, name: "Outpost" });
  });

  it("lists the scoped agent space when operator-wide space listing is denied", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: "Operator access required" }, 403))
      .mockResolvedValueOnce(jsonResponse({ id: "agent-1", spaceId: SPACE_ID }))
      .mockResolvedValueOnce(jsonResponse(space()));

    await runCommand([
      "space",
      "list",
      "--api-base",
      "http://outpost.test",
      "--api-key",
      "agent-token",
      "--json",
    ]);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://outpost.test/api/spaces",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://outpost.test/api/agents/me",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      `http://outpost.test/api/spaces/${SPACE_ID}`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject([{ id: SPACE_ID, name: "Outpost" }]);
  });

  it("explains that space creation requires operator instance-admin authentication under agent auth", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Operator access required" }, 403));
    vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      throw new Error(`exit:${code ?? 0}`);
    }) as typeof process.exit);

    await expect(runCommand([
      "space",
      "create",
      "--payload-json",
      "{\"name\":\"Disposable\"}",
      "--api-base",
      "http://outpost.test",
      "--api-key",
      "agent-token",
      "--json",
    ])).rejects.toThrow("exit:1");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://outpost.test/api/spaces",
      expect.objectContaining({ method: "POST" }),
    );
    const rendered = String(errorSpy.mock.calls[0]?.[0]);
    expect(rendered).toContain("Creating spaces requires operator/instance-admin authentication");
    expect(rendered).toContain("space list --json");
  });
});

describe("resolveSpaceImportApiPath", () => {
  it("uses space-scoped preview route for existing-space dry runs", () => {
    expect(
      resolveSpaceImportApiPath({
        dryRun: true,
        targetMode: "existing_space",
        spaceId: "space-123",
      }),
    ).toBe("/api/spaces/space-123/imports/preview");
  });

  it("uses space-scoped apply route for existing-space imports", () => {
    expect(
      resolveSpaceImportApiPath({
        dryRun: false,
        targetMode: "existing_space",
        spaceId: "space-123",
      }),
    ).toBe("/api/spaces/space-123/imports/apply");
  });

  it("keeps global routes for new-space imports", () => {
    expect(
      resolveSpaceImportApiPath({
        dryRun: true,
        targetMode: "new_space",
      }),
    ).toBe("/api/spaces/import/preview");

    expect(
      resolveSpaceImportApiPath({
        dryRun: false,
        targetMode: "new_space",
      }),
    ).toBe("/api/spaces/import");
  });

  it("throws when an existing-space import is missing a space id", () => {
    expect(() =>
      resolveSpaceImportApiPath({
        dryRun: true,
        targetMode: "existing_space",
        spaceId: " ",
      })
    ).toThrow(/require a spaceId/i);
  });
});

describe("resolveSpaceImportApplyConfirmationMode", () => {
  it("skips confirmation when --yes is set", () => {
    expect(
      resolveSpaceImportApplyConfirmationMode({
        yes: true,
        interactive: false,
        json: false,
      }),
    ).toBe("skip");
  });

  it("prompts in interactive text mode when --yes is not set", () => {
    expect(
      resolveSpaceImportApplyConfirmationMode({
        yes: false,
        interactive: true,
        json: false,
      }),
    ).toBe("prompt");
  });

  it("requires --yes for non-interactive apply", () => {
    expect(() =>
      resolveSpaceImportApplyConfirmationMode({
        yes: false,
        interactive: false,
        json: false,
      })
    ).toThrow(/non-interactive terminal requires --yes/i);
  });

  it("requires --yes for json apply", () => {
    expect(() =>
      resolveSpaceImportApplyConfirmationMode({
        yes: false,
        interactive: false,
        json: true,
      })
    ).toThrow(/with --json requires --yes/i);
  });
});

describe("buildSpaceDashboardUrl", () => {
  it("preserves the configured base path when building a dashboard URL", () => {
    expect(buildSpaceDashboardUrl("https://outpost.example/app/", "PAP")).toBe(
      "https://outpost.example/app/PAP/dashboard",
    );
  });
});

describe("renderSpaceImportPreview", () => {
  it("summarizes the preview with counts, selection info, and truncated examples", () => {
    const preview: SpacePortabilityPreviewResult = {
      include: allImportEntities(),
      targetSpaceId: "space-123",
      targetSpaceName: "Imported Co",
      collisionStrategy: "rename",
      selectedAgentSlugs: ["lead", "engineering_lead", "eng-1", "eng-2", "eng-3", "eng-4", "eng-5"],
      plan: {
        spaceAction: "update",
        agentPlans: [
          { slug: "lead", action: "create", plannedName: "Default agent", existingAgentId: null, reason: null },
          { slug: "engineering_lead", action: "update", plannedName: "Engineering Lead", existingAgentId: "agent-2", reason: "replace strategy" },
          { slug: "eng-1", action: "skip", plannedName: "Engineer 1", existingAgentId: "agent-3", reason: "skip strategy" },
          { slug: "eng-2", action: "create", plannedName: "Engineer 2", existingAgentId: null, reason: null },
          { slug: "eng-3", action: "create", plannedName: "Engineer 3", existingAgentId: null, reason: null },
          { slug: "eng-4", action: "create", plannedName: "Engineer 4", existingAgentId: null, reason: null },
          { slug: "eng-5", action: "create", plannedName: "Engineer 5", existingAgentId: null, reason: null },
        ],
        projectPlans: [
          { slug: "alpha", action: "create", plannedName: "Alpha", existingProjectId: null, reason: null },
        ],
        issuePlans: [
          { slug: "kickoff", action: "create", plannedTitle: "Kickoff", reason: null },
        ],
      },
      manifest: {
        schemaVersion: 1,
        generatedAt: "2026-03-23T17:00:00.000Z",
        source: {
          spaceId: "space-src",
          spaceName: "Source Co",
        },
        includes: allImportEntities(),
        space: sourceSpaceManifest(),
        sidebar: {
          agents: ["lead"],
          projects: ["alpha"],
        },
        agents: [
          leadManifest(),
        ],
        skills: [
          {
            key: "skill-a",
            slug: "skill-a",
            name: "Skill A",
            path: "skills/skill-a/SKILL.md",
            description: null,
            sourceType: "inline",
            sourceLocator: null,
            sourceRef: null,
            trustLevel: null,
            compatibility: null,
            metadata: null,
            fileInventory: [],
          },
        ],
        projects: [
          alphaProjectManifest(),
        ],
        issues: [
          kickoffIssueManifest(),
        ],
        envInputs: [
          openAiEnvInput(),
        ],
      },
      files: {
        "COMPANY.md": "# Source Co",
      },
      envInputs: [
        openAiEnvInput(),
      ],
      warnings: ["One warning"],
      errors: ["One error"],
    };

    const rendered = renderSpaceImportPreview(preview, {
      sourceLabel: "GitHub: https://github.com/outpost/spaces/demo",
      targetLabel: "Imported Co (space-123)",
      infoMessages: ["Using claude-local adapter"],
    });

    expect(rendered).toContain("Include");
    expect(rendered).toContain("space, projects, tasks, agents, skills");
    expect(rendered).toContain("7 agents total");
    expect(rendered).toContain("1 project total");
    expect(rendered).toContain("1 task total");
    expect(rendered).toContain("skills: 1 skill packaged");
    expect(rendered).toContain("+1 more");
    expect(rendered).toContain("Using claude-local adapter");
    expect(rendered).toContain("Warnings");
    expect(rendered).toContain("Errors");
  });
});

describe("renderSpaceImportResult", () => {
  it("summarizes import results with created, updated, and skipped counts", () => {
    const rendered = renderSpaceImportResult(
      {
        space: {
          id: "space-123",
          name: "Imported Co",
          action: "updated",
        },
        agents: [
          { slug: "lead", id: "agent-1", action: "created", name: "Default agent", reason: null },
          { slug: "engineering_lead", id: "agent-2", action: "updated", name: "Engineering Lead", reason: "replace strategy" },
          { slug: "ops", id: null, action: "skipped", name: "Ops", reason: "skip strategy" },
        ],
        skills: [
          {
            originalKey: "space/source/review",
            originalSlug: "review",
            key: "space/target/review-2",
            slug: "review-2",
            id: "skill-1",
            action: "renamed",
            reason: "rename strategy",
          },
        ],
        projects: [
          { slug: "app", id: "project-1", action: "created", name: "App", reason: null },
          { slug: "ops", id: "project-2", action: "updated", name: "Operations", reason: "replace strategy" },
          { slug: "archive", id: null, action: "skipped", name: "Archive", reason: "skip strategy" },
        ],
        routines: [
          { slug: "weekly-report", id: "routine-1", action: "created", title: "Weekly report", status: "paused" },
        ],
        envInputs: [],
        warnings: ["Review API keys"],
      },
      {
        targetLabel: "Imported Co (space-123)",
        spaceUrl: "https://outpost.example/PAP/dashboard",
        infoMessages: ["Using claude-local adapter"],
      },
    );

    expect(rendered).toContain("Space");
    expect(rendered).toContain("https://outpost.example/PAP/dashboard");
    expect(rendered).toContain("3 agents total (1 created, 1 updated, 1 skipped)");
    expect(rendered).toContain("1 skill total (1 renamed)");
    expect(rendered).toContain("3 projects total (1 created, 1 updated, 1 skipped)");
    expect(rendered).toContain("Agent results");
    expect(rendered).toContain("Skill results");
    expect(rendered).toContain("Project results");
    expect(rendered).toContain("Using claude-local adapter");
    expect(rendered).toContain("Review API keys");
  });
});

describe("import selection catalog", () => {
  it("defaults to everything and keeps project selection separate from task selection", () => {
    const preview: SpacePortabilityPreviewResult = {
      include: allImportEntities(),
      targetSpaceId: "space-123",
      targetSpaceName: "Imported Co",
      collisionStrategy: "rename",
      selectedAgentSlugs: ["lead"],
      plan: {
        spaceAction: "create",
        agentPlans: [],
        projectPlans: [],
        issuePlans: [],
      },
      manifest: {
        schemaVersion: 1,
        generatedAt: "2026-03-23T18:00:00.000Z",
        source: {
          spaceId: "space-src",
          spaceName: "Source Co",
        },
        includes: allImportEntities(),
        space: {
          path: "COMPANY.md",
          name: "Source Co",
          description: null,
          logoPath: "images/space-logo.png",
          requireOperatorApprovalForNewAgents: false,
          feedbackDataSharingEnabled: false,
          feedbackDataSharingConsentAt: null,
          feedbackDataSharingConsentByUserId: null,
          feedbackDataSharingTermsVersion: null,
        },
        sidebar: {
          agents: ["lead"],
          projects: ["alpha"],
        },
        agents: [
          leadManifest(),
        ],
        skills: [
          {
            key: "skill-a",
            slug: "skill-a",
            name: "Skill A",
            path: "skills/skill-a/SKILL.md",
            description: null,
            sourceType: "inline",
            sourceLocator: null,
            sourceRef: null,
            trustLevel: null,
            compatibility: null,
            metadata: null,
            fileInventory: [{ path: "skills/skill-a/helper.md", kind: "doc" }],
          },
        ],
        projects: [
          alphaProjectManifest(),
        ],
        issues: [
          kickoffIssueManifest(),
        ],
        envInputs: [],
      },
      files: {
        "COMPANY.md": "# Source Co",
        "README.md": "# Readme",
        ".outpost.yaml": "schema: outpost/v1\n",
        "images/space-logo.png": {
          encoding: "base64",
          data: "",
          contentType: "image/png",
        },
        "projects/alpha/PROJECT.md": "# Alpha",
        "projects/alpha/notes.md": "project notes",
        "projects/alpha/issues/kickoff/TASK.md": "# Kickoff",
        "projects/alpha/issues/kickoff/details.md": "task details",
        "agents/lead/AGENT.md": "# Default agent",
        "agents/lead/prompt.md": "prompt",
        "skills/skill-a/SKILL.md": "# Skill A",
        "skills/skill-a/helper.md": "helper",
      },
      envInputs: [],
      warnings: [],
      errors: [],
    };

    const catalog = buildImportSelectionCatalog(preview);
    const state = buildDefaultImportSelectionState(catalog);

    expect(state.space).toBe(true);
    expect(state.projects.has("alpha")).toBe(true);
    expect(state.issues.has("kickoff")).toBe(true);
    expect(state.agents.has("lead")).toBe(true);
    expect(state.skills.has("skill-a")).toBe(true);

    state.space = false;
    state.issues.clear();
    state.agents.clear();
    state.skills.clear();

    const selectedFiles = buildSelectedFilesFromImportSelection(catalog, state);

    expect(selectedFiles).toContain(".outpost.yaml");
    expect(selectedFiles).toContain("projects/alpha/PROJECT.md");
    expect(selectedFiles).toContain("projects/alpha/notes.md");
    expect(selectedFiles).not.toContain("projects/alpha/issues/kickoff/TASK.md");
    expect(selectedFiles).not.toContain("projects/alpha/issues/kickoff/details.md");
  });

  it("includes extension file even when all entities are deselected", () => {
    const preview: SpacePortabilityPreviewResult = {
      include: allImportEntities(),
      targetSpaceId: "space-123",
      targetSpaceName: "Imported Co",
      collisionStrategy: "rename",
      selectedAgentSlugs: [],
      plan: {
        spaceAction: "create",
        agentPlans: [],
        projectPlans: [],
        issuePlans: [],
      },
      manifest: {
        schemaVersion: 1,
        generatedAt: "2026-03-23T18:00:00.000Z",
        source: {
          spaceId: "space-src",
          spaceName: "Source Co",
        },
        includes: allImportEntities(),
        space: sourceSpaceManifest(),
        sidebar: {
          agents: [],
          projects: [],
        },
        agents: [],
        skills: [],
        projects: [],
        issues: [],
        envInputs: [],
      },
      files: {
        ".outpost.yaml": "schema: outpost/v1\n",
      },
      envInputs: [],
      warnings: [],
      errors: [],
    };

    const catalog = buildImportSelectionCatalog(preview);
    const state = buildDefaultImportSelectionState(catalog);

    state.space = false;
    state.projects.clear();
    state.issues.clear();
    state.agents.clear();
    state.skills.clear();

    const selectedFiles = buildSelectedFilesFromImportSelection(catalog, state);

    expect(selectedFiles).toContain(".outpost.yaml");
    expect(selectedFiles).toHaveLength(1);
  });
});

describe("default adapter overrides", () => {
  it("maps process-only imported agents to claude_local", () => {
    const preview: SpacePortabilityPreviewResult = {
      include: {
        space: false,
        agents: true,
        projects: false,
        issues: false,
        skills: false,
      },
      targetSpaceId: null,
      targetSpaceName: null,
      collisionStrategy: "rename",
      selectedAgentSlugs: ["legacy-agent", "explicit-agent"],
      plan: {
        spaceAction: "none",
        agentPlans: [],
        projectPlans: [],
        issuePlans: [],
      },
      manifest: {
        schemaVersion: 1,
        generatedAt: "2026-03-23T18:20:00.000Z",
        source: null,
        includes: {
          space: false,
          agents: true,
          projects: false,
          issues: false,
          skills: false,
        },
        space: null,
        sidebar: null,
        agents: [
          {
            slug: "legacy-agent",
            name: "Legacy Agent",
            path: "agents/legacy-agent/AGENT.md",
            skills: [],
            role: "agent",
            title: null,
            icon: null,
            capabilities: null,
            leadAgentSlug: null,
            existingLeadAgentId: null,
            existingLeadAgentSlug: null,
            adapterType: "process",
            adapterConfig: {},
            runtimeConfig: {},
            permissions: {},
            permissionGrants: [],
            budgetMonthlyCents: 0,
            metadata: null,
          },
          {
            slug: "explicit-agent",
            name: "Explicit Agent",
            path: "agents/explicit-agent/AGENT.md",
            skills: [],
            role: "agent",
            title: null,
            icon: null,
            capabilities: null,
            leadAgentSlug: null,
            existingLeadAgentId: null,
            existingLeadAgentSlug: null,
            adapterType: "codex_local",
            adapterConfig: {},
            runtimeConfig: {},
            permissions: {},
            permissionGrants: [],
            budgetMonthlyCents: 0,
            metadata: null,
          },
        ],
        skills: [],
        projects: [],
        issues: [],
        envInputs: [],
      },
      files: {},
      envInputs: [],
      warnings: [],
      errors: [],
    };

    expect(buildDefaultImportAdapterOverrides(preview)).toEqual({
      "legacy-agent": {
        adapterType: "claude_local",
      },
    });
  });
});
