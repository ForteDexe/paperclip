import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { parseFrontmatterMarkdown } from "@outpost/shared/frontmatter";
import { executeRunnerApi } from "../services/native-runtime/runner-api-client.js";
import type { CatalogTeam } from "@outpost/shared";

const spacePrefix = vi.hoisted(() => vi.fn());
const testDb = { select: () => ({ from: () => ({ where: () => ({ limit: spacePrefix }) }) }) };

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
  list: vi.fn(),
}));

const mockSpacePortabilityService = vi.hoisted(() => ({
  previewImport: vi.fn(),
  importBundle: vi.fn(),
}));

const mockSpaceSkillService = vi.hoisted(() => ({
  installFromCatalog: vi.fn(),
  importFromSource: vi.fn(),
}));

vi.mock("../services/agents.js", () => ({
  agentService: () => mockAgentService,
}));

vi.mock("../services/space-portability.js", () => ({
  spacePortabilityService: () => mockSpacePortabilityService,
}));

vi.mock("../services/space-skills.js", () => ({
  spaceSkillService: () => mockSpaceSkillService,
}));

vi.mock("../services/activity-log.js", () => ({
  logActivity: vi.fn(),
}));

const {
  collectCatalogTeamSkillPreparations,
  listCatalogTeams,
  readCatalogTeamProvenance,
  teamsCatalogService,
} = await import("../services/teams-catalog.js");

const CORE_CREW_ID = "outpost:bundled:space-defaults:core-crew";
const CORE_CREW_HASH = (await listCatalogTeams()).find((team) => team.id === CORE_CREW_ID)!.contentHash;

function agentWithCatalogTeam(originHash: string | null, extra: Record<string, unknown> = {}) {
  return {
    id: `agent-${Math.random().toString(36).slice(2)}`,
    spaceId: "space-1",
    metadata: {
      outpost: {
        catalogTeam: {
          catalogId: CORE_CREW_ID,
          catalogKey: "outpost/bundled/space-defaults/core-crew",
          ...(originHash ? { originHash } : {}),
        },
      },
    },
    ...extra,
  };
}

