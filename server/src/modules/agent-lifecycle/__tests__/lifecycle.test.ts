import { subscribeDatabaseWork } from "@outpost/db";
import { DELIVERY_QUEUES } from "../../../services/delivery-work-notifications.js";
import { resolveExternalTestDatabaseUrl } from "../../../__tests__/helpers/external-test-database.js";
import { createAgentLifecycle as createLifecycleCommands } from "../index.js";
import { createAgentLifecycleEffects } from "../../../services/agent-lifecycle.js";
import { deleteSpace } from "../../../services/space-deletion.js";
import { agentLifecycleSpaceDeletion } from "../space-deletion.js";
import { requireServerAdapter } from "../../../adapters/index.js";
import { agentExecutionsHaveStopped } from "../../../services/agent-execution-stop.js";
import { remoteTerminationReceipt } from "../../../services/remote-execution-termination.js";
import { approvalService } from "../../../services/approvals.js";
import { updateAgentConfigurationInTransaction } from "../../../services/agent-configuration-transaction.js";
import { agentService as agentConfiguration } from "../../../services/agents.js";
import { readFileSync } from "node:fs";
import express from "express";
import request from "supertest";
import { agentRoutes } from "../../../routes/agents.js";
import { errorHandler } from "../../../middleware/error-handler.js";
import { createLifecycleDriver } from "../../../services/agent-lifecycle-driver.js";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { agents, approvals, projects, issues, heartbeatRuns, nativeRunFinalizations, budgetPolicies, environmentLeases, environments, agentApiKeys, activityLog, agentConfigRevisions, userSpacePreferences, spaces, spaceMemberships, principalPermissionGrants, plugins, pluginSpaceSettings, applyPendingMigrations, closeRegisteredClients, createDb, type Db } from "@outpost/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../../../__tests__/helpers/embedded-postgres.js";
import { createAgentLifecycle, configureAgentLifecycle, startAgentLifecycle } from "../../../services/agent-lifecycle.js";
import { projectSpaceHolds } from "../adapters/space-policy.js";
import { createLifecycleStore as createStore } from "../adapters/postgres.js";
import { transition } from "../domain/policy.js";
import type { LifecycleAgent, LifecycleDriver } from "../application/ports.js";
import { budgetService } from "../../../services/budgets.js";
import { agentConfigurationRevision } from "../../../lib/agent-configuration-revision.js";

const createLifecycleStore = (db: Db) => createStore(db, createAgentLifecycleEffects());

