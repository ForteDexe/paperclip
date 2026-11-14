import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { agents, spaces, createDb } from "@outpost/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { teamsCatalogService } from "../services/teams-catalog.js";

vi.mock("../services/agent-runner-selection.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../services/agent-runner-selection.js")>();
  return { ...actual, resolveNewAgentRunnerForSpace: async (_db: unknown, _spaceId: string, input: Parameters<typeof actual.resolveNewAgentRunnerForSpace>[2]) =>
    actual.resolveNewAgentRunner({ ...input, target: { driver: "local", platform: "linux", architecture: "x64", libc: "glibc", glibcVersion: "2.39" } }) };
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres teams catalog no-overrides install tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("teams catalog install with no caller adapter overrides", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let tempHome: string | null = null;
  let oldOutpostHome: string | undefined;

  beforeAll(async () => {
    oldOutpostHome = process.env.OUTPOST_HOME;
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "outpost-teams-catalog-no-overrides-"));
    process.env.OUTPOST_HOME = tempHome;
    tempDb = await startEmbeddedPostgresTestDatabase("outpost-teams-catalog-no-overrides-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterAll(async () => {
    if (oldOutpostHome === undefined) delete process.env.OUTPOST_HOME;
    else process.env.OUTPOST_HOME = oldOutpostHome;
    if (tempHome) await fs.rm(tempHome, { recursive: true, force: true });
    await tempDb?.cleanup();
  });

  async function seedEmptySpace() {
    const spaceId = randomUUID();
    await db.insert(spaces).values({
      id: spaceId,
      name: "Clean install space",
      issuePrefix: `T${spaceId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });
    return spaceId;
  }

  async function listAdapterTypesByName(spaceId: string, expectedOpenCodeName?: string) {
    const rows = await db
      .select({
        name: agents.name,
        role: agents.role,
        adapterType: agents.adapterType,
        adapterConfig: agents.adapterConfig,
        permissions: agents.permissions,
      })
      .from(agents)
      .where(eq(agents.spaceId, spaceId));
    for (const row of rows.filter(row => row.adapterType === "outpost_runner")) {
      expect(row.adapterConfig).toMatchObject(row.name === expectedOpenCodeName
        ? { provider: "opencode", model: "anthropic/claude-opus-4" }
        : { provider: "acpx", acpxAgent: "claude" });
    }
    return new Map(rows.map((row) => [row.name, row]));
  }

  it("installs core-exec-team end-to-end with no caller overrides and creates 3 native Claude agents", async () => {
    const spaceId = await seedEmptySpace();
    const svc = teamsCatalogService(db);

    const installed = await svc.installCatalogTeam(spaceId, "core-exec-team", {
      collisionStrategy: "rename",
      include: { projects: false, issues: false },
    });

    const byName = await listAdapterTypesByName(spaceId);
    expect(byName.size).toBe(3);
    const space = await db.query.spaces.findFirst({ where: eq(spaces.id, spaceId) });
    const saved = await db.select({ id: agents.id, name: agents.name }).from(agents).where(eq(agents.spaceId, spaceId));
    expect([...installed.resourceLinks].sort((a, b) => a.id.localeCompare(b.id))).toEqual(saved.map(agent => ({ kind: "agent", id: agent.id, name: agent.name,
      href: `/${space!.issuePrefix}/agents/${agent.id}` })).sort((a, b) => a.id.localeCompare(b.id)));


    const adapterTypes = Array.from(byName.values()).map((row) => row.adapterType);
    expect(adapterTypes).toEqual(["outpost_runner", "outpost_runner", "outpost_runner"]);
    expect(adapterTypes).not.toContain("process");
    expect(adapterTypes).not.toContain("http");
  });

  it("installs product-design end-to-end with no caller overrides and uses native Claude", async () => {
    const spaceId = await seedEmptySpace();
    const svc = teamsCatalogService(db);

    await svc.installCatalogTeam(spaceId, "product-design", {
      collisionStrategy: "rename",
      include: { projects: false, issues: false },
    });

    const byName = await listAdapterTypesByName(spaceId);
    expect(byName.size).toBe(1);
    const adapterTypes = Array.from(byName.values()).map((row) => row.adapterType);
    expect(adapterTypes).toEqual(["outpost_runner"]);
    expect(adapterTypes).not.toContain("process");
  });

  it("installs product-engineering end-to-end with no caller overrides and uses native Claude for every agent", async () => {
    const spaceId = await seedEmptySpace();
    const svc = teamsCatalogService(db);

    await svc.installCatalogTeam(spaceId, "product-engineering", {
      collisionStrategy: "rename",
      include: { projects: false, issues: false },
    });

    const byName = await listAdapterTypesByName(spaceId);
    expect(byName.size).toBe(3);
    const adapterTypes = Array.from(byName.values()).map((row) => row.adapterType);
    expect(adapterTypes).toEqual(["outpost_runner", "outpost_runner", "outpost_runner"]);
    expect(adapterTypes).not.toContain("process");
    expect(byName.get("Engineering Lead")?.permissions).toMatchObject({ canCreateAgents: true });
  });

  it("honors an explicit caller adapter override for a single slug while defaulting the rest to native Claude", async () => {
    const spaceId = await seedEmptySpace();
    const svc = teamsCatalogService(db);

    await svc.installCatalogTeam(spaceId, "core-exec-team", {
      collisionStrategy: "rename",
      include: { projects: false, issues: false },
      adapterOverrides: {
        engineering_lead: { adapterType: "opencode_local", adapterConfig: { model: "anthropic/claude-opus-4" } },
      },
    });

    const byName = await listAdapterTypesByName(spaceId, "Engineering Lead");
    expect(byName.size).toBe(3);
    const ctoRow = Array.from(byName.values()).find((row) => row.role === "engineering-manager" || row.name === "Engineering Lead");
    expect(ctoRow?.adapterType).toBe("outpost_runner");
    const otherAdapters = Array.from(byName.values())
      .filter((row) => row !== ctoRow)
      .map((row) => row.adapterType);
    expect(otherAdapters).toEqual(["outpost_runner", "outpost_runner"]);
  });
  it("derived catalog installs selected native runtime without caller overrides", async () => {
    const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "team-runtime-derived-pg-"));
    const oldDir = process.env.OUTPOST_TEAMS_CATALOG_DIR, oldDefault = process.env.OUTPOST_TEAMS_CATALOG_DEFAULT_ADAPTER_TYPE;
    try {
      const helper = await import("../../../tests/runner-e2e/chat-catalog-domains/external-team-runtime-fixture.js");
      Object.assign(process.env, await helper.teamRuntimeCatalogServerEnvironment({ repositoryRoot, temporaryRoot, executionIds: ["chat-features.runner-opencode.local.teams.install-team"] }));
      const spaceId = await seedEmptySpace();
      const { secretService } = await import("../services/secrets.js");
      const account = await secretService(db).create(spaceId, { name: "Derived package account", provider: "local_encrypted", value: "synthetic-model-free-account" });
      const manifest = JSON.parse(await fs.readFile(path.join(repositoryRoot, "packages/teams-catalog/generated/catalog.json"), "utf8"));
      const team = manifest.teams.find((row: {slug: string}) => row.slug === "product-engineering");
      const config = { provider: "opencode", model: "openrouter/deepseek/deepseek-v4.1-flash-1017", timeoutSec: 0, lifecycleMode: "per_turn", opencodePermissionMode: "allow", env: { OPENROUTER_API_KEY: { type: "secret_ref", secretId: account.id, version: "latest" } } };
      const derived = await helper.normalizeTeamRuntimeCatalog({ repositoryRoot, temporaryRoot, team, adapters: Object.fromEntries(team.agentSlugs.map((slug: string) => [slug, { adapterType: "outpost_runner", adapterConfig: config }])) });
      vi.resetModules();
      const { teamsCatalogService: actualService, getCatalogTeamOrThrow } = await import("../services/teams-catalog.js");
      expect((await getCatalogTeamOrThrow(team.id)).contentHash).toBe(derived.effectiveContentHash);
      const svc = actualService(db);
      const preview = await svc.previewCatalogTeamImport(spaceId, team.id, {});
      for (const member of preview.portabilityPreview.manifest.agents) expect(member.adapterConfig).toMatchObject(config);
      await svc.installCatalogTeam(spaceId, team.id, { collisionStrategy: "rename", include: { projects: false, issues: false } });
      const saved = await db.select().from(agents).where(eq(agents.spaceId, spaceId));
      expect(saved).toHaveLength(3);
      for (const member of saved) { expect(member.adapterType).toBe("outpost_runner"); expect(member.adapterConfig).toMatchObject(config); }
    } finally {
      if (oldDir === undefined) delete process.env.OUTPOST_TEAMS_CATALOG_DIR; else process.env.OUTPOST_TEAMS_CATALOG_DIR = oldDir;
      if (oldDefault === undefined) delete process.env.OUTPOST_TEAMS_CATALOG_DEFAULT_ADAPTER_TYPE; else process.env.OUTPOST_TEAMS_CATALOG_DEFAULT_ADAPTER_TYPE = oldDefault;
      await fs.rm(temporaryRoot, { recursive: true, force: true });
    }
  }, 30_000);

});