describe("teamsCatalogService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spacePrefix.mockResolvedValue([{ issuePrefix: "ACME" }]);
    mockAgentService.getById.mockResolvedValue({
      id: "manager-1",
      spaceId: "space-1",
      name: "Engineering Manager",
    });
    mockSpacePortabilityService.previewImport.mockResolvedValue({
      include: { space: false, agents: true, projects: true, issues: true, skills: true },
      targetSpaceId: "space-1",
      targetSpaceName: "Outpost",
      collisionStrategy: "rename",
      selectedAgentSlugs: ["lead", "engineering-lead"],
      plan: { spaceAction: "none", agentPlans: [], projectPlans: [], issuePlans: [] },
      manifest: { agents: [], skills: [], projects: [], issues: [], envInputs: [], includes: { space: false, agents: true, projects: true, issues: true, skills: true }, space: null, schemaVersion: 1, generatedAt: new Date().toISOString(), source: null, sidebar: null },
      files: {},
      envInputs: [],
      warnings: [],
      errors: [],
    });
    mockSpacePortabilityService.importBundle.mockResolvedValue({
      space: { id: "space-1", name: "Outpost", action: "unchanged" },
      agents: [],
      projects: [],
      envInputs: [],
      warnings: [],
    });
    mockSpaceSkillService.installFromCatalog.mockResolvedValue({
      action: "created",
      skill: { key: "outpost/bundled/outpost-operations/task-planning" },
      catalogSkill: { id: "outpost:bundled:outpost-operations:task-planning" },
      warnings: [],
    });
    mockSpaceSkillService.importFromSource.mockResolvedValue({
      imported: [],
      warnings: [],
    });
  });

  it("builds an inline portability source with catalog skill keys and target-lead reparenting", async () => {
    const svc = teamsCatalogService(testDb as any);

    const prepared = await svc.prepareCatalogTeamSource("space-1", "core-crew", {
      targetLeadAgentId: "manager-1",
    });

    expect(prepared.errors).toEqual([]);
    expect(prepared.source.files["COMPANY.md"]).toEqual(expect.stringContaining("Core Crew"));
    expect(prepared.source.files["agents/lead/AGENTS.md"]).toEqual(expect.stringContaining("outpost/bundled/outpost-operations/task-planning"));
    expect(prepared.source.files["agents/engineering-lead/AGENTS.md"]).toEqual(expect.stringContaining("outpost/bundled/software-development/github-pr-workflow"));
    expect(prepared.source.files[".outpost.yaml"]).toEqual(expect.stringContaining("existingLeadAgentId: \"manager-1\""));
    expect(prepared.source.files[".outpost.yaml"]).toEqual(expect.stringContaining("existingLeadAgentSlug: \"engineering-manager\""));
  });

  it.each(["core-crew", "product-engineering", "product-design", "content-machine"])(
    "preserves %s role files and canonical skill references through catalog import",
    async (teamRef) => {
      const svc = teamsCatalogService(testDb as any);
      const prepared = await svc.prepareCatalogTeamSource("space-1", teamRef);
      expect(prepared.errors).toEqual([]);
      for (const slug of prepared.team.agentSlugs) {
        const filePath = `agents/${slug}/AGENTS.md`;
        const original = parseFrontmatterMarkdown(await readFile(
          new URL(`../../../packages/teams-catalog/${prepared.team.path}/${filePath}`, import.meta.url),
          "utf8",
        ));
        const imported = parseFrontmatterMarkdown(prepared.source.files[filePath] as string);
        const requiredSkills = (original.frontmatter.skills as string[]).map((ref) => {
          const requirement = prepared.team.requiredSkills.find((skill) => skill.ref === ref && skill.agentSlugs.includes(slug));
          expect(requirement, `${filePath}: ${ref}`).toMatchObject({ resolved: true });
          return requirement?.type === "catalog" ? requirement.catalogSkillKey : ref;
        });
        expect(imported.frontmatter, filePath).toEqual({ ...original.frontmatter, skills: requiredSkills });
        expect(imported.body, filePath).toBe(original.body);
      }

      await svc.installCatalogTeam("space-1", teamRef);
      const [importInput] = mockSpacePortabilityService.importBundle.mock.calls.at(-1)!;
      expect(importInput.source.files).toEqual(prepared.source.files);
      const requiredCatalogIds = prepared.skillPreparations
        .filter((skill) => skill.action === "catalog_install_required")
        .map((skill) => skill.catalogSkillId).sort();
      expect(mockSpaceSkillService.installFromCatalog.mock.calls.map((call) => call[1].catalogSkillId).sort())
        .toEqual(requiredCatalogIds);
    },
  );

  it("resolves target-lead slug against same-space agents before rendering reparent metadata", async () => {
    mockAgentService.list.mockResolvedValue([
      { id: "manager-1", spaceId: "space-1", name: "Default agent" },
    ]);
    const svc = teamsCatalogService(testDb as any);

    const prepared = await svc.prepareCatalogTeamSource("space-1", "core-crew", {
      targetLeadSlug: "default-agent",
    });

    expect(mockAgentService.list).toHaveBeenCalledWith("space-1");
    expect(prepared.source.files[".outpost.yaml"]).toEqual(expect.stringContaining("existingLeadAgentId: \"manager-1\""));
    expect(prepared.source.files[".outpost.yaml"]).toEqual(expect.stringContaining("existingLeadAgentSlug: \"default-agent\""));
  });

  it("preserves package-declared Outpost sidecar permissions while adding generated catalog provenance", async () => {
    const svc = teamsCatalogService(testDb as any);

    const prepared = await svc.prepareCatalogTeamSource("space-1", "product-engineering");

    expect(prepared.source.files[".outpost.yaml"]).toEqual(expect.stringContaining("permissions:"));
    expect(prepared.source.files[".outpost.yaml"]).toEqual(expect.stringContaining("canCreateAgents: true"));
    expect(prepared.source.files[".outpost.yaml"]).toEqual(expect.stringContaining("catalogTeam:"));
    expect(prepared.source.files[".outpost.yaml"]).toEqual(expect.stringContaining("catalogSlug: \"product-engineering\""));
  });

  it("preserves package sidecar permissions when generated target-lead metadata is merged onto the same root agent", async () => {
    const svc = teamsCatalogService(testDb as any);

    const prepared = await svc.prepareCatalogTeamSource("space-1", "product-engineering", {
      targetLeadAgentId: "manager-1",
    });

    expect(prepared.source.files[".outpost.yaml"]).toEqual(expect.stringContaining("permissions:"));
    expect(prepared.source.files[".outpost.yaml"]).toEqual(expect.stringContaining("canCreateAgents: true"));
    expect(prepared.source.files[".outpost.yaml"]).toEqual(expect.stringContaining("existingLeadAgentId: \"manager-1\""));
    expect(prepared.source.files[".outpost.yaml"]).toEqual(expect.stringContaining("existingLeadAgentSlug: \"engineering-manager\""));
    expect(prepared.source.files[".outpost.yaml"]).toEqual(expect.stringContaining("catalogSlug: \"product-engineering\""));
  });

  it("rejects missing target-lead slugs instead of emitting unresolved reparent metadata", async () => {
    mockAgentService.list.mockResolvedValue([]);
    const svc = teamsCatalogService(testDb as any);

    await expect(
      svc.prepareCatalogTeamSource("space-1", "core-crew", {
        targetLeadSlug: "missing-manager",
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("previews through space portability in agent-safe mode", async () => {
    const svc = teamsCatalogService(testDb as any);

    const preview = await svc.previewCatalogTeamImport("space-1", "content-machine");

    expect(preview.errors).toEqual([]);
    expect(mockSpacePortabilityService.previewImport).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { mode: "existing_space", spaceId: "space-1" },
        include: expect.objectContaining({
          space: false,
          agents: true,
          projects: true,
          issues: true,
          skills: true,
        }),
        source: expect.objectContaining({ type: "inline" }),
      }),
      { mode: "agent_safe", sourceSpaceId: "space-1" },
    );
  });

  it("forces catalog previews to exclude space metadata even when requested", async () => {
    const svc = teamsCatalogService(testDb as any);

    await svc.previewCatalogTeamImport("space-1", "content-machine", {
      include: { space: true, agents: false },
    });

    expect(mockSpacePortabilityService.previewImport).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          space: false,
          agents: false,
        }),
      }),
      { mode: "agent_safe", sourceSpaceId: "space-1" },
    );
  });

  it("preflights imports before installing catalog skills", async () => {
    mockSpacePortabilityService.previewImport.mockResolvedValueOnce({
      include: { space: false, agents: true, projects: true, issues: true, skills: true },
      targetSpaceId: "space-1",
      targetSpaceName: "Outpost",
      collisionStrategy: "rename",
      selectedAgentSlugs: ["lead"],
      plan: { spaceAction: "none", agentPlans: [], projectPlans: [], issuePlans: [] },
      manifest: { agents: [], skills: [], projects: [], issues: [], envInputs: [], includes: { space: false, agents: true, projects: true, issues: true, skills: true }, space: null, schemaVersion: 1, generatedAt: new Date().toISOString(), source: null, sidebar: null },
      files: {},
      envInputs: [],
      warnings: [],
      errors: ["Safe import does not allow process adapter type."],
    });
    const svc = teamsCatalogService(testDb as any);

    await expect(svc.installCatalogTeam("space-1", "core-crew")).rejects.toMatchObject({ status: 422 });

    expect(mockSpaceSkillService.installFromCatalog).not.toHaveBeenCalled();
    expect(mockSpacePortabilityService.importBundle).not.toHaveBeenCalled();
  });

  it("does not install catalog skills when bundle import fails", async () => {
    mockSpacePortabilityService.importBundle.mockRejectedValueOnce(new Error("import failed"));
    const svc = teamsCatalogService(testDb as any);

    await expect(svc.installCatalogTeam("space-1", "core-crew")).rejects.toThrow("import failed");

    expect(mockSpaceSkillService.installFromCatalog).not.toHaveBeenCalled();
    expect(mockSpaceSkillService.importFromSource).not.toHaveBeenCalled();
  });

  it("rejects a missing space before importing resources", async () => {
    spacePrefix.mockResolvedValueOnce([]);
    await expect(teamsCatalogService(testDb as any).installCatalogTeam("space-1", "core-crew")).rejects.toMatchObject({ status: 404 });
    expect(mockSpacePortabilityService.importBundle).not.toHaveBeenCalled();
  });

  it("returns scoped saved-resource links while preserving warnings and skipped-resource semantics", async () => {
    mockSpacePortabilityService.importBundle.mockResolvedValueOnce({
      space: { id: "space-1", name: "Outpost", action: "unchanged" },
      agents: [{ id: "saved-agent", name: "Engineering Lead 2", slug: "engineering-lead", action: "created" }, { id: null, name: "Skipped", slug: "skipped", action: "skipped" }],
      projects: [{ id: "saved-project", name: "Engineering", slug: "engineering", action: "updated" }],
      routines: [{ id: "saved-routine", title: "Weekly sync", slug: "weekly", action: "created" }],
      envInputs: [], warnings: ["required skill unavailable"],
    });
    const result = await teamsCatalogService(testDb as any).installCatalogTeam("space-1", "core-crew");
    expect(result.resourceLinks).toEqual([
      { kind: "agent", id: "saved-agent", name: "Engineering Lead 2", href: "/ACME/agents/saved-agent" },
      { kind: "project", id: "saved-project", name: "Engineering", href: "/ACME/projects/saved-project" },
      { kind: "routine", id: "saved-routine", name: "Weekly sync", href: "/ACME/routines/saved-routine" },
    ]);
    const wire = await executeRunnerApi({ operationId: "POST /api/spaces/{spaceId}/teams/catalog/{catalogId}/install",
      pathParams: { catalogId: "core-crew" }, body: {} },
    { spaceId: "space-1", issueId: "issue-1", issueIdentifier: "ACME-1", runId: "run-1", workMode: "standard" },
    { apiUrl: "http://fixture.invalid", token: "private-test-token", fetch: async () => Response.json(result, { status: 201 }),
      readFile: async () => { throw new Error("not used"); }, saveResponse: async () => { throw new Error("unexpected artifact"); } });
    expect(wire).toMatchObject({ ok: true, status: 201, data: { resourceLinks: result.resourceLinks, warnings: result.warnings } });
    expect(result.warnings).toContain("required skill unavailable");
    expect(result.portabilityImport.agents[1].id).toBeNull();
  });

  it("surfaces post-import catalog skill install failures as warnings", async () => {
    mockSpaceSkillService.installFromCatalog.mockRejectedValueOnce(new Error("catalog unavailable"));
    const svc = teamsCatalogService(testDb as any);

    const result = await svc.installCatalogTeam("space-1", "core-crew");

    expect(mockSpacePortabilityService.importBundle).toHaveBeenCalled();
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("catalog unavailable"),
      ]),
    );
  });

  it("injects safe claude_local adapter defaults for every bundled agent when no overrides are supplied", async () => {
    const svc = teamsCatalogService(testDb as any);

    await svc.installCatalogTeam("space-1", "core-crew");

    const [importInput] = mockSpacePortabilityService.importBundle.mock.calls.at(-1)!;
    expect(importInput.adapterOverrides).toEqual({
      lead: { adapterType: "claude_local" },
      "engineering-lead": { adapterType: "claude_local" },
      qa: { adapterType: "claude_local" },
    });
  });

  it("uses the configured safe adapter default for bundled agents", async () => {
    const previousDefault = process.env.OUTPOST_TEAMS_CATALOG_DEFAULT_ADAPTER_TYPE;
    process.env.OUTPOST_TEAMS_CATALOG_DEFAULT_ADAPTER_TYPE = "opencode_local";
    try {
      const svc = teamsCatalogService(testDb as any);

      await svc.installCatalogTeam("space-1", "core-crew");

      const [importInput] = mockSpacePortabilityService.importBundle.mock.calls.at(-1)!;
      expect(importInput.adapterOverrides).toEqual({
        lead: { adapterType: "opencode_local" },
        "engineering-lead": { adapterType: "opencode_local" },
        qa: { adapterType: "opencode_local" },
      });
    } finally {
      if (previousDefault === undefined) {
        delete process.env.OUTPOST_TEAMS_CATALOG_DEFAULT_ADAPTER_TYPE;
      } else {
        process.env.OUTPOST_TEAMS_CATALOG_DEFAULT_ADAPTER_TYPE = previousDefault;
      }
    }
  });

  it("supplies safe adapter defaults for product-design and product-engineering installs", async () => {
    const svc = teamsCatalogService(testDb as any);

    await svc.installCatalogTeam("space-1", "product-design");
    const [designInput] = mockSpacePortabilityService.importBundle.mock.calls.at(-1)!;
    expect(designInput.adapterOverrides).toEqual({
      "ux-designer": { adapterType: "claude_local" },
    });

    await svc.installCatalogTeam("space-1", "product-engineering");
    const [engineeringInput] = mockSpacePortabilityService.importBundle.mock.calls.at(-1)!;
    expect(engineeringInput.adapterOverrides).toEqual({
      "engineering-lead": { adapterType: "claude_local" },
      qa: { adapterType: "claude_local" },
      "senior-coder": { adapterType: "claude_local" },
    });
  });

  it("never sends a forbidden process adapter type from the default catalog path", async () => {
    const svc = teamsCatalogService(testDb as any);

    await svc.installCatalogTeam("space-1", "core-crew");

    const [importInput] = mockSpacePortabilityService.importBundle.mock.calls.at(-1)!;
    const adapterTypes = Object.values(importInput.adapterOverrides as Record<string, { adapterType: string }>)
      .map((override) => override.adapterType);
    expect(adapterTypes).not.toContain("process");
    expect(adapterTypes).not.toContain("http");
  });

  it("preserves an explicit caller adapter override for the affected slug", async () => {
    const svc = teamsCatalogService(testDb as any);

    const callerOverrides = {
      "engineering-lead": { adapterType: "opencode_local", adapterConfig: { model: "anthropic/claude-opus-4" } },
    };
    await svc.installCatalogTeam("space-1", "core-crew", {
      adapterOverrides: callerOverrides,
    });

    const [importInput] = mockSpacePortabilityService.importBundle.mock.calls.at(-1)!;
    expect(importInput.adapterOverrides).toEqual({
      lead: { adapterType: "claude_local" },
      "engineering-lead": { adapterType: "opencode_local", adapterConfig: { model: "anthropic/claude-opus-4" } },
      qa: { adapterType: "claude_local" },
    });
    // Caller-supplied object must not be mutated in place.
    expect(callerOverrides).toEqual({
      "engineering-lead": { adapterType: "opencode_local", adapterConfig: { model: "anthropic/claude-opus-4" } },
    });
  });

  it("omits the default-adapter warning when every agent has an explicit override", async () => {
    const svc = teamsCatalogService(testDb as any);

    const result = await svc.installCatalogTeam("space-1", "core-crew", {
      adapterOverrides: {
        lead: { adapterType: "opencode_local" },
        "engineering-lead": { adapterType: "opencode_local" },
        qa: { adapterType: "opencode_local" },
      },
    });

    expect(result.warnings).not.toEqual(
      expect.arrayContaining([expect.stringContaining("default to claude_local")]),
    );
  });

  it("passes install secretValues through to space portability import", async () => {
    const svc = teamsCatalogService(testDb as any);

    await svc.installCatalogTeam("space-1", "core-crew", {
      secretValues: { "agent:lead:OPENAI_API_KEY": "sk-imported" },
    });

    expect(mockSpacePortabilityService.importBundle).toHaveBeenCalledWith(
      expect.objectContaining({
        secretValues: { "agent:lead:OPENAI_API_KEY": "sk-imported" },
      }),
      null,
      { mode: "agent_safe", sourceSpaceId: "space-1" },
    );
  });

  describe("readCatalogTeamProvenance", () => {
    it("reads catalogTeam provenance from agent metadata", () => {
      expect(
        readCatalogTeamProvenance({
          outpost: { catalogTeam: { catalogId: "team-x", catalogKey: "k", originHash: "sha256:1" } },
        }),
      ).toEqual({ catalogId: "team-x", catalogKey: "k", originHash: "sha256:1" });
    });

    it("returns null when there is no catalogTeam provenance", () => {
      expect(readCatalogTeamProvenance(null)).toBeNull();
      expect(readCatalogTeamProvenance({})).toBeNull();
      expect(readCatalogTeamProvenance({ outpost: { catalog: { skillKey: "s" } } })).toBeNull();
      expect(readCatalogTeamProvenance({ outpost: { catalogTeam: { originHash: "h" } } })).toBeNull();
    });
  });

  describe("listInstalledCatalogTeams", () => {
    it("marks a team out of date when an installed originHash differs from the catalog hash", async () => {
      mockAgentService.list.mockResolvedValue([
        agentWithCatalogTeam("sha256:stale-hash"),
        agentWithCatalogTeam("sha256:stale-hash"),
        { id: "no-provenance", spaceId: "space-1", metadata: null },
      ]);
      const svc = teamsCatalogService(testDb as any);

      const installed = await svc.listInstalledCatalogTeams("space-1");

      expect(mockAgentService.list).toHaveBeenCalledWith("space-1");
      expect(installed).toEqual([
        expect.objectContaining({
          catalogId: CORE_CREW_ID,
          present: true,
          currentContentHash: CORE_CREW_HASH,
          installedOriginHashes: ["sha256:stale-hash"],
          agentCount: 2,
          outOfDate: true,
        }),
      ]);
    });

    it("marks a team up to date when the installed originHash matches the catalog hash", async () => {
      mockAgentService.list.mockResolvedValue([agentWithCatalogTeam(CORE_CREW_HASH)]);
      const svc = teamsCatalogService(testDb as any);

      const installed = await svc.listInstalledCatalogTeams("space-1");

      expect(installed).toHaveLength(1);
      expect(installed[0]).toMatchObject({ present: true, outOfDate: false, agentCount: 1 });
    });

    it("does not flag teams that no longer resolve to a catalog entry", async () => {
      mockAgentService.list.mockResolvedValue([
        {
          id: "removed",
          spaceId: "space-1",
          metadata: { outpost: { catalogTeam: { catalogId: "outpost:bundled:gone:removed", originHash: "sha256:x" } } },
        },
      ]);
      const svc = teamsCatalogService(testDb as any);

      const installed = await svc.listInstalledCatalogTeams("space-1");

      expect(installed).toEqual([
        expect.objectContaining({ present: false, currentContentHash: null, outOfDate: false }),
      ]);
    });

    it("returns an empty list when no agents carry catalog-team provenance", async () => {
      mockAgentService.list.mockResolvedValue([{ id: "a", spaceId: "space-1", metadata: {} }]);
      const svc = teamsCatalogService(testDb as any);

      expect(await svc.listInstalledCatalogTeams("space-1")).toEqual([]);
    });
  });

  it("classifies unresolved and unsafe external skill requirements as blocked", () => {
    const fakeTeam: CatalogTeam = {
      id: "outpost:optional:test:unsafe",
      key: "outpost/optional/test/unsafe",
      kind: "optional",
      category: "test",
      slug: "unsafe",
      name: "Unsafe",
      description: "Unsafe",
      path: "catalog/optional/test/unsafe",
      entrypoint: "TEAM.md",
      schema: "agentcompanies/v1",
      defaultInstall: false,
      recommendedForSpaceTypes: [],
      tags: [],
      counts: { agents: 0, projects: 0, tasks: 0, routines: 0, localSkills: 0, catalogSkills: 0, externalSkillSources: 2 },
      rootAgentSlugs: [],
      agentSlugs: [],
      projectSlugs: [],
      requiredSkills: [
        { type: "github", ref: "https://github.com/acme/skill", agentSlugs: ["agent"], resolved: true, sourceLocator: "https://github.com/acme/skill" },
        { type: "catalog", ref: "missing", agentSlugs: ["agent"], resolved: false },
      ],
      envInputs: [],
      sourceRefs: [],
      files: [],
      trustLevel: "external_sources",
      compatibility: "compatible",
      contentHash: "sha256:test",
    };

    const result = collectCatalogTeamSkillPreparations(fakeTeam);

    expect(result.errors).toEqual([
      'External skill source "https://github.com/acme/skill" requires explicit source policy approval.',
      'Skill requirement "missing" is unresolved in catalog manifest.',
    ]);
    expect(result.preparations.map((entry) => entry.action)).toEqual(["blocked", "blocked"]);
  });
});