const external = resolveExternalTestDatabaseUrl("OUTPOST_AGENT_LIFECYCLE_TEST_DATABASE_URL");
const support = external ? { supported: true } : await getEmbeddedPostgresTestSupport();
(support.supported ? describe : describe.skip)("agent lifecycle commands", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | undefined;
  let db: Db;
  let spaceId: string;
  const workers: ReturnType<typeof configureAgentLifecycle>[] = [];
  beforeAll(async () => {
    if (external) { await applyPendingMigrations(external); db = createDb(external, { maxConnections: 6 }); }
    else { database = await startEmbeddedPostgresTestDatabase("outpost-agent-lifecycle-"); db = createDb(database.connectionString); }
  }, 90_000);
  afterAll(async () => {
    for (const worker of workers) await worker.stop();
    if (external) await closeRegisteredClients(external);
    else await database?.cleanup();
  });
  beforeEach(async () => {
    for (const work of workers) await work.stop();
    spaceId = randomUUID();
    await db.insert(spaces).values({ id: spaceId, name: "Lifecycle test", issuePrefix: `L${spaceId.slice(0, 7)}` });
  });
  function worker(runHost: LifecycleDriver["runHost"] = async () => "complete") {
    const value = configureAgentLifecycle(db, { requiredPluginIds: async () => [], runPlugin: async () => "complete", runHost });
    workers.push(value); return value;
  }
  async function create(status = "idle") { return createAgentLifecycle(db).requestCreation(spaceId, { name: "Agent", status, adapterType: "process" }); }
  async function current(id: string) { return (await db.select().from(agents).where(eq(agents.id, id)))[0]!; }

  it.each((["codex", "claude"] as const).flatMap(provider => ["direct", "setup", "approval"].map(path => [provider, path] as const)))("defaults a newly created %s agent on a warm task environment to warm execution through %s", async (provider, path) => {
    const pluginId = randomUUID(), environmentId = randomUUID();
    await db.insert(plugins).values({ id: pluginId, pluginKey: pluginId, packageName: "warm-create-fixture", version: "1.0.0", status: "ready",
      manifestJson: { capabilities: ["environment.drivers.register"], environmentDrivers: [{ driverKey: "tasks", supportsTasks: true, warmTaskVersion: 1 }] } as never });
    await db.insert(environments).values({ id: environmentId, name: `Warm computer ${environmentId}`, driver: "plugin",
      config: { pluginKey: pluginId, driverKey: "tasks", driverConfig: {} } });
    const adapterConfig = provider === "claude" ? { provider: "acpx", acpxAgent: "claude", model: "claude-sonnet-4-6", lifecycleMode: "per_turn" }
      : { provider: "codex", model: "gpt-5.6-luna", lifecycleMode: "per_turn" };
    const lifecycle = createAgentLifecycle(db);
    const input = { name: "Warm create", adapterType: "outpost_runner", adapterConfig, defaultEnvironmentId: environmentId };
    const draft = path === "setup" ? await lifecycle.requestCreation(spaceId, input, { setupOnly: true }) : null;
    const created = await lifecycle.requestCreation(spaceId, { ...input, ...(path === "approval" ? { status: "pending_approval" } : {}) }, draft ? { setupAgentId: draft.id } : undefined);
    if (path === "approval") await lifecycle.approveCreation(created.id, "operator");
    expect((await current(created.id)).adapterConfig).toMatchObject({ ...adapterConfig, lifecycleMode: "warm" });
    await createAgentLifecycle(db).updateConfiguration(created.id, { adapterConfig: { ...(await current(created.id)).adapterConfig, lifecycleMode: "per_turn" } });
    expect((await current(created.id)).adapterConfig.lifecycleMode).toBe("per_turn");
  });

  it("rejects an outdated configuration snapshot under the write lock", async () => {
    const agent = await create();
    const snapshot = await current(agent.id);
    const expectedConfiguration = { adapterType: snapshot.adapterType, adapterConfig: snapshot.adapterConfig, runtimeConfig: snapshot.runtimeConfig, defaultEnvironmentId: snapshot.defaultEnvironmentId };
    await createAgentLifecycle(db).updateConfiguration(agent.id, { runtimeConfig: { heartbeat: { intervalSec: 42 } } });
    await expect(createAgentLifecycle(db).updateConfiguration(agent.id, { runtimeConfig: { aiConnection: {} } }, { expectedConfiguration })).rejects.toThrow("configuration changed while saving");
    expect((await current(agent.id)).runtimeConfig).toEqual({ heartbeat: { intervalSec: 42 } });
  });

  it("fences YAML saves under the write lock without treating runtime bookkeeping as an edit", async () => {
    const agent = await create();
    const revision = agentConfigurationRevision(await current(agent.id));
    await db.update(agents).set({ lastHeartbeatAt: new Date(), updatedAt: new Date() }).where(eq(agents.id, agent.id));
    await createAgentLifecycle(db).updateConfiguration(agent.id, { title: "New title" }, { expectedConfigurationRevision: revision });
    await expect(createAgentLifecycle(db).updateConfiguration(agent.id, { name: "Stale overwrite" }, { expectedConfigurationRevision: revision }))
      .rejects.toThrow("configuration changed while you were editing");
    expect(await current(agent.id)).toMatchObject({ name: agent.name, title: "New title" });
  });

  it("saves YAML configuration through the normal route with redaction, revisions, and access checks", async () => {
    const [agent] = await db.insert(agents).values({ spaceId, name: "YAML test", adapterType: "process",
      adapterConfig: { command: "echo", removeMe: true, env: { DEMO_VALUE: "private-fixture" }, apiKey: "private-api-fixture" },
      runtimeConfig: { heartbeat: { enabled: false } }, metadata: { token: "private-metadata-fixture" },
    }).returning();
    function app(actor: Express.Request["actor"]) {
      const app = express(); app.use(express.json());
      app.use((req, _res, next) => { req.actor = actor; next(); });
      app.use("/api", agentRoutes(db)); app.use(errorHandler); return app;
    }
    const operator = app({ type: "operator", source: "local_implicit", userId: "operator", spaceIds: [spaceId] });
    const response = await request(operator).get(`/api/agents/${agent.id}/configuration`).expect(200);
    expect(response.body).toMatchObject({ capabilities: null, budgetMonthlyCents: 0, defaultEnvironmentId: null });
    expect(JSON.stringify(response.body)).not.toContain("private-fixture");
    expect(JSON.stringify(response.body)).not.toContain("private-api-fixture");
    expect(JSON.stringify(response.body)).not.toContain("private-metadata-fixture");
    const adapterConfig = { ...response.body.adapterConfig, command: "printf" };
    delete adapterConfig.removeMe;
    const saved = await request(operator).patch(`/api/agents/${agent.id}`).send({
      adapterConfig, replaceAdapterConfig: true, title: "Updated using YAML",
      expectedConfigurationRevision: response.body.configurationRevision,
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.configurationRevision).not.toBe(response.body.configurationRevision);
    const persisted = await current(agent.id);
    expect(persisted.adapterConfig).toMatchObject({ command: "printf", env: { DEMO_VALUE: { type: "plain", value: "private-fixture" } }, apiKey: "private-api-fixture" });
    expect(persisted.adapterConfig).not.toHaveProperty("removeMe");
    expect(persisted.runtimeConfig).toEqual(agent.runtimeConfig);
    expect(persisted.metadata).toEqual(agent.metadata);
    expect(await db.select().from(agentConfigRevisions).where(eq(agentConfigRevisions.agentId, agent.id))).toHaveLength(1);
    expect(await db.select().from(activityLog).where(and(eq(activityLog.entityId, agent.id), eq(activityLog.action, "agent.updated")))).toHaveLength(1);
    await request(operator).patch(`/api/agents/${agent.id}`).send({ name: "Stale", expectedConfigurationRevision: response.body.configurationRevision }).expect(409);
    const foreign = app({ type: "operator", source: "session", userId: "outsider", spaceIds: [], memberships: [] });
    await request(foreign).get(`/api/agents/${agent.id}/configuration`).expect(404);
    await request(foreign).patch(`/api/agents/${agent.id}`).send({ title: "Denied", expectedConfigurationRevision: saved.body.configurationRevision }).expect(404);
  });

  it("maps existing states without starting setup or clearing pause reasons", async () => {
    const rows = await db.insert(agents).values(["idle", "running", "error", "paused", "pending_approval", "terminated"].map(status => ({
      spaceId, name: status, status, pauseReason: status === "paused" ? "budget" : null,
    }))).returning();
    const migration = readFileSync(new URL("../../../../../packages/db/src/migrations/0320_daily_onslaught.sql", import.meta.url), "utf8");
    await db.execute(sql.raw(migration.slice(migration.indexOf('UPDATE "agents"'))));
    for (const row of rows) {
      const mapped = await current(row.id);
      expect(mapped.lifecycleState).toBe(["paused", "pending_approval", "terminated"].includes(row.status) ? row.status : "ready");
      expect(mapped.lifecycleOperation).toBeNull();
      expect(mapped.lifecycleRequiredPluginIds).toBeNull();
      expect(mapped.lifecycleHolds).toEqual(row.status === "paused" ? ["budget"] : []);
    }
  });

  it("records the human creator from options and ignores a creator in the insert data", async () => {
    const lifecycle = createAgentLifecycle(db);
    const created = await lifecycle.requestCreation(spaceId, { name: "Created by member", createdByUserId: "spoofed-user" }, { createdByUserId: "member-1" });
    expect(created.createdByUserId).toBe("member-1");
    expect((await current(created.id)).createdByUserId).toBe("member-1");
    const system = await lifecycle.requestCreation(spaceId, { name: "System create", createdByUserId: "spoofed-user" });
    expect((await current(system.id)).createdByUserId).toBeNull();
  });

  it("backfills the creator from the earliest user creation activity in the same space", async () => {
    const [byUser, byAgent, foreign] = await db.insert(agents).values(["By user", "By agent", "Foreign log"].map(name => ({ spaceId, name }))).returning();
    const otherSpaceId = randomUUID();
    await db.insert(spaces).values({ id: otherSpaceId, name: "Other", issuePrefix: `O${otherSpaceId.slice(0, 7)}` });
    await db.insert(activityLog).values([
      { spaceId, actorType: "user", actorId: "first-user", action: "agent.create_created", entityType: "agent", entityId: byUser.id, createdAt: new Date("2026-01-01T00:00:00Z") },
      { spaceId, actorType: "user", actorId: "later-user", action: "agent.created", entityType: "agent", entityId: byUser.id, createdAt: new Date("2026-01-02T00:00:00Z") },
      { spaceId, actorType: "agent", actorId: randomUUID(), action: "agent.create_created", entityType: "agent", entityId: byAgent.id },
      { spaceId: otherSpaceId, actorType: "user", actorId: "foreign-user", action: "agent.created", entityType: "agent", entityId: foreign.id },
    ]);
    const migration = readFileSync(new URL("../../../../../packages/db/src/migrations/0343_new_mentor.sql", import.meta.url), "utf8");
    for (let pass = 0; pass < 2; pass++) {
      for (const statement of migration.split("--> statement-breakpoint")) {
        await db.execute(sql.raw(statement));
      }
    }
    expect((await current(byUser.id)).createdByUserId).toBe("first-user");
    expect((await current(byAgent.id)).createdByUserId).toBeNull();
    expect((await current(foreign.id)).createdByUserId).toBeNull();
  });

  it("commits the record before preparation and verifies before admission", async () => {
    const observed: string[] = [];
    const work = worker(async agent => {
      expect((await current(agent.id)).lifecycleState).toBe(agent.lifecycleState);
      observed.push(agent.lifecycleState); return "complete";
    });
    const agent = await create();
    expect(agent).toMatchObject({ lifecycleState: "preparing", status: "paused" });
    await work.process(agent.id);
    expect(observed).toEqual(["preparing", "verifying"]);
    expect(await current(agent.id)).toMatchObject({ lifecycleState: "ready", status: "idle" });
    expect(agent).not.toHaveProperty("lifecycleOperation");
  });




  it("freezes the final setup configuration for create approval", async () => {
    const lifecycle = createAgentLifecycle(db);
    const id = randomUUID();
    await lifecycle.requestCreation(spaceId, { id, name: "Approval setup", status: "paused", pauseReason: "setup", adapterType: "process" }, { setupOnly: true });
    await lifecycle.requestCreation(spaceId, { id, name: "Approval setup", status: "pending_approval", adapterType: "process", adapterConfig: { command: "verified-command" } }, { setupAgentId: id });
    expect(await current(id)).toMatchObject({ lifecycleState: "pending_approval", lifecycleHolds: [], adapterConfig: { command: "verified-command" } });
    await expect(lifecycle.updateConfiguration(id, { adapterConfig: { command: "changed" } })).rejects.toThrow("cannot be changed before operator approval");
  });

  it("rejects completing a foreign setup or adopting an ordinary paused agent", async () => {
    const lifecycle = createAgentLifecycle(db);
    const setup = await lifecycle.requestCreation(spaceId, { name: "Scoped setup", status: "paused", pauseReason: "setup" }, { setupOnly: true });
    const otherSpaceId = randomUUID();
    await db.insert(spaces).values({ id: otherSpaceId, name: "Other", issuePrefix: `S${otherSpaceId.slice(0, 7)}` });
    await expect(lifecycle.requestCreation(otherSpaceId, { name: "Foreign" }, { setupAgentId: setup.id })).rejects.toThrow("no longer available");
    const paused = await create("paused");
    await expect(lifecycle.requestCreation(spaceId, { name: "Paused" }, { setupAgentId: paused.id })).rejects.toThrow("no longer available");
    expect((await current(setup.id)).lifecycleHolds).toEqual(["setup"]);
  });


  it("creates a operator-owned setup before requesting approval for its final configuration", async () => {
    await db.update(spaces).set({ requireOperatorApprovalForNewAgents: true }).where(eq(spaces.id, spaceId));
    await db.insert(spaceMemberships).values(["operator", "other-creator"].map(principalId => ({ spaceId, principalType: "user", principalId, membershipRole: "member" })));
    await db.insert(principalPermissionGrants).values(["operator", "other-creator"].map(principalId => ({ spaceId, principalType: "user", principalId, permissionKey: "agents:create" })));
    function app(actor: Express.Request["actor"]) {
      const value = express(); value.use(express.json());
      value.use((req, _res, next) => { req.actor = actor; next(); });
      value.use("/api", agentRoutes(db)); value.use(errorHandler); return value;
    }
    const operator: Express.Request["actor"] = { type: "operator", source: "session", userId: "operator", spaceIds: [spaceId],
      memberships: [{ spaceId, membershipRole: "member", status: "active" }] };
    const setupId = randomUUID();
    const body = { setupId, name: "Wizard agent", adapterType: "process" };
    const url = `/api/spaces/${spaceId}/agents`;
    const attempts = await Promise.all(Array.from({ length: 4 }, () => request(app(operator)).post(url).send(body)));
    for (const attempt of attempts) {
      expect(attempt.status, JSON.stringify(attempt.body)).toBe(201);
      expect(attempt.body).toMatchObject({ id: setupId, pauseReason: "setup", lifecycleState: "paused" });
    }
    expect(await db.select().from(agents).where(eq(agents.spaceId, spaceId))).toHaveLength(1);
    expect(await db.select().from(spaceMemberships).where(and(eq(spaceMemberships.spaceId, spaceId), eq(spaceMemberships.principalType, "agent")))).toHaveLength(0);
    await request(app({ ...operator, userId: "other-creator" })).post(url).send(body).expect(404);
    const other = await createAgentLifecycle(db).requestCreation(spaceId, {
      name: "Other creator", adapterType: "process", status: "paused", adapterConfig: { command: "private-command" },
      runtimeConfig: { privateSetting: "private-value" },
    }, { createdByUserId: "other-creator" });
    const configProbe = await request(app(operator)).post(url).send({ ...body, setupId: other.id });
    expect(configProbe.status).toBe(404);
    expect(configProbe.body).not.toHaveProperty("adapterConfig");
    expect(configProbe.body).not.toHaveProperty("runtimeConfig");
    expect(await db.select().from(approvals).where(eq(approvals.spaceId, spaceId))).toHaveLength(0);
    const saved = await request(app(operator)).patch(`/api/agents/${setupId}`).send({ adapterConfig: { command: "draft-command", env: { SETUP_LABEL: { type: "plain", value: "saved-value" } } } });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const probe = vi.spyOn(requireServerAdapter("process"), "testEnvironment").mockResolvedValue({ adapterType: "process", status: "pass", checks: [], testedAt: new Date().toISOString() });
    try {
      const probeBody = { agentId: setupId, adapterConfig: saved.body.adapterConfig };
      const testUrl = `/api/spaces/${spaceId}/adapters/process/test-environment`;
      const tested = await request(app(operator)).post(testUrl).send(probeBody);
      expect(tested.status, JSON.stringify(tested.body)).toBe(200);
      expect(probe).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ env: { SETUP_LABEL: "saved-value" } }) }));
      await request(app({ ...operator, userId: "other-creator" })).post(testUrl).send(probeBody).expect(403);
      expect(probe).toHaveBeenCalledTimes(1);
    } finally { probe.mockRestore(); }
    await request(app({ ...operator, userId: "other-creator" })).patch(`/api/agents/${setupId}`).send({ adapterConfig: { command: "foreign-command" } }).expect(403);
    const denied = await request(app({ ...operator, spaceIds: [], memberships: [] })).post(url).send({ ...body, setupId: randomUUID() });
    expect([403, 404]).toContain(denied.status);
    await request(app({ type: "agent", source: "agent_key", spaceId, agentId: setupId })).post(url).send({ ...body, setupId: randomUUID() }).expect(403);
    const finished = await request(app(operator)).post(`/api/spaces/${spaceId}/agent-creations`).send({
      setupAgentId: setupId, name: "Wizard agent", adapterType: "process", adapterConfig: { command: "verified-command", env: { SETUP_LABEL: { type: "plain", value: "***REDACTED***" } } },
    });
    expect(finished.status, JSON.stringify(finished.body)).toBe(201);
    expect(finished.body.agent).toMatchObject({ id: setupId, name: "Wizard agent", lifecycleState: "pending_approval" });
    expect(finished.body.approval.payload).toMatchObject({ agentId: setupId, adapterConfig: { command: "verified-command" } });
    expect((await current(setupId)).adapterConfig.env).toEqual({ SETUP_LABEL: { type: "plain", value: "saved-value" } });
    expect(await db.select().from(spaceMemberships).where(and(eq(spaceMemberships.spaceId, spaceId), eq(spaceMemberships.principalId, setupId)))).toHaveLength(1);
    const finishBody = { setupAgentId: setupId, name: "Changed on retry", adapterType: "process", adapterConfig: { command: "unapproved-command" } };
    const createUrl = `/api/spaces/${spaceId}/agent-creations`;
    const retries = await Promise.all(Array.from({ length: 3 }, () => request(app(operator)).post(createUrl).send(finishBody)));
    for (const retry of retries) {
      expect(retry.status, JSON.stringify(retry.body)).toBe(200);
      expect(retry.body.agent).toMatchObject({ id: setupId, name: "Wizard agent", adapterConfig: { command: "verified-command" } });
      expect(retry.body.approval.id).toBe(finished.body.approval.id);
    }
    await request(app({ ...operator, userId: "other-creator" })).post(createUrl).send(finishBody).expect(403);
    const reopened = await request(app(operator)).post(url).send(body);
    expect(reopened.status).toBe(201);
    expect(reopened.body).toMatchObject({ id: setupId, status: "pending_approval" });
    await request(app({ ...operator, userId: "other-creator" })).post(url).send(body).expect(404);
    await db.delete(approvals).where(eq(approvals.id, finished.body.approval.id));
    const recovered = await request(app(operator)).post(createUrl).send(finishBody);
    expect(recovered.status, JSON.stringify(recovered.body)).toBe(200);
    expect(recovered.body.approval.payload).toMatchObject({ name: "Wizard agent", adapterConfig: { command: "verified-command" } });
    await approvalService(db).approve(recovered.body.approval.id, "operator");
    const approvedRetry = await request(app(operator)).post(createUrl).send(finishBody);
    expect(approvedRetry.status).toBe(200);
    expect(approvedRetry.body.approval.status).toBe("approved");
    expect(await db.select().from(approvals).where(eq(approvals.spaceId, spaceId))).toHaveLength(1);
  });

  it("restores hidden setup values when a native Codex record uses the Codex onboarding choice", async () => {
    await db.insert(spaceMemberships).values({ spaceId, principalType: "user", principalId: "operator", membershipRole: "owner" });
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => { req.actor = { type: "operator", source: "local_implicit", userId: "operator", spaceIds: [spaceId] }; next(); });
    app.use("/api", agentRoutes(db)); app.use(errorHandler);
    const setupId = randomUUID();
    const created = await request(app).post(`/api/spaces/${spaceId}/agents`).send({ setupId, name: "Native saved setup",
      adapterType: "outpost_runner", adapterConfig: { provider: "codex", env: { SETUP_LABEL: { type: "plain", value: "saved-native-value" } } },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.adapterConfig.env.SETUP_LABEL).toEqual({ type: "plain", value: "***REDACTED***" });
    const probe = vi.spyOn(requireServerAdapter("outpost_runner"), "testEnvironment").mockResolvedValue({ adapterType: "outpost_runner", status: "pass", checks: [], testedAt: new Date().toISOString() });
    try {
      const tested = await request(app).post(`/api/spaces/${spaceId}/adapters/codex_local/test-environment`).send({
        agentId: setupId, runner: "outpost", adapterConfig: created.body.adapterConfig,
      });
      expect(tested.status, JSON.stringify(tested.body)).toBe(200);
      expect(probe).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ env: { SETUP_LABEL: "saved-native-value" } }) }));
    } finally { probe.mockRestore(); }
    const finished = await request(app).post(`/api/spaces/${spaceId}/agent-creations`).send({ setupAgentId: setupId, name: "Native saved setup",
      adapterType: "codex_local", runner: "outpost", adapterConfig: created.body.adapterConfig,
    });
    expect(finished.status, JSON.stringify(finished.body)).toBe(201);
    expect((await current(setupId)).adapterConfig.env).toEqual({ SETUP_LABEL: { type: "plain", value: "saved-native-value" } });
  });

  it("holds an incomplete Copilot setup but still requires a model at final create", async () => {
    await db.insert(spaceMemberships).values({ spaceId, principalType: "user", principalId: "operator", membershipRole: "owner" });
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => { req.actor = { type: "operator", source: "local_implicit", userId: "operator", spaceIds: [spaceId] }; next(); });
    app.use("/api", agentRoutes(db)); app.use(errorHandler);
    const setupId = randomUUID();
    const body = { name: "Copilot setup", adapterType: "outpost_runner", adapterConfig: { provider: "acpx", acpxAgent: "copilot" } };
    const created = await request(app).post(`/api/spaces/${spaceId}/agents`).send({ ...body, setupId });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ id: setupId, pauseReason: "setup", lifecycleState: "paused" });
    const finished = await request(app).post(`/api/spaces/${spaceId}/agent-creations`).send({ ...body, setupAgentId: setupId });
    expect(finished.status, JSON.stringify(finished.body)).toBe(422);
    expect(finished.body.details?.code ?? finished.body.code).toBe("outpost_runner_acpx_model_required");
    expect((await current(setupId)).lifecycleHolds).toContain("setup");
    await request(app).post(`/api/spaces/${spaceId}/agents`).send(body).expect(422);
  });

  it("lets a held name-only record choose Copilot before connecting an account", async () => {
    await db.insert(spaceMemberships).values({ spaceId, principalType: "user", principalId: "operator", membershipRole: "owner" });
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => { req.actor = { type: "operator", source: "local_implicit", userId: "operator", spaceIds: [spaceId] }; next(); });
    app.use("/api", agentRoutes(db)); app.use(errorHandler);
    const setupId = randomUUID();
    await request(app).post(`/api/spaces/${spaceId}/agents`).send({ setupId, name: "Name-only Copilot", adapterType: "process", metadata: { setupAdapterPending: true } }).expect(201);
    const config = { provider: "acpx", acpxAgent: "copilot" };
    const saved = await request(app).patch(`/api/agents/${setupId}`).send({ adapterType: "outpost_runner", adapterConfig: config, metadata: { setupAdapterPending: false } });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toMatchObject({ id: setupId, pauseReason: "setup", adapterConfig: config });
    expect(saved.body.runtimeConfig.aiConnection).toBeUndefined();
    const finished = await request(app).post(`/api/spaces/${spaceId}/agent-creations`).send({ setupAgentId: setupId, name: "Name-only Copilot", adapterType: "outpost_runner", adapterConfig: { ...config, model: "gpt-5.6-luna" } });
    expect(finished.status, JSON.stringify(finished.body)).toBe(422);
    expect(finished.body.error).toMatch(/connection|account/i);
    expect((await current(setupId)).lifecycleHolds).toContain("setup");
  });

  it("saves the immediate create budget and actual operator audit in its transaction", async () => {
    const agent = await createAgentLifecycle(db).requestCreation(spaceId, { name: "Capped create", adapterType: "process", budgetMonthlyCents: 5000 }, { createdByUserId: "operator-user", initialBudgetPolicyUserId: "operator-user" });
    expect(await db.select().from(budgetPolicies).where(eq(budgetPolicies.scopeId, agent.id))).toMatchObject([{ amount: 5000 }]);
    const audit = await db.select().from(activityLog).where(and(eq(activityLog.spaceId, spaceId), eq(activityLog.action, "budget.policy_upserted")));
    expect(audit).toMatchObject([{ actorType: "user", actorId: "operator-user", agentId: null }]);
  });

  it("preserves trusted no-user provisioning without inventing initial operator authority", async () => {
    const agent = await createAgentLifecycle(db).requestCreation(spaceId, { name: "Internal declared budget", budgetMonthlyCents: 5000 });
    expect(agent.budgetMonthlyCents).toBe(5000);
    expect(await db.select().from(budgetPolicies).where(eq(budgetPolicies.scopeId, agent.id))).toHaveLength(0);
    expect(await db.select().from(activityLog).where(and(eq(activityLog.spaceId, spaceId), eq(activityLog.action, "budget.policy_upserted")))).toHaveLength(0);
  });

  it("credits only the approving operator for a positive-budget approval without a precreated agent", async () => {
    const approval = await approvalService(db).create(spaceId, { type: "create_agent", requestedByUserId: "requester", payload: { name: "Approved cap", role: "engineer", budgetMonthlyCents: 5000 } });
    await approvalService(db).approve(approval.id, "approver");
    expect(await db.select().from(budgetPolicies).where(eq(budgetPolicies.spaceId, spaceId))).toMatchObject([{ amount: 5000, createdByUserId: "approver" }]);
    expect(await db.select().from(activityLog).where(and(eq(activityLog.spaceId, spaceId), eq(activityLog.action, "budget.policy_upserted")))).toMatchObject([{ actorType: "user", actorId: "approver" }]);
  });

  it("does not activate a proposed create budget before human approval", async () => {
    const agent = await createAgentLifecycle(db).requestCreation(spaceId, { name: "Proposed cap", status: "pending_approval", budgetMonthlyCents: 5000 }, { createdByUserId: "operator-user", initialBudgetPolicyUserId: "operator-user" });
    expect(agent.budgetMonthlyCents).toBe(5000);
    expect(await db.select().from(budgetPolicies).where(eq(budgetPolicies.scopeId, agent.id))).toHaveLength(0);
  });

  it("rolls back the create, grants, policy and audit together when its initial budget write fails", async () => {
    const effects = createAgentLifecycleEffects();
    const setAgentBudget = vi.fn(async (...args: Parameters<typeof effects.setAgentBudget>) => {
      await effects.setAgentBudget(...args);
      throw new Error("Initial budget failed");
    });
    const lifecycle = createLifecycleCommands(db, { ...effects, setAgentBudget });
    await expect(lifecycle.requestCreation(spaceId, { name: "Budget rollback", adapterType: "process", budgetMonthlyCents: 5000 }, { createdByUserId: "operator-user", initialBudgetPolicyUserId: "operator-user" }))
      .rejects.toThrow("Initial budget failed");
    expect(setAgentBudget).toHaveBeenCalledWith(expect.anything(), expect.any(Array), spaceId, expect.any(String), 5000, "operator-user");
    expect(await db.select().from(agents).where(eq(agents.spaceId, spaceId))).toHaveLength(0);
    expect(await db.select().from(principalPermissionGrants).where(eq(principalPermissionGrants.spaceId, spaceId))).toHaveLength(0);
    expect(await db.select().from(budgetPolicies).where(eq(budgetPolicies.spaceId, spaceId))).toHaveLength(0);
    expect(await db.select().from(activityLog).where(eq(activityLog.spaceId, spaceId))).toHaveLength(0);
  });

  it("rolls back a create and its grants when create initialization fails", async () => {
    const effects = createAgentLifecycleEffects();
    const lifecycle = createLifecycleCommands(db, { ...effects,
      initializeCreate: async (tx, agent, options) => {
        await effects.initializeCreate(tx, agent, options);
        throw new Error("Create initialization failed");
      },
    });
    await expect(lifecycle.requestCreation(spaceId, { name: "Rollback create", adapterType: "process" }))
      .rejects.toThrow("Create initialization failed");
    expect(await db.select().from(agents).where(eq(agents.spaceId, spaceId))).toHaveLength(0);
    expect(await db.select().from(principalPermissionGrants).where(eq(principalPermissionGrants.spaceId, spaceId))).toHaveLength(0);
  });

  // H1 review: a budget resume continues only work its own budget stopped. The
  // pause records the holds and the space's pause reason on each run it stops.
  it("records what a pause stopped each active run for", async () => {
    const agent = await create();
    await db.update(spaces).set({ status: "paused", pauseReason: "budget" }).where(eq(spaces.id, spaceId));
    await db.update(agents).set({ lifecycleState: "pausing", lifecycleHolds: ["space_paused"] }).where(eq(agents.id, agent.id));
    const [run] = await db.insert(heartbeatRuns).values({ spaceId, agentId: agent.id, status: "queued" }).returning();
    await createLifecycleDriver(db, {} as never).runHost(await current(agent.id) as never);
    const [stopped] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, run.id));
    expect(stopped.status).toBe("cancelled");
    expect(stopped.resultJson).toMatchObject({ pauseStop: { holds: ["space_paused"], spacePauseReason: "budget" } });
  });

  // H1 review: a resume that removed the holds before the pause's Stop ran must
  // not erase why the pause stopped the run (the Stop itself stays owed).
  it("records the pause's original cause on runs it stops after a resume removed the holds", async () => {
    const agent = await create();
    await db.update(agents).set({ lifecycleState: "pausing", lifecycleHolds: [],
      lifecycleOperation: { id: randomUUID(), hostComplete: false, completedPluginIds: [], attempts: 0,
        pauseCause: { holds: ["budget"], spacePauseReason: null } } }).where(eq(agents.id, agent.id));
    const [run] = await db.insert(heartbeatRuns).values({ spaceId, agentId: agent.id, status: "queued" }).returning();
    await createLifecycleDriver(db, {} as never).runHost(await current(agent.id) as never);
    const [stopped] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, run.id));
    expect(stopped.status).toBe("cancelled");
    expect(stopped.resultJson).toMatchObject({ pauseStop: { holds: ["budget"], spacePauseReason: null } });
  });

  it("keeps a budget pause's cause when the budget is resumed before the pause's Stop runs", async () => {
    const agent = await create();
    await db.update(agents).set({ lifecycleState: "ready", status: "idle" }).where(eq(agents.id, agent.id));
    const [run] = await db.insert(heartbeatRuns).values({ spaceId, agentId: agent.id, status: "queued" }).returning();
    const { applyAgentBudgetHoldInTransaction } = await import("../../../services/agent-lifecycle.js");
    // The budget hold pauses the agent, then the raise removes it before the
    // lifecycle worker has run the pause's Stop.
    await db.transaction(tx => applyAgentBudgetHoldInTransaction(tx as never, spaceId, agent.id, true));
    await db.transaction(tx => applyAgentBudgetHoldInTransaction(tx as never, spaceId, agent.id, false));
    const paused = await current(agent.id);
    expect(paused).toMatchObject({ lifecycleState: "pausing", lifecycleHolds: [] });
    await createLifecycleDriver(db, {} as never).runHost(paused as never);
    const [stopped] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, run.id));
    expect(stopped.resultJson).toMatchObject({ pauseStop: { holds: ["budget"] } });
  });

  it("records why a budget pause started on its lifecycle operation", async () => {
    const agent = await create();
    await db.update(agents).set({ lifecycleState: "ready", status: "idle" }).where(eq(agents.id, agent.id));
    await db.update(spaces).set({ status: "paused", pauseReason: "budget" }).where(eq(spaces.id, spaceId));
    const { applyAgentBudgetHoldInTransaction } = await import("../../../services/agent-lifecycle.js");
    await db.transaction(tx => applyAgentBudgetHoldInTransaction(tx as never, spaceId, agent.id, true));
    expect((await current(agent.id)).lifecycleOperation).toMatchObject({
      pauseCause: { holds: ["budget"], spacePauseReason: "budget" } });
  });

  it("runs the saved harness test and keeps a failed configuration out of ready", async () => {
    const driver = createLifecycleDriver(db, {} as never);
    const work = worker(driver.runHost);
    const agent = await create();
    await work.process(agent.id);
    expect(await current(agent.id)).toMatchObject({ lifecycleState: "verifying", status: "paused" });
    await agentConfiguration(db).update(agent.id, { adapterConfig: { command: process.execPath } });
    await work.process(agent.id);
    expect(await current(agent.id)).toMatchObject({ lifecycleState: "ready", status: "idle", lifecycleError: null });
  });

  it.each(["claude_local", "gemini_local"])("keeps %s authentication warnings out of ready", async adapterType => {
    const adapter = requireServerAdapter(adapterType);
    const probe = vi.spyOn(adapter, "testEnvironment").mockResolvedValue({ adapterType, status: "warn",
      testedAt: new Date().toISOString(), checks: [{ code: `${adapterType.split("_")[0]}_hello_probe_auth_required`, level: "warn", message: "Login required" }] });
    try {
      const agent = await createAgentLifecycle(db).requestCreation(spaceId, { name: "Login test", adapterType, runner: "legacy" });
      const work = worker(createLifecycleDriver(db, {} as never).runHost);
      await work.process(agent.id);
      expect(probe).toHaveBeenCalled();
      expect(await current(agent.id)).toMatchObject({ lifecycleState: "verifying", lifecycleError: expect.stringContaining("Execution configuration check failed. Authentication failed.") });
    } finally { probe.mockRestore(); }
  });

  it("recovers an expired native owner only after the cancelled run and controller stop", async () => {
    const agent = await create();
    const [issue] = await db.insert(issues).values({ spaceId, title: "Cancelled native run" }).returning();
    const [run] = await db.insert(heartbeatRuns).values({ spaceId, agentId: agent.id, nativeIssueId: issue.id,
      status: "cancelled", invocationSource: "on_demand", runtimeMode: "native",
      startedAt: new Date(), finishedAt: new Date(), processPid: process.pid }).returning();
    await db.insert(nativeRunFinalizations).values({ spaceId, issueId: issue.id, runId: run.id,
      phase: "executing", leaseOwner: "stopped-server", leaseExpiresAt: new Date(0), controllerPid: process.pid });
    expect(await agentExecutionsHaveStopped(db, [agent.id])).toBe(false);
    await db.update(nativeRunFinalizations).set({ controllerPid: null }).where(eq(nativeRunFinalizations.runId, run.id));
    expect(await agentExecutionsHaveStopped(db, [agent.id])).toBe(false);
    await db.update(heartbeatRuns).set({ processPid: 2_000_000_000 }).where(eq(heartbeatRuns.id, run.id));
    await db.update(nativeRunFinalizations).set({ leaseExpiresAt: new Date(Date.now() + 60_000) }).where(eq(nativeRunFinalizations.runId, run.id));
    expect(await agentExecutionsHaveStopped(db, [agent.id])).toBe(false);
    await db.update(nativeRunFinalizations).set({ leaseExpiresAt: new Date(0) }).where(eq(nativeRunFinalizations.runId, run.id));
    expect(await agentExecutionsHaveStopped(db, [agent.id])).toBe(true);
    expect((await db.select().from(nativeRunFinalizations).where(eq(nativeRunFinalizations.runId, run.id)))[0]).toMatchObject({ leaseOwner: null, leaseExpiresAt: null });
  });

  it("releases an expired native owner whose renewed lease expiry has microsecond precision", async () => {
    const agent = await create();
    const [issue] = await db.insert(issues).values({ spaceId, title: "Renewed native run" }).returning();
    const [run] = await db.insert(heartbeatRuns).values({ spaceId, agentId: agent.id, nativeIssueId: issue.id,
      status: "cancelled", invocationSource: "on_demand", runtimeMode: "native",
      startedAt: new Date(), finishedAt: new Date(), processPid: 2_000_000_000 }).returning();
    await db.insert(nativeRunFinalizations).values({ spaceId, issueId: issue.id, runId: run.id,
      phase: "executing", leaseOwner: "stopped-server", leaseExpiresAt: new Date(0) });
    await db.update(nativeRunFinalizations)
      .set({ leaseExpiresAt: sql`'2020-01-01T00:00:00.123456Z'::timestamptz` })
      .where(eq(nativeRunFinalizations.runId, run.id));
    expect(await agentExecutionsHaveStopped(db, [agent.id])).toBe(true);
    expect((await db.select().from(nativeRunFinalizations).where(eq(nativeRunFinalizations.runId, run.id)))[0]).toMatchObject({ leaseOwner: null, leaseExpiresAt: null });
  });

  it("does not advance termination while a cancelled process still runs", async () => {
    const agent = await create();
    const [run] = await db.insert(heartbeatRuns).values({ spaceId, agentId: agent.id,
      status: "cancelled", invocationSource: "on_demand", runtimeMode: "legacy",
      startedAt: new Date(), finishedAt: new Date(), processPid: process.pid }).returning();
    const driver = createLifecycleDriver(db, {} as never);
    const work = worker(driver.runHost);
    await createAgentLifecycle(db).terminateAgent(agent.id);
    await work.process(agent.id);
    expect((await current(agent.id)).lifecycleState).toBe("terminating");
    await db.update(heartbeatRuns).set({ processPid: null,
      resultJson: { executionCancellation: { state: "acknowledged" } } }).where(eq(heartbeatRuns.id, run.id));
    await createAgentLifecycle(db).retry(agent.id);
    await work.process(agent.id);
    expect((await current(agent.id)).lifecycleState).toBe("terminated");
  });

  it("does not cancel a reporting agent when its manager pauses", async () => {
    const parent = await create();
    const [child] = await db.insert(agents).values({ spaceId, name: "Report", reportsTo: parent.id,
      status: "idle", lifecycleState: "ready" }).returning();
    const [run] = await db.insert(heartbeatRuns).values({ spaceId, agentId: child.id,
      status: "queued", invocationSource: "on_demand" }).returning();
    const work = worker(createLifecycleDriver(db, {} as never).runHost);
    await createAgentLifecycle(db).pauseAgent(parent.id);
    await work.process(parent.id);
    expect((await current(parent.id)).lifecycleState).toBe("paused");
    expect((await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.id, run.id)))[0]!.status).toBe("queued");
  });

  it("retains space data until every agent finishes termination", async () => {
    const agent = await create();
    const [project] = await db.insert(projects).values({ spaceId, name: "Keep until cleanup", leadAgentId: agent.id }).returning();
    await db.insert(issues).values({ spaceId, projectId: project.id, title: "Keep this task", assigneeAgentId: agent.id });
    const pending = worker(async () => "pending");
    await expect(deleteSpace(db, spaceId)).rejects.toThrow("Complete termination");
    expect(await db.select().from(projects).where(eq(projects.id, project.id))).toHaveLength(1);
    expect(await db.select().from(issues).where(eq(issues.spaceId, spaceId))).toHaveLength(1);
    await pending.stop();
    const complete = worker();
    await createAgentLifecycle(db).retry(agent.id);
    await complete.process(agent.id);
    await deleteSpace(db, spaceId);
    expect(await db.select().from(agents).where(eq(agents.spaceId, spaceId))).toHaveLength(0);
    expect(await db.select().from(spaces).where(eq(spaces.id, spaceId))).toHaveLength(0);
  });

  it("awaits only the deleted space's agents when a coordinator owns lifecycle wakeups", async () => {
    const agent = await create();
    const [otherSpace] = await db.insert(spaces).values({ name: "Unaffected", issuePrefix: `U${spaceId.slice(0, 7)}` }).returning();
    const [otherAgent] = await db.insert(agents).values({ spaceId: otherSpace.id, name: "Pending elsewhere",
      lifecycleState: "preparing", lifecycleOperation: { id: randomUUID(), hostComplete: false, completedPluginIds: [], attempts: 0 } }).returning();
    const phases: string[] = [];
    const work = startAgentLifecycle(db, { requiredPluginIds: async () => [], runPlugin: async () => "complete",
      runHost: async snapshot => { expect(snapshot.id).toBe(agent.id); phases.push(snapshot.lifecycleState); return "complete"; } }, () => true);
    const wake = vi.fn();
    work.setWake(wake);
    try {
      await deleteSpace(db, spaceId);
      expect(phases).toEqual(["terminating", "cleaning_up"]);
      expect(wake).toHaveBeenCalled();
      expect(await db.select().from(spaces).where(eq(spaces.id, spaceId))).toHaveLength(0);
      expect((await current(otherAgent.id)).lifecycleState).toBe("preparing");
    } finally { await work.stop(); }
  });

  it("requires a transaction for the space deletion integration", async () => {
    await expect(agentLifecycleSpaceDeletion.deleteSpaceData(db as never, spaceId))
      .rejects.toThrow("Space deletion requires a database transaction");
  });

  it("rejects individual deletion before cleanup and rolls back failed cleanup", async () => {
    const agent = await create();
    const effects = createAgentLifecycleEffects();
    const cleanup = vi.fn(effects.deleteDependencies);
    const lifecycle = createLifecycleCommands(db, { ...effects, deleteDependencies: cleanup });
    await expect(lifecycle.purgeAgent(agent.id)).rejects.toThrow("Complete termination");
    expect(cleanup).not.toHaveBeenCalled();

    await db.update(agents).set({ lifecycleState: "terminated", status: "terminated" }).where(eq(agents.id, agent.id));
    const [key] = await db.insert(agentApiKeys).values({ spaceId, agentId: agent.id, name: "Keep on rollback", keyHash: randomUUID() }).returning();
    cleanup.mockImplementation(async (tx, spaceId, id) => {
      await effects.deleteDependencies(tx, spaceId, id);
      throw new Error("Dependency cleanup failed");
    });
    await expect(lifecycle.purgeAgent(agent.id)).rejects.toThrow("Dependency cleanup failed");
    expect(await current(agent.id)).toMatchObject({ lifecycleState: "terminated" });
    expect(await db.select().from(agentApiKeys).where(eq(agentApiKeys.id, key.id))).toHaveLength(1);
  });

  it("deletes terminated and rejected agents only in the requested space", async () => {
    await db.insert(agents).values((["terminated", "rejected"] as const).map(lifecycleState => ({
      spaceId, name: lifecycleState, status: "terminated", lifecycleState,
    })));
    const [otherSpace] = await db.insert(spaces).values({ name: "Keep this space", issuePrefix: `K${spaceId.slice(0, 7)}` }).returning();
    const [otherAgent] = await db.insert(agents).values({ spaceId: otherSpace.id, name: "Keep this agent",
      status: "terminated", lifecycleState: "terminated" }).returning();

    await deleteSpace(db, spaceId);

    expect(await db.select().from(agents).where(eq(agents.spaceId, spaceId))).toHaveLength(0);
    expect(await current(otherAgent.id)).toMatchObject({ spaceId: otherSpace.id });
    expect(await db.select().from(spaces).where(eq(spaces.id, otherSpace.id))).toHaveLength(1);
  });

  it("rolls back agent and space data deletion when a later operation fails", async () => {
    const agent = await create("terminated");
    const [project] = await db.insert(projects).values({ spaceId, name: "Keep on rollback" }).returning();
    const removeAgents = agentLifecycleSpaceDeletion.deleteSpaceData;
    const failure = vi.spyOn(agentLifecycleSpaceDeletion, "deleteSpaceData").mockImplementation(async (tx, id) => {
      await removeAgents(tx, id);
      expect(await tx.select().from(agents).where(eq(agents.spaceId, id))).toHaveLength(0);
      throw new Error("Later deletion failed");
    });
    try {
      await expect(deleteSpace(db, spaceId)).rejects.toThrow("Later deletion failed");
      expect(await current(agent.id)).toMatchObject({ lifecycleState: "terminated" });
      expect(await db.select().from(projects).where(eq(projects.id, project.id))).toHaveLength(1);
      expect(await db.select().from(spaces).where(eq(spaces.id, spaceId))).toHaveLength(1);
    } finally { failure.mockRestore(); }
  });

  it("blocks a concurrent create until space deletion commits", async () => {
    let reportLock!: (pid: number) => void;
    let rejectLock!: (error: unknown) => void;
    const locked = new Promise<number>((resolve, reject) => { reportLock = resolve; rejectLock = reject; });
    let release!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    const removeAgents = agentLifecycleSpaceDeletion.deleteSpaceData;
    const pause = vi.spyOn(agentLifecycleSpaceDeletion, "deleteSpaceData").mockImplementation(async (tx, id) => {
      const [backend] = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      reportLock(backend!.pid);
      await released;
      await removeAgents(tx, id);
    });
    const deletion = deleteSpace(db, spaceId);
    void deletion.catch(rejectLock);
    let creation: Promise<unknown> | undefined;
    try {
      const pid = await locked;
      creation = create().then(() => "created", error => error.message);
      await vi.waitFor(async () => {
        const blocked = await db.execute(sql`select 1 from pg_stat_activity
          where datname = current_database() and ${pid} = any(pg_blocking_pids(pid))`);
        expect(blocked).toHaveLength(1);
      });
      release();
      await deletion;
      expect(await creation).toBe("Space not found");
      expect(await db.select().from(agents).where(eq(agents.spaceId, spaceId))).toHaveLength(0);
    } finally {
      release();
      await Promise.allSettled([deletion, creation]);
      pause.mockRestore();
    }
  });

  it("requires cleanup proof after a remote run is already cancelled", async () => {
    const agent = await create();
    const [run] = await db.insert(heartbeatRuns).values({ spaceId, agentId: agent.id,
      status: "cancelled", invocationSource: "on_demand", runtimeMode: "native",
      startedAt: new Date(), finishedAt: new Date() }).returning();
    const [lease] = await db.insert(environmentLeases).values({ spaceId, heartbeatRunId: run.id,
      provider: "test", providerLeaseId: "test-lease", status: "pending_cleanup",
      cleanupStatus: "failed", releasedAt: new Date() }).returning();
    expect(await agentExecutionsHaveStopped(db, [agent.id])).toBe(false);
    await db.update(environmentLeases).set({ status: "released", cleanupStatus: "success" })
      .where(eq(environmentLeases.id, lease.id));
    expect(await agentExecutionsHaveStopped(db, [agent.id])).toBe(false);
    await db.update(environmentLeases).set({ metadata: {
      remoteExecutionTermination: remoteTerminationReceipt(lease, { providerLeaseId: lease.providerLeaseId, state: "destroyed" }),
    } }).where(eq(environmentLeases.id, lease.id));
    expect(await agentExecutionsHaveStopped(db, [agent.id])).toBe(true);
  });

  it("does not prepare a proposed create until approval", async () => {
    const observed: string[] = [];
    const work = worker(async agent => { observed.push(agent.lifecycleState); return "complete"; });
    const agent = await create("pending_approval");
    await work.process(agent.id);
    expect(observed).toEqual([]);
    const approval = await approvalService(db).create(spaceId, { type: "create_agent", payload: { agentId: agent.id }, status: "pending" });
    await approvalService(db).approve(approval.id, "operator");
    await vi.waitFor(async () => expect((await current(agent.id)).lifecycleState).toBe("ready"));
    expect(observed).toEqual(["preparing", "verifying"]);
  });

  it.each(["approved", "rejected"] as const)("uses the same %s create decision for an agent and its approval", async decision => {
    const agent = await create("pending_approval");
    const approval = await approvalService(db).create(spaceId, { type: "create_agent",
      requestedByUserId: "requester", payload: { agentId: agent.id }, status: "pending" });
    const lifecycle = createAgentLifecycle(db);
    const decide = decision === "approved" ? lifecycle.approveCreation : lifecycle.rejectCreation;
    const first = await decide(agent.id, "operator");
    expect(first).toMatchObject({ applied: true, approval: { id: approval.id, status: decision },
      agent: { lifecycleState: decision === "approved" ? "preparing" : "rejected" } });
    const version = (await current(agent.id)).lifecycleVersion;
    expect(await decide({ approvalId: approval.id }, "operator")).toMatchObject({ applied: false, createApprovedAgentId: null });
    expect((await current(agent.id)).lifecycleVersion).toBe(version);
  });

  it("rolls back the approval and agent together when activation fails", async () => {
    const agent = await create("pending_approval");
    const approval = await approvalService(db).create(spaceId, { type: "create_agent",
      payload: { agentId: agent.id }, status: "pending" });
    const lifecycle = createLifecycleCommands(db, { ...createAgentLifecycleEffects(),
      recordCreation: async () => { throw new Error("Creation event failed"); } });
    await expect(lifecycle.approveCreation(agent.id, "operator")).rejects.toThrow("Creation event failed");
    expect((await current(agent.id)).lifecycleState).toBe("pending_approval");
    expect((await db.select().from(approvals).where(eq(approvals.id, approval.id)))[0].status).toBe("pending");
  });

  it("keeps the create credential owner and recovers it for migrated approvals", async () => {
    for (const savedOwner of [null, "original-owner"]) {
      const [agent] = await db.insert(agents).values({ spaceId, name: "Migrated create", status: "pending_approval",
        lifecycleState: "pending_approval", lifecycleOperation: savedOwner ? {
          id: randomUUID(), hostComplete: false, completedPluginIds: [], attempts: 0, responsibleUserId: savedOwner,
        } : null }).returning();
      const approval = await approvalService(db).create(spaceId, { type: "create_agent",
        requestedByUserId: "requesting-member", payload: { agentId: agent.id }, status: "pending" });
      await approvalService(db).approve(approval.id, "approving-member");
      expect((await current(agent.id)).lifecycleOperation?.responsibleUserId).toBe(savedOwner ?? "requesting-member");
    }
  });

  it("settles notice reactivation only with the outer lifecycle transaction", async () => {
    const work = worker();
    const agent = await create();
    await work.process(agent.id);
    await createAgentLifecycle(db).pauseAgent(agent.id);
    await work.process(agent.id);
    await work.stop();
    await createAgentLifecycle(db).resumeAgent(agent.id);
    const store = createLifecycleStore(db);
    const owner = "resume-notice-test";
    const claimed = await store.claim(agent.id, owner, new Date());
    expect(claimed).not.toBeNull();
    await store.setRequiredPlugins(claimed!, owner, []);
    await store.completeHost(claimed!, owner);
    const events: string[] = [];
    const unsubscribe = subscribeDatabaseWork(db, DELIVERY_QUEUES.chatFailedRetryNotices, (event, scopes) => {
      if ([...scopes ?? []].some(scope => JSON.parse(scope).spaceId === spaceId)) events.push(event);
    });
    try {
      await expect(db.transaction(async tx => {
        expect(await createLifecycleStore(tx as unknown as Db).change(agent.id, "complete", { owner }))
          .toMatchObject({ status: "idle", lifecycleState: "ready" });
        expect(events).toEqual(["intent"]);
        expect(await current(agent.id)).toMatchObject({ status: "paused", lifecycleState: "resuming" });
        throw new Error("rollback resumed agent");
      })).rejects.toThrow("rollback resumed agent");
      expect(events).toEqual(["intent", "settled"]);
      expect(await current(agent.id)).toMatchObject({ status: "paused", lifecycleState: "resuming" });
      events.length = 0;
      await db.transaction(async tx => {
        await createLifecycleStore(tx as unknown as Db).change(agent.id, "complete", { owner });
        expect(events).toEqual(["intent"]);
        expect((await current(agent.id)).status).toBe("paused");
      });
      expect(events).toEqual(["intent", "settled"]);
      expect(await current(agent.id)).toMatchObject({ status: "idle", lifecycleState: "ready" });
      events.length = 0;
      await store.change(agent.id, "reconcile");
      expect(events).toEqual([]);
    } finally { unsubscribe(); }
  });

  it("rejects transaction injection and generic state writes", async () => {
    const agent = await create("pending_approval");
    await expect(db.transaction(async tx => createAgentLifecycle(tx as unknown as Db))).rejects.toThrow("root database");
    await expect(agentConfiguration(db).update(agent.id, { status: "idle" } as never)).rejects.toThrow("lifecycle command");
    await expect(createAgentLifecycle(db).requestCreation(spaceId, { name: "Bypass", lifecycleRequiredPluginIds: [] } as never)).rejects.toThrow("Lifecycle fields");
  });

  it("clears a rejected create from the user's primary selection", async () => {
    const agent = await createAgentLifecycle(db).requestCreation(spaceId, { name: "Proposed", status: "pending_approval" }, { createdByUserId: "operator" });
    const preference = () => db.select().from(userSpacePreferences).where(eq(userSpacePreferences.spaceId, spaceId));
    expect((await preference())[0]!.primaryAgentId).toBe(agent.id);
    const approval = await approvalService(db).create(spaceId, { type: "create_agent", payload: { agentId: agent.id }, status: "pending" });
    await approvalService(db).reject(approval.id, "operator");
    expect((await preference())[0]!.primaryAgentId).toBeNull();
    expect((await current(agent.id)).lifecycleState).toBe("rejected");
  });

  it("rolls back configuration and its revision when the requested transition fails", async () => {
    const lifecycle = createAgentLifecycle(db);
    const agent = await create("terminated");
    await expect(lifecycle.updateAndTransition(agent.id, "resume", { name: "Must not persist" },
      { recordRevision: { createdByUserId: "operator", source: "patch" } })).rejects.toThrow("Cannot resume");
    expect((await current(agent.id)).name).toBe("Agent");
    expect(await db.select().from(agentConfigRevisions).where(eq(agentConfigRevisions.agentId, agent.id))).toEqual([]);
    const active = await create();
    expect(await lifecycle.updateAndTransition(active.id, "pause", { name: "Paused agent" })).toMatchObject({ name: "Paused agent", lifecycleState: "pausing" });
  });

  it("preserves a disabled positive budget at approval and applies explicit configuration changes", async () => {
    const agent = await create("pending_approval");
    const budgets = budgetService(db);
    await budgets.upsertPolicy(spaceId, { scopeType: "agent", scopeId: agent.id, amount: 1000, isActive: false }, null);
    const approval = await approvalService(db).create(spaceId, { type: "create_agent",
      payload: { agentId: agent.id, budgetMonthlyCents: 1000 }, status: "pending" });
    const policy = async () => (await db.select().from(budgetPolicies).where(eq(budgetPolicies.scopeId, agent.id)))[0]!;
    await approvalService(db).approve(approval.id, "operator");
    expect(await policy()).toMatchObject({ amount: 1000, isActive: false });
    await agentConfiguration(db).update(agent.id, { budgetMonthlyCents: 2000 });
    expect(await policy()).toMatchObject({ amount: 2000, isActive: true });
    await agentConfiguration(db).update(agent.id, { budgetMonthlyCents: 0 });
    expect(await policy()).toMatchObject({ amount: 0, isActive: false });
  });

  it.each(["updateConfiguration", "updateAndTransition"] as const)("limits %s budget reconciliation to the edited agent", async command => {
    const lifecycle = createAgentLifecycle(db);
    const one = await create();
    const two = await lifecycle.requestCreation(spaceId, { name: "Other budget target" });
    await db.update(spaces).set({ status: "paused" }).where(eq(spaces.id, spaceId));
    if (command === "updateConfiguration") await lifecycle.updateConfiguration(one.id, { budgetMonthlyCents: 1000 });
    else await lifecycle.updateAndTransition(one.id, "pause", { budgetMonthlyCents: 1000 });
    // Space state blocks admission; its inherited holds project separately.
    expect((await current(one.id)).lifecycleHolds).not.toContain("space_paused");
    expect((await current(two.id)).lifecycleHolds).toEqual([]);
  });

  it("blocks invocation without synchronously projecting inherited space holds", async () => {
    const one = await create();
    const two = await createAgentLifecycle(db).requestCreation(spaceId, { name: "Another agent" });
    await db.update(spaces).set({ status: "paused" }).where(eq(spaces.id, spaceId));
    expect(await budgetService(db).getInvocationBlock(spaceId, one.id)).not.toBeNull();
    expect((await current(one.id)).lifecycleHolds).toEqual([]);
    expect((await current(two.id)).lifecycleHolds).toEqual([]);
  });

  it("keeps a manual hold when space policy changes", async () => {
    const work = worker(); const lifecycle = createAgentLifecycle(db); const agent = await create(); await work.process(agent.id);
    await lifecycle.pauseAgent(agent.id); await work.process(agent.id);
    await db.update(spaces).set({ status: "archived" }).where(eq(spaces.id, spaceId));
    await projectSpaceHolds(db, createAgentLifecycleEffects(), spaceId); await work.process(agent.id);
    await db.update(spaces).set({ status: "active" }).where(eq(spaces.id, spaceId));
    await projectSpaceHolds(db, createAgentLifecycleEffects(), spaceId); await work.process(agent.id);
    expect(await current(agent.id)).toMatchObject({ lifecycleState: "paused", lifecycleHolds: ["manual"] });
    await lifecycle.resumeAgent(agent.id); await work.process(agent.id);
    expect((await current(agent.id)).lifecycleState).toBe("ready");
  });

  it("defers automatic policy changes while a task holds the agent lock", async () => {
    const agent = await create("paused");
    await db.transaction(async tx => {
      await tx.select().from(agents).where(eq(agents.id, agent.id)).for("update");
      expect(await createLifecycleStore(db).change(agent.id, "reconcile")).toBeNull();
    });
    expect(await createLifecycleStore(db).change(agent.id, "reconcile")).not.toBeNull();
  });

  it("retains the failed phase and the same operation for retry", async () => {
    let fail = true;
    const work = worker(async agent => { if (agent.lifecycleState === "verifying" && fail) throw new Error("private detail"); return "complete"; });
    const agent = await create(); await work.process(agent.id);
    const failed = await current(agent.id);
    expect(failed.lifecycleState).toBe("verifying");
    expect(failed.lifecycleError).not.toContain("private detail");
    fail = false;
    await createAgentLifecycle(db).retry(agent.id); await work.process(agent.id);
    expect((await current(agent.id)).lifecycleState).toBe("ready");
  });

  it("fences a late completion when termination replaces preparation", async () => {
    const agent = await create("paused");
    const store = createLifecycleStore(db);
    await createAgentLifecycle(db).resumeAgent(agent.id);
    const claimed = await store.claim(agent.id, "old", new Date());
    expect(claimed).not.toBeNull();
    await store.setRequiredPlugins(claimed!, "old", []);
    await createAgentLifecycle(db).terminateAgent(agent.id);
    expect(await store.completeHost(claimed!, "old")).toBe(false);
    expect(await store.change(agent.id, "complete", { owner: "old", version: claimed!.lifecycleVersion })).toBeNull();
    expect((await current(agent.id)).lifecycleState).toBe("terminating");
  });

  it("revokes keys at termination and waits for cleanup before deletion", async () => {
    let pending = true;
    const phases: string[] = [];
    const work = worker(async agent => { phases.push(agent.lifecycleState); return agent.lifecycleState === "cleaning_up" && pending ? "pending" : "complete"; });
    const lifecycle = createAgentLifecycle(db); const agent = await create(); await work.process(agent.id);
    await db.insert(agentApiKeys).values({ agentId: agent.id, spaceId, name: "Test", keyHash: randomUUID() });
    await lifecycle.terminateAgent(agent.id); await work.process(agent.id);
    expect((await current(agent.id)).lifecycleState).toBe("cleaning_up");
    expect((await db.select().from(agentApiKeys).where(eq(agentApiKeys.agentId, agent.id)))[0].revokedAt).not.toBeNull();
    await expect(agentConfiguration(db).remove(agent.id)).rejects.toThrow("Complete termination");
    pending = false; await lifecycle.retry(agent.id); await work.process(agent.id);
    expect(phases).toContain("terminating");
    expect((await current(agent.id)).lifecycleState).toBe("terminated");
    await agentConfiguration(db).remove(agent.id);
    expect(await current(agent.id)).toBeUndefined();
  });

  it("retains required plugin IDs and checks the operation and space on each reply", async () => {
    const agent = await create("paused");
    const pluginId = randomUUID();
    await db.insert(plugins).values({ id: pluginId, pluginKey: pluginId, packageName: "lifecycle-test", version: "1.0.0", status: "ready",
      manifestJson: { agentLifecycle: true, capabilities: ["agents.lifecycle.manage"] } as never });
    const call = vi.fn(async (_id, _method, input) => ({ operationId: input.operationId, version: input.version, status: "complete" }));
    const driver = createLifecycleDriver(db, { call } as never);
    const snapshot = (await createLifecycleStore(db).get(agent.id))!;
    expect(await driver.requiredPluginIds(snapshot)).toContain(pluginId);
    await db.insert(pluginSpaceSettings).values({ spaceId, pluginId, enabled: false });
    expect(await driver.requiredPluginIds(snapshot)).not.toContain(pluginId);
    expect(await driver.requiredPluginIds({ ...snapshot, lifecycleRequiredPluginIds: [pluginId] })).toContain(pluginId);
    await expect(driver.runPlugin(snapshot, pluginId)).rejects.toThrow("unavailable");
    await db.update(pluginSpaceSettings).set({ enabled: true }).where(eq(pluginSpaceSettings.pluginId, pluginId));
    expect(await driver.runPlugin(snapshot, pluginId)).toBe("complete");
    expect(call).toHaveBeenCalledWith(pluginId, "agentLifecycle", { spaceId, agentId: agent.id,
      operationId: snapshot.lifecycleOperation!.id, version: snapshot.lifecycleVersion, phase: "paused", instanceSecrets: {} }, 30_000);
    call.mockResolvedValueOnce({ operationId: "stale", version: snapshot.lifecycleVersion, status: "complete" });
    await expect(driver.runPlugin(snapshot, pluginId)).rejects.toThrow("Invalid lifecycle result");
  });

  it("drives required resource work through setup, pause, resume, and confirmed cleanup", async () => {
    const pluginId = randomUUID();
    await db.insert(plugins).values({ id: pluginId, pluginKey: pluginId, packageName: "resource-lifecycle-test", version: "1.0.0", status: "ready",
      manifestJson: { agentLifecycle: true, capabilities: ["agents.lifecycle.manage"] } as never });
    let resourcesReady = false;
    let resourcesRemoved = false;
    const requests: import("@outpost/shared").AgentLifecycleRequest[] = [];
    const call = async (id: string, method: string, input: import("@outpost/shared").AgentLifecycleRequest) => {
      expect(id).toBe(pluginId);
      expect(method).toBe("agentLifecycle");
      expect(input.spaceId).toBe(spaceId);
      expect((await current(input.agentId)).lifecycleOperation?.hostComplete).toBe(true);
      requests.push(input);
      const pending = (input.phase === "preparing" && !resourcesReady) || (input.phase === "cleaning_up" && !resourcesRemoved);
      return { operationId: input.operationId, version: input.version, status: pending ? "pending" : "complete" };
    };
    const driver = createLifecycleDriver(db, { call } as never);
    // Provider/harness execution is stubbed; plugin dispatch and durable transitions are real.
    const work = configureAgentLifecycle(db, { ...driver, requiredPluginIds: async () => [pluginId], runHost: async () => "complete" });
    workers.push(work);
    const lifecycle = createAgentLifecycle(db);
    const agent = await create();
    await work.process(agent.id);
    expect(await current(agent.id)).toMatchObject({ lifecycleState: "preparing", status: "paused", lifecycleError: null });
    const preparation = requests[0];
    resourcesReady = true;
    await lifecycle.retry(agent.id); await work.process(agent.id);
    expect(requests[1]).toEqual(preparation);
    expect((await current(agent.id)).lifecycleState).toBe("ready");
    await lifecycle.pauseAgent(agent.id); await work.process(agent.id);
    expect((await current(agent.id)).lifecycleState).toBe("paused");
    await lifecycle.resumeAgent(agent.id); await work.process(agent.id);
    expect((await current(agent.id)).lifecycleState).toBe("ready");
    await lifecycle.terminateAgent(agent.id); await work.process(agent.id);
    expect((await current(agent.id)).lifecycleState).toBe("cleaning_up");
    await expect(lifecycle.purgeAgent(agent.id)).rejects.toThrow("Complete termination");
    resourcesRemoved = true;
    await lifecycle.retry(agent.id); await work.process(agent.id);
    expect((await current(agent.id)).lifecycleState).toBe("terminated");
    expect(requests.map(request => request.phase)).toEqual([
      "preparing", "preparing", "verifying", "pausing", "resuming", "terminating", "cleaning_up", "cleaning_up",
    ]);
    expect(requests.every(request => request.agentId === agent.id)).toBe(true);
  });

  it("keeps host completion and required plugin results across a worker restart", async () => {
    const pluginIds = [randomUUID(), randomUUID()];
    const runHost = vi.fn(async () => "complete" as const);
    const firstPlugin = vi.fn(async (_agent: LifecycleAgent, pluginId: string) =>
      pluginId === pluginIds[0] ? "complete" as const : "pending" as const);
    const first = configureAgentLifecycle(db, { requiredPluginIds: async () => pluginIds, runHost, runPlugin: firstPlugin });
    workers.push(first);
    const agent = await create();
    await first.process(agent.id);
    expect(await current(agent.id)).toMatchObject({ lifecycleState: "preparing", lifecycleRequiredPluginIds: pluginIds,
      lifecycleOperation: { hostComplete: true, completedPluginIds: [pluginIds[0]] } });
    await first.stop();

    const discover = vi.fn(async () => []);
    const resumedPlugin = vi.fn(async (_agent: LifecycleAgent, _pluginId: string) => "complete" as const);
    const resumed = configureAgentLifecycle(db, { requiredPluginIds: discover, runHost, runPlugin: resumedPlugin });
    workers.push(resumed);
    await createAgentLifecycle(db).retry(agent.id);
    await resumed.process(agent.id);
    expect((await current(agent.id)).lifecycleState).toBe("ready");
    expect(discover).not.toHaveBeenCalled();
    expect(runHost).toHaveBeenCalledTimes(2);
    expect(resumedPlugin.mock.calls.map(call => call[1])).toEqual([pluginIds[1], ...pluginIds]);
  });

  it("requires host and plugin completion and freezes the selected plugin IDs", async () => {
    const agent = await create();
    const store = createLifecycleStore(db);
    const claimed = (await store.claim(agent.id, "test", new Date()))!;
    const pluginId = randomUUID();
    expect(await store.setRequiredPlugins(claimed, "test", [pluginId])).toBe(true);
    expect(await store.setRequiredPlugins(claimed, "test", [])).toBe(false);
    expect(await store.completePlugin(claimed, "test", randomUUID())).toBe(false);
    const complete = () => store.change(agent.id, "complete", { owner: "test", version: claimed.lifecycleVersion });
    expect(await complete()).toBeNull();
    expect(await store.completePlugin(claimed, "test", pluginId)).toBe(true);
    expect(await complete()).toBeNull();
    expect(await store.completeHost(claimed, "test")).toBe(true);
    expect(await complete()).toMatchObject({ lifecycleState: "verifying" });
    expect(await store.completePlugin(claimed, "test", pluginId)).toBe(false);
  });

  it("fences verification when the saved configuration changes", async () => {
    const lifecycle = createAgentLifecycle(db); const store = createLifecycleStore(db);
    const agent = await create();
    const claimed = (await store.claim(agent.id, "configuration-test", new Date()))!;
    await store.setRequiredPlugins(claimed, "configuration-test", []);
    await agentConfiguration(db).update(agent.id, { adapterConfig: { command: "echo" } });
    expect(await store.completeHost(claimed, "configuration-test")).toBe(false);
    expect((await lifecycle.get(agent.id))!.lifecycleVersion).toBeGreaterThan(claimed.lifecycleVersion);
  });

  it("invalidates only changed execution configuration during setup", async () => {
    const lifecycle = createAgentLifecycle(db);
    const agent = await create();
    const before = await current(agent.id);
    await lifecycle.updateConfiguration(agent.id, { name: "Profile only" });
    await lifecycle.updateConfiguration(agent.id, { adapterConfig: before.adapterConfig });
    expect((await current(agent.id)).lifecycleVersion).toBe(before.lifecycleVersion);
    await lifecycle.updateConfiguration(agent.id, { runtimeConfig: { heartbeat: { enabled: false } } });
    expect((await current(agent.id)).lifecycleVersion).toBe(before.lifecycleVersion + 1);
    const work = worker();
    await work.process(agent.id);
    const ready = await current(agent.id);
    expect(ready.lifecycleState).toBe("ready");
    await lifecycle.updateConfiguration(agent.id, { adapterConfig: { command: "echo" } });
    expect(await current(agent.id)).toMatchObject({ lifecycleState: "ready", lifecycleVersion: ready.lifecycleVersion });
  });

  it("rejects identity, accounting, and unknown fields through every configuration entry point", async () => {
    const agent = await create();
    const lifecycle = createAgentLifecycle(db);
    const before = await current(agent.id);
    for (const patch of [{ id: randomUUID() }, { spaceId: randomUUID() }, { spentMonthlyCents: 0 },
      { spendMonthUtc: "2099-01" }, { lastHeartbeatAt: new Date() }, { errorReason: null },
      { createdAt: new Date() }, { updatedAt: new Date() }, { lifecycleState: "ready" }, { futureColumn: true }]) {
      await expect(lifecycle.updateConfiguration(agent.id, patch as never)).rejects.toThrow("Unsupported configuration field");
      await expect(lifecycle.updateAndTransition(agent.id, "pause", patch as never)).rejects.toThrow("Unsupported configuration field");
      await expect(db.transaction(tx => updateAgentConfigurationInTransaction(tx as unknown as Db, agent.id, patch as never)))
        .rejects.toThrow("Unsupported configuration field");
    }
    expect(await current(agent.id)).toEqual(before);
    const effects = createAgentLifecycleEffects();
    const malformed = createLifecycleCommands(db, { ...effects, prepareConfiguration: async () => ({ id: randomUUID() }) as never });
    await expect(malformed.updateConfiguration(agent.id, { name: "Changed" })).rejects.toThrow("Unsupported configuration field");
    expect(await current(agent.id)).toEqual(before);
  });

  it("records only the changed configuration fields for a legacy appearance", async () => {
    const [agent] = await db.insert(agents).values({ spaceId, name: "Legacy", appearance: null }).returning();
    await createAgentLifecycle(db).updateConfiguration(agent.id, { name: "Renamed" },
      { recordRevision: { source: "test", createdByUserId: "operator" } });
    const revisions = await db.select().from(agentConfigRevisions).where(eq(agentConfigRevisions.agentId, agent.id));
    expect(revisions).toHaveLength(1);
    expect(revisions[0].changedKeys).toEqual(["name"]);
    expect(revisions[0].beforeConfig.appearance).toEqual(revisions[0].afterConfig.appearance);
  });

  it("accepts the unchanged resolved appearance of a pending create", async () => {
    const [agent] = await db.insert(agents).values({ spaceId, name: "Pending legacy", status: "pending_approval", appearance: null }).returning();
    const resolved = await agentConfiguration(db).getById(agent.id);
    await expect(createAgentLifecycle(db).updateConfiguration(agent.id, { appearance: resolved!.appearance }))
      .resolves.toMatchObject({ id: agent.id });
    await expect(createAgentLifecycle(db).updateConfiguration(agent.id, { name: "Changed" }))
      .rejects.toThrow("Pending approval agent configuration cannot be changed");
  });

  it("rolls back a root configuration command when dependent records fail", async () => {
    const agent = await create();
    const before = await current(agent.id);
    const effects = createAgentLifecycleEffects();
    const lifecycle = createLifecycleCommands(db, { ...effects, completeConfiguration: async (...args) => {
      await effects.completeConfiguration(...args);
      throw new Error("Configuration completion failed");
    } });
    await expect(lifecycle.updateConfiguration(agent.id, { adapterConfig: { command: "echo" } },
      { recordRevision: { source: "test", createdByUserId: "operator" } })).rejects.toThrow("Configuration completion failed");
    expect(await current(agent.id)).toMatchObject({ adapterConfig: before.adapterConfig,
      lifecycleVersion: before.lifecycleVersion, lifecycleOperation: before.lifecycleOperation });
    expect(await db.select().from(agentConfigRevisions).where(eq(agentConfigRevisions.agentId, agent.id))).toHaveLength(0);
  });

  it("rolls back configuration and verification invalidation in the binding transaction", async () => {
    const agent = await create();
    const before = await current(agent.id);
    await expect(updateAgentConfigurationInTransaction(db, agent.id, { name: "Uncommitted" }))
      .rejects.toThrow("requires a database transaction");
    expect(() => updateAgentConfigurationInTransaction(db, agent.id, { budgetMonthlyCents: 100 } as never))
      .toThrow("Budget changes require a root lifecycle command");
    await expect(db.transaction(async tx => agentConfiguration(tx as unknown as Db).update(agent.id, { name: "Uncommitted" })))
      .rejects.toThrow("root database");
    await expect(db.transaction(async tx => {
      await updateAgentConfigurationInTransaction(tx as unknown as Db, agent.id, { adapterConfig: { command: "echo" } });
      expect((await tx.select().from(agents).where(eq(agents.id, agent.id)))[0].lifecycleVersion).toBe(before.lifecycleVersion + 1);
      throw new Error("Binding change failed");
    })).rejects.toThrow("Binding change failed");
    expect(await current(agent.id)).toMatchObject({ adapterConfig: before.adapterConfig,
      lifecycleVersion: before.lifecycleVersion, lifecycleOperation: before.lifecycleOperation });
  });

  it("permits a operator retry and rejects an agent or a different space", async () => {
    const agent = await create();
    function app(actor: Express.Request["actor"]) {
      const app = express(); app.use(express.json());
      app.use((req, _res, next) => { req.actor = actor; next(); });
      app.use("/api", agentRoutes(db)); app.use(errorHandler); return app;
    }
    const operator: Express.Request["actor"] = { type: "operator", source: "session", userId: "operator", spaceIds: [spaceId],
      memberships: [{ spaceId, membershipRole: "admin", status: "active" }] };
    await db.insert(spaceMemberships).values({ spaceId, principalType: "user", principalId: "operator", membershipRole: "admin" });
    await db.insert(principalPermissionGrants).values(["agents:create", "agents:configure"].map(permissionKey => ({ spaceId, principalType: "user", principalId: "operator", permissionKey })));
    const url = `/api/agents/${agent.id}/lifecycle/retry`;
    const response = await request(app(operator)).post(url).send({});
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.lifecycleState).toBe("preparing");
    expect(response.body).not.toHaveProperty("lifecycleOperation");
    expect(await db.select().from(activityLog).where(and(eq(activityLog.entityId, agent.id), eq(activityLog.action, "agent.lifecycle_retried"))))
      .toEqual([expect.objectContaining({ actorType: "user", actorId: "operator" })]);
    await request(app({ type: "agent", source: "agent_key", spaceId, agentId: agent.id })).post(url).send({}).expect(403);
    const denied = await request(app({ ...operator, spaceIds: [], memberships: [] })).post(url).send({});
    expect([403, 404]).toContain(denied.status);
  });

  it("recovers an expired lease and never accepts an expired completion", async () => {
    const agent = await create("paused"); const store = createLifecycleStore(db);
    await createAgentLifecycle(db).resumeAgent(agent.id);
    const claim = await store.claim(agent.id, "first", new Date(Date.now() - 180_000));
    expect(claim).not.toBeNull();
    await store.setRequiredPlugins(claim!, "first", []);
    await store.completeHost(claim!, "first");
    expect(await store.change(agent.id, "complete", { owner: "first", version: claim!.lifecycleVersion })).toBeNull();
    expect(await store.claim(agent.id, "second", new Date())).not.toBeNull();
  });
});

describe("lifecycle transition rules", () => {
  it("does not bypass authorization, verification, or cleanup", () => {
    expect(() => transition("pending_approval", "resume")).toThrow();
    expect(transition("preparing", "complete")).toBe("verifying");
    expect(transition("terminating", "complete")).toBe("cleaning_up");
    expect(transition("cleaning_up", "complete")).toBe("terminated");
    expect(() => transition("terminated", "resume")).toThrow();
    expect(transition("terminating", "terminate")).toBe("terminating");
  });
});
