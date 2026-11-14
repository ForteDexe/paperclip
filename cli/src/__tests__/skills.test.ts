import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerSkillsCommands } from "../commands/client/skills.js";
import { resolveSpaceSkillReference } from "../commands/client/skills.js";

const ORIGINAL_ENV = { ...process.env };

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: () => undefined,
    writeErr: () => undefined,
  });
  registerSkillsCommands(program);
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

function skill(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    spaceId: "space-1",
    key: "outpost/review-prs",
    slug: "review-prs",
    name: "Review PRs",
    description: "Review pull requests",
    markdown: "# Review PRs",
    sourceType: "local_path",
    sourceLocator: null,
    sourceRef: null,
    trustLevel: "markdown_only",
    compatibility: "compatible",
    fileInventory: [{ path: "SKILL.md", kind: "skill" }],
    metadata: null,
    createdAt: "2026-05-26T00:00:00.000Z",
    updatedAt: "2026-05-26T00:00:00.000Z",
    attachedAgentCount: 2,
    editable: true,
    editableReason: null,
    sourceLabel: null,
    sourceBadge: "local",
    sourcePath: null,
    ...overrides,
  };
}

function agent(overrides: Record<string, unknown> = {}) {
  return {
    id: "agent-1",
    spaceId: "space-1",
    name: "Coder",
    role: "engineer",
    status: "active",
    leadAgentId: null,
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    adapterType: "codex_local",
    adapterConfig: {},
    runtimeConfig: {},
    permissions: {},
    createdAt: "2026-05-26T00:00:00.000Z",
    updatedAt: "2026-05-26T00:00:00.000Z",
    ...overrides,
  };
}

describe("skills CLI helpers", () => {
  it("resolves skill refs by id, key, or unique normalized slug", () => {
    const rows = [
      skill({ id: "skill-a", key: "outpost/a", slug: "alpha", name: "Alpha" }),
      skill({ id: "skill-b", key: "outpost/b", slug: "beta-skill", name: "Beta" }),
    ];

    expect(resolveSpaceSkillReference(rows, "skill-a").key).toBe("outpost/a");
    expect(resolveSpaceSkillReference(rows, "outpost/b").id).toBe("skill-b");
    expect(resolveSpaceSkillReference(rows, "Beta Skill").id).toBe("skill-b");
  });

  it("rejects ambiguous slug refs", () => {
    const rows = [
      skill({ id: "skill-a", key: "outpost/a", slug: "same", name: "A" }),
      skill({ id: "skill-b", key: "outpost/b", slug: "same", name: "B" }),
    ];

    expect(() => resolveSpaceSkillReference(rows, "same")).toThrow(/Ambiguous skill slug/);
  });
});

describe("skills CLI commands", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let writeChunks: unknown[];

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.OUTPOST_API_URL;
    delete process.env.OUTPOST_API_KEY;
    delete process.env.OUTPOST_SPACE_ID;
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    writeChunks = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      writeChunks.push(chunk);
      return true;
    });
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("lists space skills as JSON through the shared client context", async () => {
    const rows = [skill()];
    fetchMock.mockResolvedValueOnce(jsonResponse(rows));

    await runCommand([
      "skills",
      "list",
      "--space-id",
      "space-1",
      "--api-base",
      "http://outpost.test",
      "--api-key",
      "token",
      "--json",
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://outpost.test/api/spaces/space-1/skills",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ authorization: "Bearer token" }),
      }),
    );
    expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual(rows);
  });

  it("resolves a skill slug before reading detail", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([skill()]))
      .mockResolvedValueOnce(jsonResponse({ ...skill(), usedByAgents: [] }));

    await runCommand([
      "skills",
      "show",
      "Review PRs",
      "--space-id",
      "space-1",
      "--api-base",
      "http://outpost.test",
      "--api-key",
      "token",
      "--json",
    ]);

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://outpost.test/api/spaces/space-1/skills/11111111-1111-1111-1111-111111111111",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("prints skill files as raw pipeable content in human mode", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([skill()]))
      .mockResolvedValueOnce(jsonResponse({
        skillId: "11111111-1111-1111-1111-111111111111",
        path: "SKILL.md",
        kind: "skill",
        content: "# Review PRs",
        language: "markdown",
        markdown: true,
        editable: true,
      }));

    await runCommand([
      "skills",
      "file",
      "review-prs",
      "--space-id",
      "space-1",
      "--api-base",
      "http://outpost.test",
      "--api-key",
      "token",
    ]);

    expect(logSpy).not.toHaveBeenCalled();
    expect(writeChunks.join("")).toBe("# Review PRs\n");
  });





  it("passes force to skill updates", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse([skill()]))
      .mockResolvedValueOnce(jsonResponse(skill({ sourceRef: "sha256:new" })));

    await runCommand([
      "skills",
      "update",
      "review-prs",
      "--force",
      "--space-id",
      "space-1",
      "--api-base",
      "http://outpost.test",
      "--api-key",
      "token",
      "--json",
    ]);

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://outpost.test/api/spaces/space-1/skills/11111111-1111-1111-1111-111111111111/install-update",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ force: true }),
      }),
    );
  });

  it("audits installed skill bytes through the server", async () => {
    const audit = {
      skillId: "11111111-1111-1111-1111-111111111111",
      installedHash: "sha256:installed",
      originHash: "sha256:origin",
      verdict: "warning",
      codes: ["network_reference"],
      findings: [{
        code: "network_reference",
        severity: "warning",
        message: "Skill content references network-capable commands or URLs.",
        path: "SKILL.md",
      }],
      scannedAt: "2026-05-26T00:00:00.000Z",
      scanVersion: "skills-audit-v1",
    };
    fetchMock
      .mockResolvedValueOnce(jsonResponse([skill()]))
      .mockResolvedValueOnce(jsonResponse(audit));

    await runCommand([
      "skills",
      "audit",
      "review-prs",
      "--space-id",
      "space-1",
      "--api-base",
      "http://outpost.test",
      "--api-key",
      "token",
      "--json",
    ]);

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://outpost.test/api/spaces/space-1/skills/11111111-1111-1111-1111-111111111111/audit",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual(audit);
  });


  it("syncs desired space skill refs to an agent and returns the runtime snapshot", async () => {
    const snapshot = {
      adapterType: "codex_local",
      supported: true,
      mode: "persistent",
      desiredSkills: ["outpost/review-prs"],
      entries: [
        {
          key: "outpost/review-prs",
          runtimeName: "review-prs",
          desired: true,
          managed: true,
          required: false,
          state: "installed",
          origin: "space_managed",
          detail: null,
        },
      ],
      warnings: [],
    };
    fetchMock
      .mockResolvedValueOnce(jsonResponse(agent()))
      .mockResolvedValueOnce(jsonResponse(snapshot));

    await runCommand([
      "skills",
      "agent",
      "sync",
      "coder",
      "--skill",
      "review-prs",
      "--skill",
      "outpost/qa",
      "--mode",
      "add",
      "--space-id",
      "space-1",
      "--api-base",
      "http://outpost.test",
      "--api-key",
      "token",
      "--json",
    ]);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://outpost.test/api/agents/coder?spaceId=space-1",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://outpost.test/api/agents/agent-1/skills/sync",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ desiredSkills: ["review-prs", "outpost/qa"], mode: "add" }),
      }),
    );
    expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toEqual(snapshot);
  });
});
