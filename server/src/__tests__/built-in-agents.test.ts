import { createAgentLifecycle, configureAgentLifecycle } from "../services/agent-lifecycle.js";
import fs from "node:fs/promises";
import { fileHash } from "../services/agent-file-store.js";
import { stockHash } from "../services/managed-resource-drift.js";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  activityLog,
  heartbeatRuns,
  agentWakeupRequests,
  routineRuns,
  agentConfigRevisions,
  agents,
  approvals,
  budgetPolicies,
  builtInManagedResources,
  spaces,
  spaceMemberships,
  spaceSkillVersions,
  spaceSkills,
  createDb,
  issueThreadInteractions,
  issues,
  principalPermissionGrants,
  routines,
  routineTriggers,
} from "@outpost/db";
import { readOutpostSkillSyncPreference } from "@outpost/adapter-utils/server-utils";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { agentInstructionRevisionService } from "../services/agent-instruction-revisions.js";
import { agentInstructionsService } from "../services/agent-instructions.ts";
import { agentService } from "../services/agents.ts";
import { approvalService } from "../services/approvals.ts";
import {
  builtInAgentService as createBuiltInAgentService,
  deriveBuiltInAgentStatus,
  listBuiltInAgentDefinitions,
  readBuiltInTextWithFallback,
  reconcileBuiltInAgentsOnStartup,
  validateBuiltInAgentDefinitions,
} from "../services/built-in-agents.ts";
import { readBuiltInAgentMarker, withBuiltInAgentMarker } from "../lib/built-in-agent-metadata.ts";
import { issueThreadInteractionService } from "../services/issue-thread-interactions.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

const BUILT_IN_MARKER_UNIQUE_INDEX = "agents_space_built_in_agent_key_unique_idx";
// Mirrors migration 0192. Used to drop/restore the partial unique index when a
// test needs to simulate legacy duplicates that predate the constraint.
const BUILT_IN_MARKER_UNIQUE_INDEX_DDL = `
  CREATE UNIQUE INDEX IF NOT EXISTS "${BUILT_IN_MARKER_UNIQUE_INDEX}"
    ON "agents" ("space_id", ((metadata -> 'outpostBuiltInAgent' ->> 'key')))
    WHERE (metadata -> 'outpostBuiltInAgent' ->> 'key') IS NOT NULL
      AND status <> 'terminated'
`;

function issuePrefix(id: string) {
  return `T${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres built-in agent tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describe("built-in agent asset loading", () => {
  it("uses the first readable candidate path", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "outpost-built-in-agent-"));
    try {
      const first = path.join(dir, "missing.md");
      const second = path.join(dir, "asset.md");
      writeFileSync(second, "asset text", "utf8");

      expect(readBuiltInTextWithFallback(`asset:${randomUUID()}`, [first, second], "fallback text")).toBe("asset text");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back instead of throwing when built-in agent files are missing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const label = `missing:${randomUUID()}`;

    try {
      expect(readBuiltInTextWithFallback(label, [path.join(tmpdir(), label, "AGENTS.md")], "fallback text")).toBe(
        "fallback text",
      );
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(`Built-in agent asset ${label} was not readable`));
    } finally {
      warn.mockRestore();
    }
  });

  it("warns about non-missing read errors before falling back", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const dir = mkdtempSync(path.join(tmpdir(), "outpost-built-in-agent-"));
    const label = "unreadable:" + randomUUID();

    try {
      const directoryPath = path.join(dir, "asset.md");
      mkdirSync(directoryPath);

      expect(readBuiltInTextWithFallback(label, [directoryPath], "fallback text")).toBe("fallback text");
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("read error on " + directoryPath + ":"));
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("Built-in agent asset " + label + " was not readable"),
      );
    } finally {
      warn.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describeEmbeddedPostgres("built-in agents", () => {
  let db!: ReturnType<typeof createDb>;
  let lifecycleWorker: ReturnType<typeof configureAgentLifecycle>;
  function builtInAgentService(database: typeof db) {
    const service = createBuiltInAgentService(database);
    return { ...service,
      async ensure(...args: Parameters<typeof service.ensure>) {
        const result = await service.ensure(...args);
        if (result.agentId) await lifecycleWorker.process(result.agentId);
        return service.get(args[0], args[1]);
      },
      async get(...args: Parameters<typeof service.get>) {
        const result = await service.get(...args);
        if (result.agentId) await lifecycleWorker.process(result.agentId);
        return service.get(...args);
      },
    };
  }
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let runnerSelectionSpy: { mockRestore(): void } | undefined;
  const runnerTarget = { driver: "local", platform: "linux", architecture: "x64" };
  const instructionOperator = { type: "operator", userId: "local-operator", source: "local_implicit" } as const;
  async function writeInstructionEntry(agent: { id: string; spaceId: string }, entryFile: string, content: string) {
    const service = agentInstructionRevisionService(db);
    const target = { spaceId: agent.spaceId, agentId: agent.id };
    const baseline = await service.readCurrent(target, instructionOperator);
    await service.commit({ ...target, entryFile, content, baseRevisionId: baseline?.revision.id ?? null, source: "operator" }, instructionOperator);
    const refreshed = await agentService(db).getById(agent.id);
    return { adapterConfig: refreshed!.adapterConfig };
  }


  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("outpost-built-in-agents-");
    db = createDb(tempDb.connectionString);
    lifecycleWorker = configureAgentLifecycle(db, { requiredPluginIds: async () => [], runPlugin: async () => "complete", runHost: async () => "complete" });
  }, 20_000);

  beforeEach(async () => {
    runnerTarget.platform = "linux";
    runnerTarget.architecture = "x64";
    const selection = await import("../services/agent-runner-selection.js");
    runnerSelectionSpy = vi.spyOn(selection, "resolveNewAgentRunnerForSpace").mockImplementation(async (_db, _spaceId, input) =>
      selection.resolveNewAgentRunner({ ...input, target: runnerTarget }));
  });

  afterEach(async () => {
    runnerSelectionSpy?.mockRestore();
    await lifecycleWorker.sweep();
    await db.delete(routineTriggers);
    await db.delete(routines);
    await db.delete(issueThreadInteractions);
    await db.delete(issues);
    await db.delete(builtInManagedResources);
    await db.delete(spaceSkillVersions);
    await db.delete(spaceSkills);
    await db.delete(principalPermissionGrants);
    await db.delete(spaceMemberships);
    await db.delete(agentConfigRevisions);
    await db.delete(activityLog);
    await db.delete(approvals);
    await db.delete(agents);
    await db.delete(budgetPolicies);
    await db.delete(spaces);
    // Some tests drop the built-in marker unique index to simulate legacy
    // (pre-migration 0192) duplicates; restore it now that all rows are gone.
    await db.execute(sql.raw(BUILT_IN_MARKER_UNIQUE_INDEX_DDL));
  });

  afterAll(async () => {
    await lifecycleWorker.stop();
    await tempDb?.cleanup();
  });

  async function permissionKeysForAgent(agentId: string) {
    const grants = await db
      .select()
      .from(principalPermissionGrants)
      .where(eq(principalPermissionGrants.principalId, agentId));
    return grants.map((grant) => grant.permissionKey).sort();
  }

  async function seedSpace(options: { requireApproval?: boolean } = {}) {
    const spaceId = randomUUID();
    await db.insert(spaces).values({
      id: spaceId,
      name: "Outpost",
      issuePrefix: issuePrefix(spaceId),
      defaultResponsibleUserId: "responsible-user",
      requireOperatorApprovalForNewAgents: options.requireApproval ?? true,
    });
    return spaceId;
  }

  it("validates the static registry and rejects invalid definitions", () => {
    const definitions = listBuiltInAgentDefinitions();
    expect(definitions.map((definition) => definition.key).sort()).toEqual(["briefs", "learning", "reflection-coach"]);
    expect(() => validateBuiltInAgentDefinitions([
      {
        key: "briefs",
        displayName: "Briefs Agent",
        featureKeys: ["briefs"],
        shortPurpose: "One",
        defaultInstructions: "Do work",
        defaultRole: "general",
      },
      {
        key: "briefs",
        displayName: "Duplicate",
        featureKeys: ["duplicate"],
        shortPurpose: "Two",
        defaultInstructions: "Do work",
        defaultRole: "general",
      },
    ])).toThrow("Duplicate built-in agent key");
    expect(() => validateBuiltInAgentDefinitions([
      {
        key: "Bad Key",
        displayName: "Bad",
        featureKeys: ["bad"],
        shortPurpose: "Bad",
        defaultInstructions: "Bad",
        defaultRole: "general",
      },
    ])).toThrow("Invalid built-in agent key");
    expect(() => validateBuiltInAgentDefinitions([
      {
        key: "bad-default",
        displayName: "Bad default",
        featureKeys: ["bad-default"],
        shortPurpose: "Bad default adapter",
        defaultInstructions: "Do work",
        defaultRole: "general",
        allowedAdapterTypes: ["codex_local"],
        defaultAdapterType: "claude_local",
      },
    ])).toThrow("defaultAdapterType must be allowed");
  });

  it("retains the actual operator on a provisioned existing agent budget", async () => {
    const spaceId = await seedSpace({ requireApproval: false });
    const svc = builtInAgentService(db);
    const original = await svc.ensure(spaceId, "briefs");
    await svc.provision(spaceId, "briefs", { budgetMonthlyCents: 5000 }, { requestedByUserId: "budget-operator" });
    expect(await db.select().from(budgetPolicies).where(eq(budgetPolicies.scopeId, original.agentId!))).toMatchObject([{ amount: 5000, createdByUserId: "budget-operator" }]);
  });

  it.each([{ platform: "linux", architecture: "x64" }, { platform: "linux", architecture: "arm64" }, { platform: "darwin", architecture: "arm64" }, { platform: "darwin", architecture: "x64" }])("lazily provisions one agent per space/key and updates the same row on setup ($platform/$architecture)", async ({ platform, architecture }) => {
    runnerTarget.platform = platform;
    runnerTarget.architecture = architecture;
    const spaceId = await seedSpace();
    const svc = builtInAgentService(db);

    const created = await svc.ensure(spaceId, "briefs");
    expect(created.status).toBe("needs_setup");
    expect(created.agentId).toBeTruthy();
    expect(created.agent).toMatchObject({
      spaceId,
      name: "Briefs Agent",
      adapterConfig: {},
      status: "idle",
    });
    expect(readBuiltInAgentMarker(created.agent?.metadata)).toEqual({
      key: "briefs",
      featureKeys: ["briefs"],
    });

    const configured = await svc.ensure(spaceId, "briefs", {
      adapterType: "codex_local",
      adapterConfig: { model: "gpt-5.4" },
    });
    expect(configured.status).toBe("ready");
    expect(configured.agentId).toBe(created.agentId);
    expect(configured.agent).toMatchObject({
      adapterType: "outpost_runner",
      adapterConfig: { provider: "codex", model: "gpt-5.4" },
    });

    const reconciled = await svc.ensure(spaceId, "briefs");
    expect(reconciled.status).toBe("ready");
    expect(reconciled.agent).toMatchObject({
      adapterType: "outpost_runner",
      adapterConfig: { provider: "codex", model: "gpt-5.4" },
    });

    const rows = await db.select().from(agents).where(eq(agents.spaceId, spaceId));
    expect(rows).toHaveLength(1);
  });

  it("keeps existing legacy and native built-in runners through unrelated edits and startup", async () => {
    const spaceId = await seedSpace({ requireApproval: false });
    const svc = builtInAgentService(db);
    const savedSettings = { model: "gpt-5.5", modelReasoningEffort: "high", timeoutSec: 123 };
    const created = await svc.ensure(spaceId, "briefs", { adapterType: "codex_local", adapterConfig: savedSettings, runner: "legacy" });
    expect(created.agent?.adapterType).toBe("codex_local");
    await svc.ensure(spaceId, "briefs", { budgetMonthlyCents: 100 });
    await reconcileBuiltInAgentsOnStartup(db);
    const legacy = await svc.get(spaceId, "briefs");
    expect(legacy.agent?.adapterType).toBe("codex_local");
    expect(legacy.agent?.adapterConfig).toEqual(created.agent?.adapterConfig);
    const switched = await svc.ensure(spaceId, "briefs", { runner: "outpost" });
    expect(switched.agent).toMatchObject({ adapterType: "outpost_runner", adapterConfig: { provider: "codex", ...savedSettings } });
    await svc.ensure(spaceId, "briefs", { budgetMonthlyCents: 200 });
    await reconcileBuiltInAgentsOnStartup(db);
    expect((await svc.get(spaceId, "briefs")).agent?.adapterConfig).toEqual(switched.agent?.adapterConfig);
    const switchedBack = await svc.ensure(spaceId, "briefs", { runner: "legacy" });
    expect(switchedBack.agent).toMatchObject({ adapterType: "codex_local", adapterConfig: savedSettings });
    const switchedAgain = await svc.ensure(spaceId, "briefs", { runner: "outpost" });
    expect(switchedAgain.agent).toMatchObject({ adapterType: "outpost_runner", adapterConfig: { provider: "codex", ...savedSettings } });
    runnerTarget.platform = "win32";
    runnerTarget.architecture = "x64";
    const edited = await svc.ensure(spaceId, "briefs", { adapterType: "codex_local", adapterConfig: { model: "gpt-5.4" } });
    expect(edited.agent).toMatchObject({ adapterType: "outpost_runner", adapterConfig: { provider: "codex", model: "gpt-5.4" } });
  });

  it("freezes Codex built-in execution in the reviewed create through service restart", async () => {
    const spaceId = await seedSpace({ requireApproval: true });
    const result = await builtInAgentService(db).provision(spaceId, "briefs", { adapterType: "codex_local", adapterConfig: { model: "gpt-5.4" } }, { requestedByUserId: "operator-user" });
    expect(result.approval?.payload).toMatchObject({ adapterType: "outpost_runner", adapterConfig: { provider: "codex", model: "gpt-5.4" } });
    runnerTarget.platform = "win32";
    runnerTarget.architecture = "x64";
    await reconcileBuiltInAgentsOnStartup(db);
    await approvalService(db).approve(result.approval!.id, "operator-user");
    const approved = await builtInAgentService(db).get(spaceId, "briefs");
    expect(approved.agent?.adapterType).toBe(result.approval!.payload.adapterType);
    expect(approved.agent?.adapterConfig).toEqual(result.approval!.payload.adapterConfig);
  });

  it("records the human who enabled a built-in agent and leaves automatic creation unattributed", async () => {
    const enabledSpaceId = await seedSpace({ requireApproval: false });
    const automaticSpaceId = await seedSpace({ requireApproval: false });
    const builtIns = builtInAgentService(db);

    const enabled = await builtIns.provision(enabledSpaceId, "briefs", {}, { requestedByUserId: "operator-user" });
    const automatic = await builtIns.provision(automaticSpaceId, "briefs");

    expect(enabled.state.agent?.createdByUserId).toBe("operator-user");
    expect(automatic.state.agent?.createdByUserId).toBeNull();
  });

  it("routes policy-gated built-in provisioning through a pending create approval", async () => {
    const spaceId = await seedSpace();
    const builtIns = builtInAgentService(db);

    const result = await builtIns.provision(spaceId, "briefs", {
      adapterType: "process",
      adapterConfig: { command: "echo safe" },
      budgetMonthlyCents: 5000,
    }, { requestedByUserId: "operator-user" });

    expect(result.state).toMatchObject({
      status: "pending_approval",
      agent: {
        spaceId,
        name: "Briefs Agent",
        status: "pending_approval",
        adapterType: "process",
        adapterConfig: { command: "echo safe" },
        budgetMonthlyCents: 5000,
      },
    });
    expect(result.approval).toMatchObject({
      spaceId,
      type: "create_agent",
      status: "pending",
      requestedByUserId: "operator-user",
      requestedByAgentId: null,
      payload: {
        name: "Briefs Agent",
        role: "general",
        adapterType: "process",
        adapterConfig: { command: "echo safe" },
        budgetMonthlyCents: 5000,
        agentId: result.state.agentId,
        sourceBuiltInAgentKey: "briefs",
        featureKeys: ["briefs"],
      },
    });

    const rowsBeforeApproval = await db.select().from(agents).where(eq(agents.spaceId, spaceId));
    expect(rowsBeforeApproval).toHaveLength(1);
    expect(rowsBeforeApproval[0]).toMatchObject({ status: "pending_approval", createdByUserId: "operator-user" });

    await expect(builtIns.requireBuiltInAgent(spaceId, "briefs")).rejects.toMatchObject({
      status: 412,
      details: { code: "built_in_agent_not_configured", status: "pending_approval" },
    });

    await expect(agentService(db).update(result.state.agentId!, {
      adapterType: "process",
      adapterConfig: { command: "echo tampered" },
    })).rejects.toMatchObject({
      status: 409,
      details: {
        code: "pending_approval_agent_config_frozen",
        agentId: result.state.agentId,
        fields: ["adapterConfig"],
      },
    });

    await expect(builtIns.provision(spaceId, "briefs", {
      budgetMonthlyCents: 7500,
    })).rejects.toMatchObject({
      status: 409,
      details: {
        code: "built_in_agent_pending_approval",
        key: "briefs",
        agentId: result.state.agentId,
      },
    });

    await db
      .update(agents)
      .set({
        adapterType: "process",
        adapterConfig: { command: "echo tampered" },
      })
      .where(eq(agents.id, result.state.agentId!));

    await approvalService(db).approve(result.approval!.id, "operator-user", "Approved built-in agent");

    await expect(builtIns.get(spaceId, "briefs")).resolves.toMatchObject({
      status: "ready",
      agentId: result.state.agentId,
      agent: { status: "idle", adapterType: "process", adapterConfig: { command: "echo safe" }, budgetMonthlyCents: 5000 },
    });
  });

  it("blocks policy-gated built-in reconfiguration instead of applying adapter overrides immediately", async () => {
    const spaceId = await seedSpace();
    const builtIns = builtInAgentService(db);
    const ready = await builtIns.ensure(spaceId, "briefs", {
      adapterType: "codex_local",
      adapterConfig: { model: "gpt-5.4" },
    });

    await expect(builtIns.provision(spaceId, "briefs", {
      adapterType: "process",
      adapterConfig: { command: "echo bypass" },
    })).rejects.toMatchObject({
      status: 409,
      details: {
        code: "built_in_agent_reconfiguration_requires_approval",
        key: "briefs",
        agentId: ready.agentId,
      },
    });

    await expect(builtIns.get(spaceId, "briefs")).resolves.toMatchObject({
      status: "ready",
      agentId: ready.agentId,
      agent: { adapterType: "outpost_runner", adapterConfig: { provider: "codex", model: "gpt-5.4" } },
    });
  });

  it("completes first-time setup of a needs_setup built-in without a fresh operator approval", async () => {
    const spaceId = await seedSpace({ requireApproval: true });
    const builtIns = builtInAgentService(db);

    // A created-but-unconfigured built-in row: exists (its create was already
    // sanctioned) but its adapter config is still empty → `needs_setup`.
    const seeded = await builtIns.ensure(spaceId, "briefs");
    expect(seeded.status).toBe("needs_setup");

    // Configuring the adapter for the first time must apply directly instead of
    // throwing "adapter changes require operator approval".
    const result = await builtIns.provision(spaceId, "briefs", {
      adapterType: "codex_local",
      adapterConfig: { model: "gpt-5.4" },
      budgetMonthlyCents: 2500,
    }, { requestedByUserId: "operator-user" });

    expect(result.approval).toBeNull();
    expect(result.state).toMatchObject({
      status: "ready",
      agentId: seeded.agentId,
      agent: {
        status: "idle",
        adapterType: "outpost_runner",
        adapterConfig: { provider: "codex", model: "gpt-5.4" },
        budgetMonthlyCents: 2500,
      },
    });

    const rows = await db.select().from(agents).where(eq(agents.spaceId, spaceId));
    expect(rows).toHaveLength(1);
    const noApprovals = await db.select().from(approvals).where(eq(approvals.spaceId, spaceId));
    expect(noApprovals).toHaveLength(0);
  });

  it("rejects adapter types outside the built-in definition allowlist", async () => {
    const spaceId = await seedSpace();

    await expect(builtInAgentService(db).ensure(spaceId, "briefs", {
      adapterType: "http",
      adapterConfig: { url: "https://example.test/webhook" },
    })).rejects.toMatchObject({
      status: 422,
      details: {
        code: "built_in_agent_adapter_not_allowed",
        key: "briefs",
        allowedAdapterTypes: ["codex_local", "claude_local", "gemini_local", "opencode_local", "process"],
      },
    });
  });

  it("rejects unknown built-in adapter models before saving setup", async () => {
    const spaceId = await seedSpace();

    await expect(builtInAgentService(db).ensure(spaceId, "briefs", {
      adapterType: "codex_local",
      adapterConfig: { model: "gpt-unknown" },
    })).rejects.toMatchObject({
      status: 422,
      details: {
        code: "built_in_agent_model_unknown",
        key: "briefs",
        adapterType: "codex_local",
        model: "gpt-unknown",
      },
    });

    const rows = await db.select().from(agents).where(eq(agents.spaceId, spaceId));
    expect(rows).toHaveLength(0);
  });

  it("recovers an orphaned marked row instead of creating a duplicate", async () => {
    const spaceId = await seedSpace();
    const orphanId = randomUUID();
    await db.insert(agents).values({
      id: orphanId,
      spaceId,
      name: "Old Briefs",
      role: "general",
      status: "idle",
      adapterType: "codex_local",
      adapterConfig: { model: "gpt-5.4" },
      runtimeConfig: {},
      permissions: {},
      metadata: withBuiltInAgentMarker({ source: "orphan" }, { key: "briefs", featureKeys: ["briefs"] }),
    });

    const state = await builtInAgentService(db).ensure(spaceId, "briefs");

    expect(state.status).toBe("ready");
    expect(state.agentId).toBe(orphanId);
    const rows = await db.select().from(agents).where(eq(agents.spaceId, spaceId));
    expect(rows).toHaveLength(1);
  });

  it("derives not_provisioned, needs_setup, ready, and paused states", async () => {
    const spaceId = await seedSpace();
    const builtIns = builtInAgentService(db);

    await expect(builtIns.get(spaceId, "learning")).resolves.toMatchObject({ status: "not_provisioned" });

    const needsSetup = await builtIns.ensure(spaceId, "learning");
    expect(needsSetup.status).toBe("needs_setup");
    expect(deriveBuiltInAgentStatus(needsSetup.agent)).toBe("needs_setup");

    const ready = await builtIns.ensure(spaceId, "learning", {
      adapterType: "claude_local",
      adapterConfig: { model: "claude-sonnet-4-5" },
    });
    expect(ready.status).toBe("ready");

    await createAgentLifecycle(db).pauseAgent(ready.agentId!, "manual");
    await expect(builtIns.get(spaceId, "learning")).resolves.toMatchObject({
      status: "paused",
      agentId: ready.agentId,
      pauseReason: "manual",
    });
  });

  it("requires configured built-ins with typed precondition failures and paused warnings", async () => {
    const spaceId = await seedSpace();
    const builtIns = builtInAgentService(db);

    await expect(builtIns.requireBuiltInAgent(spaceId, "briefs")).rejects.toMatchObject({
      status: 412,
      details: {
        code: "built_in_agent_not_configured",
        key: "briefs",
        status: "not_provisioned",
        agentId: null,
      },
    });

    const needsSetup = await builtIns.ensure(spaceId, "briefs");
    await expect(builtIns.requireBuiltInAgent(spaceId, "briefs")).rejects.toMatchObject({
      status: 412,
      details: {
        code: "built_in_agent_not_configured",
        key: "briefs",
        status: "needs_setup",
        agentId: needsSetup.agentId,
      },
    });

    const ready = await builtIns.ensure(spaceId, "briefs", {
      adapterType: "codex_local",
      adapterConfig: { model: "gpt-5.4" },
    });
    await expect(builtIns.requireBuiltInAgent(spaceId, "briefs")).resolves.toMatchObject({
      agent: { id: ready.agentId },
      warning: null,
    });

    await createAgentLifecycle(db).pauseAgent(ready.agentId!, "maintenance");
    await expect(builtIns.requireBuiltInAgent(spaceId, "briefs")).resolves.toMatchObject({
      agent: { id: ready.agentId },
      warning: {
        code: "built_in_agent_paused",
        key: "briefs",
        agentId: ready.agentId,
        pauseReason: "maintenance",
      },
    });
  });

  it("resets marked agents back to registry display defaults without replacing adapter setup", async () => {
    const spaceId = await seedSpace();
    const builtIns = builtInAgentService(db);
    const ready = await builtIns.ensure(spaceId, "briefs", {
      adapterType: "codex_local",
      adapterConfig: { model: "gpt-5.4" },
    });

    await agentService(db).update(ready.agentId!, {
      name: "Custom Briefs",
      role: "engineer",
      title: "Custom",
      capabilities: "Custom purpose",
    });

    const reset = await builtIns.reset(spaceId, "briefs", {}, instructionOperator);

    expect(reset).toMatchObject({
      status: "ready",
      agentId: ready.agentId,
      agent: {
        name: "Briefs Agent",
        role: "general",
        title: null,
        capabilities: "Prepares concise operational briefs for the operator and agent space.",
        adapterType: "outpost_runner",
        adapterConfig: { provider: "codex", model: "gpt-5.4" },
      },
    });
  });

  it("reconciles an enabled Reflection Coach bundle with skill sync and a disabled routine", async () => {
    const spaceId = await seedSpace({ requireApproval: false });
    const root = await createAgentLifecycle(db).requestCreation(spaceId, {
      name: "Default agent",
      role: "lead",
      status: "idle",
      adapterType: "codex_local",
      adapterConfig: { model: "gpt-5.4", apiKey: "do-not-copy" },
      runtimeConfig: {},
      permissions: {},
    });

    // The Reflection Coach is opt-in (not auto-created). Enabling it on demand
    // materializes its managed bundle in a single pass.
    const enabled = await builtInAgentService(db).ensure(spaceId, "reflection-coach");
    expect(enabled.agent?.adapterConfig).toMatchObject({
      instructionsBundleMode: "managed",
      instructionsEntryFile: "AGENTS.md",
    });
    expect(enabled.agent?.adapterConfig).not.toMatchObject({ model: "gpt-5.4", apiKey: "do-not-copy" });

    // Startup reconcile keeps the enabled bundle tracking stock and re-grants
    // only permissions declared by built-in definitions. A root title adds none.
    const result = await reconcileBuiltInAgentsOnStartup(db);
    expect(result.autoEnsured).toBeGreaterThanOrEqual(1);
    expect(result.defaultGrantsEnsured).toBeGreaterThanOrEqual(2);

    const rootGrantKeys = await permissionKeysForAgent(root.id);
    expect(rootGrantKeys).toEqual(expect.arrayContaining([
      "agents:configure", "agents:suggest-changes", "skills:create", "skills:suggest-changes",
    ]));

    const state = await builtInAgentService(db).get(spaceId, "reflection-coach");
    expect(state).toMatchObject({
      status: "paused",
      agent: {
        spaceId,
        name: "Reflection Coach",
        role: "general",
        title: "Reflection Coach",
        icon: "eye",
        adapterType: "outpost_runner",
        permissions: {
          canCreateAgents: false,
          canCreateSkills: false,
        },
      },
    });
    expect(state.resources.map((resource) => [resource.resourceKind, resource.stockStatus])).toEqual([
      ["instructions", "stock_current"],
      ["skill", "stock_current"],
      ["routine", "stock_current"],
    ]);
    expect(state.resources.find((resource) => resource.resourceKind === "routine")).toMatchObject({
      resourceId: expect.any(String),
      scheduleEnabled: false,
    });

    const agentRows = await db.select().from(agents).where(eq(agents.spaceId, spaceId));
    expect(agentRows.filter((row) => readBuiltInAgentMarker(row.metadata)?.key === "reflection-coach")).toHaveLength(1);

    const [skill] = await db
      .select()
      .from(spaceSkills)
      .where(eq(spaceSkills.key, "outpost/bundled/outpost-operations/reflection-coach"));
    expect(skill).toMatchObject({
      key: "outpost/bundled/outpost-operations/reflection-coach",
      slug: "reflection-coach",
    });
    expect(readOutpostSkillSyncPreference(state.agent!.adapterConfig as Record<string, unknown>).desiredSkills).toContain(
      "outpost/bundled/outpost-operations/reflection-coach",
    );

    const [routine] = await db.select().from(routines).where(eq(routines.spaceId, spaceId));
    expect(routine).toMatchObject({
      title: "Review recent agent trajectories for coaching proposals",
      status: "paused",
      assigneeAgentId: state.agentId,
    });
    const [trigger] = await db.select().from(routineTriggers).where(eq(routineTriggers.routineId, routine!.id));
    expect(trigger).toMatchObject({
      kind: "schedule",
      enabled: false,
      cronExpression: "0 9 * * 1",
      timezone: "UTC",
    });
    const coachGrantKeys = await permissionKeysForAgent(state.agentId!);
    expect(coachGrantKeys).toEqual(expect.arrayContaining(["agents:suggest-changes", "skills:suggest-changes"]));
    expect(coachGrantKeys).not.toContain("agents:configure");
    expect(coachGrantKeys).not.toContain("skills:create");
  });

  it("recreates missing managed resource bindings idempotently during concurrent reconcile", async () => {
    const spaceId = await seedSpace({ requireApproval: false });
    await createAgentLifecycle(db).requestCreation(spaceId, {
      name: "Default agent",
      role: "lead",
      status: "idle",
      adapterType: "codex_local",
      adapterConfig: { model: "gpt-5.4" },
      runtimeConfig: {},
      permissions: {},
    });
    const builtIns = builtInAgentService(db);
    await builtIns.ensure(spaceId, "reflection-coach");
    await db.delete(builtInManagedResources).where(eq(builtInManagedResources.spaceId, spaceId));

    const states = await Promise.all([
      builtIns.ensure(spaceId, "reflection-coach"),
      builtIns.ensure(spaceId, "reflection-coach"),
    ]);

    expect(states).toHaveLength(2);
    for (const state of states) {
      expect(state.resources.map((resource) => [resource.resourceKind, resource.stockStatus])).toEqual([
        ["instructions", "stock_current"],
        ["skill", "stock_current"],
        ["routine", "stock_current"],
      ]);
    }
    const bindings = await db
      .select()
      .from(builtInManagedResources)
      .where(eq(builtInManagedResources.spaceId, spaceId));
    expect(bindings).toHaveLength(3);
    expect(new Set(bindings.map((binding) =>
      `${binding.bundleKey}:${binding.resourceKind}:${binding.resourceKey}`
    )).size).toBe(3);
  });

  it("preserves new-agent approval gates during on-demand Reflection Coach provisioning", async () => {
    const spaceId = await seedSpace({ requireApproval: true });
    const root = await createAgentLifecycle(db).requestCreation(spaceId, {
      name: "Default agent",
      role: "lead",
      status: "idle",
      adapterType: "codex_local",
      adapterConfig: { model: "gpt-5.4" },
      runtimeConfig: {},
      permissions: {},
    });
    const mutationPolicy = {
      requiresDisplayedDiff: true,
      requiresAcceptedTaskInteraction: true,
      applyInSeparateFollowUpRun: true,
    };

    // The Reflection Coach is opt-in, so it's enabled on demand. With operator
    // approval required, provisioning it must leave a pending agent + a
    // create_agent approval rather than an active agent.
    const provisioned = await builtInAgentService(db).provision(spaceId, "reflection-coach");
    expect(provisioned.approval).not.toBeNull();
    const state = await builtInAgentService(db).get(spaceId, "reflection-coach");
    expect(state).toMatchObject({
      status: "pending_approval",
      agent: {
        spaceId,
        name: "Reflection Coach",
        status: "pending_approval",
        leadAgentId: root.id,
        budgetMonthlyCents: 0,
        permissions: {
          builtInMutationPolicy: mutationPolicy,
        },
      },
    });
    expect(state.resources.map((resource) => resource.stockStatus)).toEqual(["missing", "missing", "missing"]);

    const allApprovals = await db.select().from(approvals).where(eq(approvals.spaceId, spaceId));
    const approval = allApprovals.find(
      (row) => (row.payload as { agentId?: string } | null)?.agentId === state.agentId,
    )!;
    expect(approval).toMatchObject({
      type: "create_agent",
      status: "pending",
      payload: {
        agentId: state.agentId,
        sourceBuiltInAgentKey: "reflection-coach",
        featureKeys: ["reflection-coach"],
        leadAgentId: root.id,
        permissions: expect.objectContaining({
          builtInMutationPolicy: mutationPolicy,
        }),
      },
    });

    const pendingReconcile = await reconcileBuiltInAgentsOnStartup(db);
    expect(pendingReconcile.pendingApprovals).toBe(1);
    const stillPending = await builtInAgentService(db).get(spaceId, "reflection-coach");
    expect(stillPending).toMatchObject({
      status: "pending_approval",
      agent: {
        adapterConfig: {},
        leadAgentId: root.id,
        status: "pending_approval",
      },
    });
    expect(stillPending.resources.map((resource) => resource.stockStatus)).toEqual([
      "missing",
      "missing",
      "missing",
    ]);

    await approvalService(db).approve(approval.id, "operator-user", "Approved Reflection Coach");
    const approvedState = await builtInAgentService(db).get(spaceId, "reflection-coach");
    expect(approvedState).toMatchObject({
      agent: {
        leadAgentId: root.id,
        permissions: {
          builtInMutationPolicy: mutationPolicy,
        },
      },
    });
    expect(approvedState.resources.map((resource) => resource.stockStatus)).toEqual([
      "stock_current",
      "stock_current",
      "stock_current",
    ]);

    await reconcileBuiltInAgentsOnStartup(db);
    const agentRows = await db.select().from(agents).where(eq(agents.spaceId, spaceId));
    expect(agentRows.filter((row) => readBuiltInAgentMarker(row.metadata)?.key === "reflection-coach")).toHaveLength(1);
    const approvalRows = await db.select().from(approvals).where(eq(approvals.spaceId, spaceId));
    expect(approvalRows).toHaveLength(1);
  });

  it("automatically upgrades untouched stock instructions while preserving personal files", async () => {
    const spaceId = await seedSpace({ requireApproval: false });
    const svc = builtInAgentService(db);
    const created = await svc.ensure(spaceId, "reflection-coach");
    const agent = created.agent!;
    const oldFiles = { "AGENTS.md": "# Previous stock instructions\n", "obsolete.txt": "old stock support" };
    await writeInstructionEntry(agent, "AGENTS.md", oldFiles["AGENTS.md"]);
    await agentInstructionsService(db).writeFile(agent, "obsolete.txt", oldFiles["obsolete.txt"]);
    await agentInstructionsService(db).writeFile(agent, "personal.txt", "keep my notes");
    await db.update(builtInManagedResources).set({ stockHash: stockHash(oldFiles), stockVersion: "previous",
      defaultsJson: { entryFile: "AGENTS.md", files: Object.keys(oldFiles) },
    }).where(and(eq(builtInManagedResources.spaceId, spaceId), eq(builtInManagedResources.resourceKind, "instructions")));
    const updated = await svc.ensure(spaceId, "reflection-coach");
    expect(updated.resources.find(resource => resource.resourceKind === "instructions")).toMatchObject({ stockStatus: "stock_current" });
    expect((await agentInstructionsService().readFile(updated.agent!, "AGENTS.md")).content).toContain("You are Reflection Coach");
    expect((await agentInstructionsService().readFile(updated.agent!, "personal.txt")).content).toBe("keep my notes");
    await expect(agentInstructionsService().readFile(updated.agent!, "obsolete.txt")).rejects.toMatchObject({ status: 404 });
    const [event] = await db.select().from(activityLog).where(and(eq(activityLog.spaceId, spaceId), eq(activityLog.actorId, "built-in-reconcile")));
    expect(event).toMatchObject({ actorType: "system", action: "agent.files_updated" });
  });

  it.each(["file", "database"])("retries a stock update after a %s failure without overwriting intervening edits", async (failure) => {
    const spaceId = await seedSpace({ requireApproval: false });
    const svc = builtInAgentService(db);
    const created = await svc.ensure(spaceId, "reflection-coach");
    const agent = created.agent!;
    const oldFiles = { "AGENTS.md": "# Old stock\n", "obsolete.txt": "old supporting file" };
    await writeInstructionEntry(agent, "AGENTS.md", oldFiles["AGENTS.md"]);
    await agentInstructionsService(db).writeFile(agent, "obsolete.txt", oldFiles["obsolete.txt"]);
    await db.update(builtInManagedResources).set({ stockHash: stockHash(oldFiles), stockVersion: "old",
      defaultsJson: { entryFile: "AGENTS.md", files: Object.keys(oldFiles) },
    }).where(and(eq(builtInManagedResources.spaceId, spaceId), eq(builtInManagedResources.resourceKind, "instructions")));
    const trigger = `stock_failure_${spaceId.replaceAll("-", "")}`;
    const remove = fs.rm.bind(fs);
    const fault = failure === "file" ? vi.spyOn(fs, "rm").mockImplementation(async (file, options) => {
      if (String(file).endsWith("/obsolete.txt")) throw new Error("injected stock file failure");
      return remove(file, options);
    }) : null;
    if (failure === "database") {
      await db.execute(sql.raw(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.space_id = '${spaceId}' AND NEW.resource_kind = 'instructions' AND NEW.stock_hash <> OLD.stock_hash THEN
          RAISE EXCEPTION 'injected stock binding failure'; END IF; RETURN NEW; END $$`));
      await db.execute(sql.raw(`CREATE TRIGGER ${trigger} BEFORE UPDATE ON built_in_managed_resources FOR EACH ROW EXECUTE FUNCTION ${trigger}()`));
    }
    try { await expect(svc.ensure(spaceId, "reflection-coach")).rejects.toThrow(); }
    finally {
      fault?.mockRestore();
      if (failure === "database") {
        await db.execute(sql.raw(`DROP TRIGGER ${trigger} ON built_in_managed_resources`));
        await db.execute(sql.raw(`DROP FUNCTION ${trigger}()`));
      }
    }
    const [pending] = await db.select().from(builtInManagedResources).where(and(eq(builtInManagedResources.spaceId, spaceId), eq(builtInManagedResources.resourceKind, "instructions")));
    expect(pending.defaultsJson.pendingInstructionsUpdate).toBeTruthy();
    expect(pending.stockHash).toBe(stockHash(oldFiles));
    const partial = (await agentInstructionsService().readFile(agent, "AGENTS.md")).content;
    expect(partial).toContain("You are Reflection Coach");
    // A real operator edit after the failed attempt must stop the retry.
    await writeInstructionEntry(agent, "AGENTS.md", "operator edit after failure");
    await svc.ensure(spaceId, "reflection-coach");
    expect((await agentInstructionsService().readFile(agent, "AGENTS.md")).content).toBe("operator edit after failure");
    await writeInstructionEntry(agent, "AGENTS.md", partial);
    const retried = await svc.ensure(spaceId, "reflection-coach");
    expect(retried.resources.find(resource => resource.resourceKind === "instructions")).toMatchObject({ stockStatus: "stock_current" });
    await expect(agentInstructionsService().readFile(agent, "obsolete.txt")).rejects.toMatchObject({ status: 404 });
    const [complete] = await db.select().from(builtInManagedResources).where(eq(builtInManagedResources.id, pending.id));
    expect(complete.defaultsJson.pendingInstructionsUpdate).toBeUndefined();
  });

  it.each([false, true])("supersedes an interrupted stock version, including rollback=%s", async (rollback) => {
    const spaceId = await seedSpace({ requireApproval: false });
    const svc = builtInAgentService(db);
    const created = await svc.ensure(spaceId, "reflection-coach");
    const agent = created.agent!;
    const currentStock = (await agentInstructionsService().readFile(agent, "AGENTS.md")).content;
    const oldFiles = { "AGENTS.md": rollback ? currentStock : "# Original stock" };
    const interruptedFiles = { "AGENTS.md": "# Intermediate stock", "intermediate-only.txt": "intermediate support" };
    await writeInstructionEntry(agent, "AGENTS.md", interruptedFiles["AGENTS.md"]);
    await agentInstructionsService(db).writeFile(agent, "intermediate-only.txt", interruptedFiles["intermediate-only.txt"]);
    await agentInstructionsService(db).writeFile(agent, "personal.txt", "personal notes");
    await db.update(builtInManagedResources).set({ stockHash: stockHash(oldFiles), stockVersion: "old",
      defaultsJson: { entryFile: "AGENTS.md", files: Object.keys(oldFiles), pendingInstructionsUpdate: {
        stockHash: stockHash(interruptedFiles),
        baseHashes: { "AGENTS.md": fileHash(Buffer.from(oldFiles["AGENTS.md"])), "intermediate-only.txt": null },
        nextHashes: Object.fromEntries(Object.entries(interruptedFiles).map(([file, text]) => [file, fileHash(Buffer.from(text))])),
      } },
    }).where(and(eq(builtInManagedResources.spaceId, spaceId), eq(builtInManagedResources.resourceKind, "instructions")));
    await writeInstructionEntry(agent, "AGENTS.md", "intervening operator edit");
    await svc.ensure(spaceId, "reflection-coach");
    expect((await agentInstructionsService().readFile(agent, "AGENTS.md")).content).toBe("intervening operator edit");
    await writeInstructionEntry(agent, "AGENTS.md", interruptedFiles["AGENTS.md"]);
    const updated = await svc.ensure(spaceId, "reflection-coach");
    expect(updated.resources.find(resource => resource.resourceKind === "instructions")).toMatchObject({ stockStatus: "stock_current" });
    expect((await agentInstructionsService().readFile(agent, "AGENTS.md")).content).toBe(currentStock);
    await expect(agentInstructionsService().readFile(agent, "intermediate-only.txt")).rejects.toMatchObject({ status: 404 });
    expect((await agentInstructionsService().readFile(agent, "personal.txt")).content).toBe("personal notes");
  });

  it("preserves Reflection Coach instruction drift on reconcile and restores it on reset", async () => {
    const spaceId = await seedSpace();
    const builtIns = builtInAgentService(db);
    const created = await builtIns.ensure(spaceId, "reflection-coach");
    const instructions = agentInstructionsService();

    await writeInstructionEntry(created.agent!, "AGENTS.md", "# Custom Reflection Coach\n\nOperator edit.\n");

    const reconciled = await builtIns.ensure(spaceId, "reflection-coach");
    const drift = reconciled.resources.find((resource) => resource.resourceKind === "instructions");
    expect(drift).toMatchObject({
      stockStatus: "operator_modified",
      updateAvailable: true,
      resetAvailable: true,
      changedFiles: ["AGENTS.md"],
    });
    await expect(instructions.readFile(reconciled.agent!, "AGENTS.md")).resolves.toMatchObject({
      content: "# Custom Reflection Coach\n\nOperator edit.\n",
    });

    const reset = await builtIns.reset(spaceId, "reflection-coach", {}, instructionOperator);
    expect(reset.resources.find((resource) => resource.resourceKind === "instructions")).toMatchObject({
      stockStatus: "stock_current",
      resetAvailable: false,
    });
    const resetFile = await instructions.readFile(reset.agent!, "AGENTS.md");
    expect(resetFile.content).toContain("Reflection Coach");
    expect(resetFile.content).not.toContain("Operator edit.");
    const revisions = agentInstructionRevisionService(db);
    const target = { spaceId, agentId: created.agent!.id, entryFile: "AGENTS.md" };
    const history = await revisions.history(target, instructionOperator);
    expect(history.revisions).toHaveLength(0);
    const current = await revisions.readCurrent(target, instructionOperator);
    expect(current?.content).toBe(resetFile.content);
  });

  it("blocks deleting a built-in agent", async () => {
    const spaceId = await seedSpace();
    const state = await builtInAgentService(db).ensure(spaceId, "briefs");

    await expect(agentService(db).remove(state.agentId!)).rejects.toMatchObject({
      status: 409,
      details: {
        code: "built_in_agent_undeletable",
        key: "briefs",
      },
    });
  });

  it("prevents direct marker add, remove, or mutation", async () => {
    const spaceId = await seedSpace();
    const builtIn = await builtInAgentService(db).ensure(spaceId, "briefs");
    const normal = await createAgentLifecycle(db).requestCreation(spaceId, {
      name: "Normal",
      role: "engineer",
      status: "idle",
      adapterType: "codex_local",
      adapterConfig: { model: "gpt-5.4" },
      runtimeConfig: {},
      permissions: {},
    });

    await expect(createAgentLifecycle(db).requestCreation(spaceId, {
      name: "Spoof",
      role: "engineer",
      status: "idle",
      adapterType: "codex_local",
      adapterConfig: { model: "gpt-5.4" },
      runtimeConfig: {},
      permissions: {},
      metadata: withBuiltInAgentMarker({}, { key: "briefs", featureKeys: ["briefs"] }),
    })).rejects.toMatchObject({ status: 409, details: { code: "built_in_agent_marker_readonly" } });

    await expect(agentService(db).update(normal.id, {
      metadata: withBuiltInAgentMarker({}, { key: "briefs", featureKeys: ["briefs"] }),
    })).rejects.toMatchObject({ status: 409, details: { code: "built_in_agent_marker_readonly" } });

    await expect(agentService(db).update(builtIn.agentId!, {
      metadata: { other: "metadata" },
    })).rejects.toMatchObject({ status: 409, details: { code: "built_in_agent_marker_readonly" } });

    await expect(agentService(db).update(builtIn.agentId!, {
      metadata: withBuiltInAgentMarker({}, { key: "learning", featureKeys: ["learning"] }),
    })).rejects.toMatchObject({ status: 409, details: { code: "built_in_agent_marker_readonly" } });

    await expect(agentService(db).update(builtIn.agentId!, {
      metadata: withBuiltInAgentMarker({ note: "allowed" }, { key: "briefs", featureKeys: ["briefs"] }),
    })).resolves.toMatchObject({
      id: builtIn.agentId,
      metadata: {
        note: "allowed",
        outpostBuiltInAgent: { key: "briefs", featureKeys: ["briefs"] },
      },
    });
  });

  it("repairs display/default drift for marked rows during startup reconciliation", async () => {
    const spaceId = await seedSpace();
    const agentId = randomUUID();
    await db.insert(agents).values({
      id: agentId,
      spaceId,
      name: "Old Name",
      role: "engineer",
      title: "Old title",
      capabilities: "Old purpose",
      status: "idle",
      adapterType: "codex_local",
      adapterConfig: { model: "gpt-5.4" },
      runtimeConfig: {},
      permissions: {},
      metadata: withBuiltInAgentMarker({}, { key: "briefs", featureKeys: ["old-briefs"] }),
    });

    const result = await reconcileBuiltInAgentsOnStartup(db);
    expect(result).toMatchObject({ unknown: 0, duplicates: 0 });
    expect(result.scanned).toBeGreaterThanOrEqual(1);
    expect(result.reconciled).toBeGreaterThanOrEqual(1);

    const [row] = await db.select().from(agents).where(eq(agents.id, agentId));
    expect(row).toMatchObject({
      name: "Briefs Agent",
      role: "general",
      title: null,
      capabilities: "Prepares concise operational briefs for the operator and agent space.",
    });
    expect(readBuiltInAgentMarker(row?.metadata)).toEqual({ key: "briefs", featureKeys: ["briefs"] });
  });

  // Reproduce a space that already carries duplicate marked rows from before
  // migration 0192 by dropping the unique index, inserting two active rows, and
  // pairing a pending create_agent approval with the newer one.
  async function seedLegacyDuplicateBriefs(spaceId: string) {
    await db.execute(sql.raw(`DROP INDEX IF EXISTS "${BUILT_IN_MARKER_UNIQUE_INDEX}"`));
    const olderId = randomUUID();
    const newerId = randomUUID();
    await db.insert(agents).values([
      {
        id: olderId,
        spaceId,
        name: "Briefs One",
        role: "general",
        status: "idle",
        adapterType: "codex_local",
        adapterConfig: { model: "gpt-5.4" },
        runtimeConfig: {},
        permissions: {},
        createdAt: new Date("2026-07-18T00:00:00.000Z"),
        metadata: withBuiltInAgentMarker({}, { key: "briefs", featureKeys: ["briefs"] }),
      },
      {
        id: newerId,
        spaceId,
        name: "Briefs Two",
        role: "general",
        status: "pending_approval",
        adapterType: "codex_local",
        adapterConfig: { model: "gpt-5.4" },
        runtimeConfig: {},
        permissions: {},
        createdAt: new Date("2026-07-18T00:00:00.025Z"),
        metadata: withBuiltInAgentMarker({}, { key: "briefs", featureKeys: ["briefs"] }),
      },
    ]);
    const approval = await approvalService(db).create(spaceId, {
      type: "create_agent",
      requestedByAgentId: null,
      requestedByUserId: null,
      status: "pending",
      payload: { agentId: newerId, sourceBuiltInAgentKey: "briefs", featureKeys: ["briefs"] },
      decisionNote: null,
      decidedByUserId: null,
      decidedAt: null,
      updatedAt: new Date(),
    });
    return { olderId, newerId, approvalId: approval!.id };
  }

  it("self-heals duplicate active instances, keeping the oldest and cancelling the newer's approval", async () => {
    const spaceId = await seedSpace();
    const { olderId, newerId, approvalId } = await seedLegacyDuplicateBriefs(spaceId);

    // A plain read resolves the duplicate rather than throwing.
    const state = await builtInAgentService(db).get(spaceId, "briefs");
    expect(state.agentId).toBe(olderId);

    const rows = await db.select().from(agents).where(eq(agents.spaceId, spaceId));
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(olderId)?.status).toBe("idle");
    expect(byId.get(newerId)?.status).toBe("terminated");
    expect(
      rows.filter((row) => row.status !== "terminated" && readBuiltInAgentMarker(row.metadata)?.key === "briefs"),
    ).toHaveLength(1);

    const [approval] = await db.select().from(approvals).where(eq(approvals.id, approvalId));
    expect(approval?.status).toBe("cancelled");
  });

  it("makes concurrent provisioning lose cleanly instead of creating duplicates", async () => {
    const spaceId = await seedSpace({ requireApproval: false });
    const svc = builtInAgentService(db);

    const [first, second] = await Promise.all([
      svc.ensure(spaceId, "briefs"),
      svc.ensure(spaceId, "briefs"),
    ]);

    expect(first.agentId).toBeTruthy();
    expect(second.agentId).toBe(first.agentId);

    const rows = await db.select().from(agents).where(eq(agents.spaceId, spaceId));
    expect(
      rows.filter((row) => row.status !== "terminated" && readBuiltInAgentMarker(row.metadata)?.key === "briefs"),
    ).toHaveLength(1);

    // The partial unique index now rejects any further active marked row.
    await expect(
      db.insert(agents).values({
        id: randomUUID(),
        spaceId,
        name: "Briefs Dupe",
        role: "general",
        status: "idle",
        adapterType: "codex_local",
        adapterConfig: { model: "gpt-5.4" },
        runtimeConfig: {},
        permissions: {},
        metadata: withBuiltInAgentMarker({}, { key: "briefs", featureKeys: ["briefs"] }),
      }),
    ).rejects.toMatchObject({
      cause: {
        code: "23505",
        constraint_name: BUILT_IN_MARKER_UNIQUE_INDEX,
      },
    });
  });

  it("makes concurrent operator-gated provisioning resolve to a single pending agent and approval", async () => {
    const spaceId = await seedSpace({ requireApproval: true });
    const svc = builtInAgentService(db);

    const results = await Promise.all([
      svc.provision(spaceId, "briefs"),
      svc.provision(spaceId, "briefs"),
    ]);

    const agentIds = new Set(results.map((result) => result.state.agentId));
    expect(agentIds.size).toBe(1);

    const rows = await db.select().from(agents).where(eq(agents.spaceId, spaceId));
    expect(
      rows.filter((row) => row.status !== "terminated" && readBuiltInAgentMarker(row.metadata)?.key === "briefs"),
    ).toHaveLength(1);

    const openApprovals = await db
      .select()
      .from(approvals)
      .where(and(eq(approvals.spaceId, spaceId), eq(approvals.status, "pending")));
    const briefsApprovals = openApprovals.filter(
      (row) => (row.payload as { sourceBuiltInAgentKey?: string } | null)?.sourceBuiltInAgentKey === "briefs",
    );
    expect(briefsApprovals).toHaveLength(1);
    // The winner returns its freshly created approval; the loser returns the
    // same approval or null (if it re-resolves before that row commits), never
    // a second one.
    expect(results.some((result) => result.approval?.id === briefsApprovals[0]!.id)).toBe(true);
    for (const result of results) {
      if (result.approval) {
        expect(result.approval.id).toBe(briefsApprovals[0]!.id);
      }
    }
  });

  it("self-heals duplicates during startup reconciliation without aborting later spaces", async () => {
    const affectedSpaceId = await seedSpace({ requireApproval: false });
    const { olderId, newerId } = await seedLegacyDuplicateBriefs(affectedSpaceId);
    // A second space created after the affected one — previously skipped
    // entirely because the duplicate error escaped the reconciliation loop.
    // Give it a drifted built-in row so we can prove reconcile still reached it.
    const healthySpaceId = await seedSpace({ requireApproval: false });
    const healthyBriefsId = randomUUID();
    await db.insert(agents).values({
      id: healthyBriefsId,
      spaceId: healthySpaceId,
      name: "Stale Briefs",
      role: "engineer",
      status: "idle",
      adapterType: "codex_local",
      adapterConfig: { model: "gpt-5.4" },
      runtimeConfig: {},
      permissions: {},
      metadata: withBuiltInAgentMarker({}, { key: "briefs", featureKeys: ["briefs"] }),
    });

    const result = await reconcileBuiltInAgentsOnStartup(db);
    expect(result.spaceFailures).toBe(0);

    const affectedRows = await db.select().from(agents).where(eq(agents.spaceId, affectedSpaceId));
    const affectedById = new Map(affectedRows.map((row) => [row.id, row]));
    expect(affectedById.get(olderId)?.status).toBe("idle");
    expect(affectedById.get(newerId)?.status).toBe("terminated");
    expect(
      affectedRows.filter(
        (row) => row.status !== "terminated" && readBuiltInAgentMarker(row.metadata)?.key === "briefs",
      ),
    ).toHaveLength(1);

    // The space after the affected one was still reconciled (its drifted
    // built-in row was repaired to stock) rather than skipped.
    const [healthyBriefs] = await db.select().from(agents).where(eq(agents.id, healthyBriefsId));
    expect(healthyBriefs?.name).toBe("Briefs Agent");
  });

  it("automatically materializes the Reflection Coach bundle without enabling background work", async () => {
    const spaceId = await seedSpace();
    const root = await createAgentLifecycle(db).requestCreation(spaceId, {
      name: "Default agent",
      role: "lead",
      status: "idle",
      adapterType: "codex_local",
      adapterConfig: { model: "gpt-5.4" },
      runtimeConfig: {},
      permissions: {},
    });

    const state = await builtInAgentService(db).ensure(spaceId, "reflection-coach");

    expect(state.agent).toMatchObject({
      spaceId,
      name: "Reflection Coach",
      title: "Reflection Coach",
      icon: "eye",
      leadAgentId: root.id,
      adapterType: "outpost_runner",
      budgetMonthlyCents: 0,
    });
    expect(state.status).toBe("paused");
    expect(readBuiltInAgentMarker(state.agent?.metadata)).toEqual({
      key: "reflection-coach",
      featureKeys: ["reflection-coach"],
    });
    expect(state.resources.map((resource) => [resource.resourceKind, resource.stockStatus])).toEqual([
      ["instructions", "stock_current"],
      ["skill", "stock_current"],
      ["routine", "stock_current"],
    ]);
    const reported = await builtInAgentService(db).get(spaceId, "reflection-coach");
    const reportedRoutine = reported.resources.find((resource) => resource.resourceKind === "routine");
    expect(reportedRoutine).toMatchObject({
      stockStatus: "stock_current",
      updateAvailable: false,
      resetAvailable: false,
    });
    expect(reportedRoutine?.currentHash).toBe(reportedRoutine?.stockHash);

    const [skill] = await db
      .select()
      .from(spaceSkills)
      .where(eq(spaceSkills.key, "outpost/bundled/outpost-operations/reflection-coach"));
    expect(skill).toMatchObject({
      key: "outpost/bundled/outpost-operations/reflection-coach",
      slug: "reflection-coach",
    });
    expect(readOutpostSkillSyncPreference(state.agent!.adapterConfig).desiredSkills).toContain(skill!.key);

    const [routine] = await db.select().from(routines).where(eq(routines.spaceId, spaceId));
    expect(routine).toMatchObject({
      title: "Review recent agent trajectories for coaching proposals",
      status: "paused",
      assigneeAgentId: state.agentId,
      originKind: "built_in_agent_bundle",
      originId: "reflection-coach:recent-agent-reflection",
    });
    const [trigger] = await db.select().from(routineTriggers).where(eq(routineTriggers.routineId, routine!.id));
    expect(trigger).toMatchObject({
      kind: "schedule",
      enabled: false,
      cronExpression: "0 9 * * 1",
      timezone: "UTC",
    });

    const grantKeys = await permissionKeysForAgent(state.agentId!);
    expect(grantKeys).toEqual(expect.arrayContaining(["agents:suggest-changes", "skills:suggest-changes"]));
    expect(grantKeys).not.toContain("tasks:assign");
    expect(grantKeys).not.toContain("agents:configure");
    expect(grantKeys).not.toContain("skills:create");
  });

  it("keeps a built-in routine task while the agent prepares", async () => {
    const spaceId = await seedSpace({ requireApproval: false });
    const builtIns = createBuiltInAgentService(db);
    const created = await builtIns.ensure(spaceId, "reflection-coach");
    await lifecycleWorker.stop();
    lifecycleWorker = configureAgentLifecycle(db, { requiredPluginIds: async () => [], runPlugin: async () => "complete", runHost: async () => "pending" });
    try {
      const result = await builtIns.runRoutine(spaceId, "reflection-coach", "recent-agent-reflection", { userId: "responsible-user" });
      expect(result.status).toBe("issue_created");
      const tasks = await db.select().from(issues).where(eq(issues.spaceId, spaceId));
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.assigneeAgentId).toBe(created.agentId);
      expect(await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.spaceId, spaceId)))
        .toEqual([expect.objectContaining({ status: "queued", agentId: created.agentId })]);
      // A second request during setup must not try to resume an already preparing agent.
      await expect(builtIns.runRoutine(spaceId, "reflection-coach", "recent-agent-reflection", { userId: "responsible-user" }))
        .resolves.toHaveProperty("id");
    } finally {
      await lifecycleWorker.stop();
      await db.delete(routineRuns).where(eq(routineRuns.spaceId, spaceId));
      await db.delete(heartbeatRuns).where(eq(heartbeatRuns.spaceId, spaceId));
      await db.delete(agentWakeupRequests).where(eq(agentWakeupRequests.spaceId, spaceId));
      lifecycleWorker = configureAgentLifecycle(db, { requiredPluginIds: async () => [], runPlugin: async () => "complete", runHost: async () => "complete" });
    }
  });

  it("controls the Reflection Coach routine schedule without enabling it by default", async () => {
    const spaceId = await seedSpace();
    await createAgentLifecycle(db).requestCreation(spaceId, {
      name: "Default agent",
      role: "lead",
      status: "idle",
      adapterType: "codex_local",
      adapterConfig: { model: "gpt-5.4" },
      runtimeConfig: {},
      permissions: {},
    });
    const builtIns = builtInAgentService(db);
    const created = await builtIns.ensure(spaceId, "reflection-coach");
    expect(created.status).toBe("paused");
    expect(created.resources.find((resource) => resource.resourceKind === "routine")).toMatchObject({
      stockStatus: "stock_current",
      scheduleEnabled: false,
    });

    const enabled = await builtIns.enableRoutineSchedule(
      spaceId,
      "reflection-coach",
      "recent-agent-reflection",
      { userId: "operator-user" },
    );
    await lifecycleWorker.process(enabled.agentId!);
    expect((await builtIns.get(spaceId, "reflection-coach")).status).toBe("needs_setup");
    expect(enabled.resources.find((resource) => resource.resourceKind === "routine")).toMatchObject({
      stockStatus: "stock_current",
      scheduleEnabled: true,
    });
    const [enabledRoutine] = await db.select().from(routines).where(eq(routines.spaceId, spaceId));
    const [enabledTrigger] = await db.select().from(routineTriggers).where(eq(routineTriggers.routineId, enabledRoutine!.id));
    expect(enabledRoutine).toMatchObject({ status: "active" });
    expect(enabledTrigger).toMatchObject({ enabled: true });

    const disabled = await builtIns.disableRoutineSchedule(
      spaceId,
      "reflection-coach",
      "recent-agent-reflection",
      { userId: "operator-user" },
    );
    expect(disabled.resources.find((resource) => resource.resourceKind === "routine")).toMatchObject({
      stockStatus: "stock_current",
      scheduleEnabled: false,
    });
    const [disabledRoutine] = await db.select().from(routines).where(eq(routines.id, enabledRoutine!.id));
    const [disabledTrigger] = await db.select().from(routineTriggers).where(eq(routineTriggers.id, enabledTrigger!.id));
    expect(disabledRoutine).toMatchObject({ status: "paused" });
    expect(disabledTrigger).toMatchObject({ enabled: false });
  });

  it("surfaces pending Reflection Coach proposal interactions on the routine resource", async () => {
    const spaceId = await seedSpace();
    await createAgentLifecycle(db).requestCreation(spaceId, {
      name: "Default agent",
      role: "lead",
      status: "idle",
      adapterType: "codex_local",
      adapterConfig: { model: "gpt-5.4" },
      runtimeConfig: {},
      permissions: {},
    });
    const created = await builtInAgentService(db).ensure(spaceId, "reflection-coach");
    const proposalIssueId = randomUUID();
    await db.insert(issues).values({
      id: proposalIssueId,
      spaceId,
      title: "Review Reflection Coach proposal",
      status: "in_review",
      priority: "medium",
      identifier: `${issuePrefix(spaceId)}-42`,
      issueNumber: 42,
      assigneeAgentId: created.agentId,
      createdByAgentId: created.agentId,
    });
    const interactionId = randomUUID();
    await db.insert(issueThreadInteractions).values({
      id: interactionId,
      spaceId,
      issueId: proposalIssueId,
      kind: "request_confirmation",
      status: "pending",
      continuationPolicy: "wake_assignee",
      title: "Review proposed coaching change",
      summary: "Accept or reject the proposed update.",
      createdByAgentId: created.agentId,
      payload: {
        version: 1,
        prompt: "Accept the proposed coaching change?",
        acceptLabel: "Accept",
        rejectLabel: "Reject",
      },
    });

    const state = await builtInAgentService(db).get(spaceId, "reflection-coach");

    expect(state.resources.find((resource) => resource.resourceKind === "routine")).toMatchObject({
      pendingUpdateInteractionId: interactionId,
      pendingUpdateIssueId: proposalIssueId,
      pendingUpdateIssueIdentifier: `${issuePrefix(spaceId)}-42`,
    });
  });

  it("gates Reflection Coach proposal mutations until an accepted follow-up apply step", async () => {
    const spaceId = await seedSpace();
    const agentsSvc = agentService(db);
  const agentsSvcLifecycle = createAgentLifecycle(db);
    await agentsSvcLifecycle.requestCreation(spaceId, {
      name: "Default agent",
      role: "lead",
      status: "idle",
      adapterType: "codex_local",
      adapterConfig: { model: "gpt-5.4" },
      runtimeConfig: {},
      permissions: {},
    });
    const target = await agentsSvcLifecycle.requestCreation(spaceId, {
      name: "Target Coder",
      role: "engineer",
      status: "idle",
      adapterType: "codex_local",
      adapterConfig: { model: "gpt-5.4" },
      runtimeConfig: {},
      permissions: {},
    });
    const created = await builtInAgentService(db).ensure(spaceId, "reflection-coach");
    const coach = created.agent!;
    const instructionsSvc = agentInstructionsService();
    const originalInstructions = "# Target Coder\n\nWork from the assigned issue.\n";
    const prepared = await writeInstructionEntry(target, "AGENTS.md", originalInstructions);
    let persistedTarget = (await agentsSvc.update(target.id, { adapterConfig: prepared.adapterConfig }))!;

    const interactionsSvc = issueThreadInteractionService(db);
    const applyAcceptedProposalFollowUp = async (input: {
      interactionId: string;
      nextInstructions: string;
    }) => {
      const interaction = await interactionsSvc.getById(input.interactionId);
      if (interaction?.kind !== "request_confirmation" || interaction.status !== "accepted") {
        return false;
      }
      const written = await writeInstructionEntry(persistedTarget, "AGENTS.md", input.nextInstructions);
      persistedTarget = (await agentsSvc.update(persistedTarget.id, { adapterConfig: written.adapterConfig }))!;
      return true;
    };
    const readTargetInstructions = async () =>
      (await instructionsSvc.readFile(persistedTarget, "AGENTS.md")).content;

    const proposalIssueId = randomUUID();
    await db.insert(issues).values({
      id: proposalIssueId,
      spaceId,
      title: "Review Reflection Coach proposal",
      status: "in_review",
      priority: "medium",
      identifier: `${issuePrefix(spaceId)}-43`,
      issueNumber: 43,
      assigneeUserId: "operator-user",
      createdByAgentId: coach.id,
    });
    const acceptedInstructions = `${originalInstructions}\nWhen finishing, name the exact verification command.\n`;
    const acceptedProposal = await interactionsSvc.create({
      id: proposalIssueId,
      spaceId,
    }, {
      kind: "request_confirmation",
      continuationPolicy: "wake_assignee_on_accept",
      title: "Review proposed coaching change",
      summary: "Accept or reject the proposed instruction diff.",
      payload: {
        version: 1,
        prompt: "Apply this Reflection Coach instruction diff in a follow-up run?",
        acceptLabel: "Accept",
        rejectLabel: "Reject",
        detailsMarkdown: [
          "```diff",
          " # Target Coder",
          "",
          " Work from the assigned issue.",
          "+When finishing, name the exact verification command.",
          "```",
        ].join("\n"),
        target: {
          type: "custom",
          key: `agent:${target.id}:instructions`,
          revisionId: "proposal-v1",
          label: "Target Coder AGENTS.md diff",
        },
      },
    }, {
      agentId: coach.id,
    });

    const accepted = await interactionsSvc.acceptInteraction(
      { id: proposalIssueId, spaceId, goalId: null, projectId: null },
      acceptedProposal.id,
      {},
      { userId: "operator-user" },
    );

    expect(accepted.interaction).toMatchObject({
      id: acceptedProposal.id,
      kind: "request_confirmation",
      status: "accepted",
    });
    expect(accepted.continuationIssue).toMatchObject({
      id: proposalIssueId,
      assigneeAgentId: coach.id,
      assigneeUserId: null,
      status: "todo",
    });
    expect(await readTargetInstructions()).toBe(originalInstructions);

    await expect(applyAcceptedProposalFollowUp({
      interactionId: acceptedProposal.id,
      nextInstructions: acceptedInstructions,
    })).resolves.toBe(true);
    expect(await readTargetInstructions()).toBe(acceptedInstructions);

    const rejectedProposal = await interactionsSvc.create({
      id: proposalIssueId,
      spaceId,
    }, {
      kind: "request_confirmation",
      continuationPolicy: "wake_assignee_on_accept",
      idempotencyKey: "reflection-coach:proposal-v2",
      title: "Review rejected coaching change",
      summary: "Rejecting this diff must not mutate the target instructions.",
      payload: {
        version: 1,
        prompt: "Apply this rejected Reflection Coach instruction diff?",
        acceptLabel: "Accept",
        rejectLabel: "Reject",
        detailsMarkdown: [
          "```diff",
          "+This rejected line must not be applied.",
          "```",
        ].join("\n"),
        target: {
          type: "custom",
          key: `agent:${target.id}:instructions`,
          revisionId: "proposal-v2",
          label: "Target Coder AGENTS.md rejected diff",
        },
      },
    }, {
      agentId: coach.id,
    });

    const rejected = await interactionsSvc.rejectInteraction(
      { id: proposalIssueId, spaceId },
      rejectedProposal.id,
      { reason: "Not the right rule." },
      { userId: "operator-user" },
    );

    expect(rejected).toMatchObject({
      id: rejectedProposal.id,
      kind: "request_confirmation",
      status: "rejected",
      result: expect.objectContaining({
        outcome: "rejected",
        reason: "Not the right rule.",
      }),
    });
    await expect(applyAcceptedProposalFollowUp({
      interactionId: rejectedProposal.id,
      nextInstructions: `${acceptedInstructions}\nThis rejected line must not be applied.\n`,
    })).resolves.toBe(false);
    expect(await readTargetInstructions()).toBe(acceptedInstructions);
  });

  it("preserves Reflection Coach stock drift until explicit reset", async () => {
    const spaceId = await seedSpace();
    const created = await builtInAgentService(db).ensure(spaceId, "reflection-coach");
    const agent = created.agent!;

    const instructionsSvc = agentInstructionsService();
    await writeInstructionEntry(agent, "AGENTS.md", "# Custom Reflection Coach\n\nDo not overwrite me.\n");
    await db
      .update(spaceSkills)
      .set({ markdown: "---\nname: reflection-coach\n---\n\n# Custom skill\n" })
      .where(eq(spaceSkills.spaceId, spaceId));
    await db
      .update(routines)
      .set({ title: "DRIFTED BY TEST - do not clobber" })
      .where(eq(routines.spaceId, spaceId));

    const drifted = await builtInAgentService(db).ensure(spaceId, "reflection-coach");
    expect(drifted.resources.find((resource) => resource.resourceKind === "instructions")).toMatchObject({
      stockStatus: "operator_modified",
      resetAvailable: true,
    });
    expect(drifted.resources.find((resource) => resource.resourceKind === "skill")).toMatchObject({
      stockStatus: "operator_modified",
      resetAvailable: true,
    });
    expect(drifted.resources.find((resource) => resource.resourceKind === "routine")).toMatchObject({
      stockStatus: "operator_modified",
      resetAvailable: true,
    });
    expect((await instructionsSvc.readFile(drifted.agent!, "AGENTS.md")).content).toContain("Do not overwrite me.");
    const [preservedRoutine] = await db.select().from(routines).where(eq(routines.spaceId, spaceId));
    expect(preservedRoutine?.title).toBe("DRIFTED BY TEST - do not clobber");

    const reset = await builtInAgentService(db).reset(spaceId, "reflection-coach", {
      resources: ["instructions", "routine"],
    }, instructionOperator);
    expect(reset.resources.find((resource) => resource.resourceKind === "instructions")).toMatchObject({
      stockStatus: "stock_current",
      resetAvailable: false,
    });
    expect(reset.resources.find((resource) => resource.resourceKind === "skill")).toMatchObject({
      stockStatus: "operator_modified",
      resetAvailable: true,
    });
    expect(reset.resources.find((resource) => resource.resourceKind === "routine")).toMatchObject({
      stockStatus: "stock_current",
      resetAvailable: false,
    });
    expect((await instructionsSvc.readFile(reset.agent!, "AGENTS.md")).content).toContain("You are Reflection Coach");
    const [resetRoutine] = await db.select().from(routines).where(eq(routines.spaceId, spaceId));
    expect(resetRoutine?.title).toBe("Review recent agent trajectories for coaching proposals");
  });
});
