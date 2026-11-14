import { randomUUID } from "node:crypto";
import { agents, spaces, costEvents, createDb } from "@outpost/db";
import { createFullDatabaseResponseCapture, installDatabaseResponseCapture } from "./helpers/full-database-response-capture.js";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { agentRecordQueries } from "../lib/agent-records.js";
import { agentService } from "../services/agents.js";

const support = await getEmbeddedPostgresTestSupport();

describe.skipIf(!support.supported)("agent roster read projections", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("agent-roster-read-");
    db = createDb(database.connectionString);
  }, 60_000);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2020-06-15T12:00:00Z"));
  });

  afterEach(() => { vi.useRealTimers(); });

  afterAll(async () => {
    await db?.$client.end();
    await database?.cleanup();
  });

  async function fixture() {
    const spaceId = randomUUID(), foreignSpaceId = randomUUID();
    const leadAgentId = randomUUID(), workerId = randomUUID(), unrelatedId = randomUUID(), archivedId = randomUUID(), foreignId = randomUUID();
    await db.insert(spaces).values([
      { id: spaceId, name: "Roster fixture", issuePrefix: `R${spaceId.slice(0, 7).toUpperCase()}` },
      { id: foreignSpaceId, name: "Foreign roster", issuePrefix: `F${foreignSpaceId.slice(0, 7).toUpperCase()}` },
    ]);
    const bulk = "retained-other-agent-configuration🙂".repeat(32_768);
    await db.insert(agents).values([
      { id: leadAgentId, spaceId, name: "Manager", status: "terminated", adapterType: "process", adapterConfig: { instructions: bulk } },
      { id: unrelatedId, spaceId, name: "Other worker", status: "idle", adapterType: "process", adapterConfig: { instructions: bulk } },
      { id: archivedId, spaceId, name: "Archived worker", status: "terminated", adapterType: "process", runtimeConfig: { retained: bulk } },
      { id: foreignId, spaceId: foreignSpaceId, name: "Foreign manager", status: "idle", adapterType: "process", adapterConfig: { instructions: bulk } },
    ]);
    const [worker] = await db.insert(agents).values({ id: workerId, spaceId, name: "Selected worker", status: "idle",
      leadAgentId: leadAgentId, adapterType: "process", adapterConfig: { instructions: "selected instructions", model: "fixture-model" },
      runtimeConfig: { heartbeat: { enabled: false } }, metadata: { retained: "selected metadata" },
      permissions: { canCreateAgents: true }, spentMonthlyCents: 999,
    }).returning();
    const now = new Date();
    await db.insert(costEvents).values([
      { spaceId, agentId: workerId, provider: "fixture", model: "fixture-model", costCents: 19.5, occurredAt: now },
      { spaceId, agentId: workerId, provider: "fixture", model: "fixture-model", costCents: 50,
        occurredAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15)) },
      { spaceId: foreignSpaceId, agentId: foreignId, provider: "fixture", model: "fixture-model", costCents: 100, occurredAt: now },
    ]);
    return { spaceId, foreignSpaceId, leadAgentId, workerId, unrelatedId, archivedId, foreignId, worker, bulk };
  }

  async function observe<T>(run: (observed: ReturnType<typeof createDb>) => Promise<T>) {
    const observed = createDb(database.connectionString), events: Array<Record<string, unknown>> = [], now = Date.now();
    const capture = createFullDatabaseResponseCapture({ start: now - 100, end: now + 59_000 }, event => events.push(event));
    installDatabaseResponseCapture(observed, { agents, costEvents }, capture);
    try {
      const result = await run(observed);
      capture.flush();
      const reads = events.filter(event => event.table === "agents" && event.operation === "select");
      return { result, calls: reads.reduce((n, event) => n + Number(event.calls), 0),
        bytes: reads.reduce((n, event) => n + Number(event.responseValueBytes), 0), events };
    } finally {
      capture.flush();
      await observed.$client.end();
    }
  }

  it.each([false, true])("reads one full roster for list, preserving terminated-manager evidence and configurations (includeTerminated=%s)", async includeTerminated => {
    const f = await fixture();
    const captured = await observe(observed => agentService(observed).list(f.spaceId, { includeTerminated }));
    expect(captured.calls).toBe(1);
    expect(captured.result.map(row => row.id).sort()).toEqual((includeTerminated
      ? [f.workerId, f.leadAgentId, f.archivedId, f.unrelatedId] : [f.workerId, f.unrelatedId]).sort());
    const selected = captured.result.find(row => row.id === f.workerId)!;
    expect(selected).toMatchObject({ adapterConfig: f.worker.adapterConfig, runtimeConfig: f.worker.runtimeConfig,
      metadata: f.worker.metadata, permissions: { canCreateAgents: true }, spentMonthlyCents: 19.5,
      coordinationHealth: { status: "invalid_coordination_chain", reason: "terminated_ancestor", firstInvalidAncestor: { id: f.leadAgentId } } });
    expect(captured.result.find(row => row.id === f.unrelatedId)?.adapterConfig.instructions).toBe(f.bulk);
    if (includeTerminated) expect(captured.result.find(row => row.id === f.archivedId)?.runtimeConfig.retained).toBe(f.bulk);
    expect((await db.select().from(agents).where(eq(agents.id, f.workerId)))[0]).toEqual(f.worker);
    expect(JSON.stringify(captured.events)).not.toContain("retained-other-agent-configuration");
  });

  it("keeps detail reads small while returning the selected agent's complete current configuration", async () => {
    const f = await fixture();
    const captured = await observe(observed => agentRecordQueries(observed).getById(f.workerId));
    expect(captured.calls).toBe(2);
    expect(captured.bytes).toBeLessThan(8192);
    expect(captured.result).toMatchObject({ id: f.workerId, spaceId: f.spaceId, adapterConfig: f.worker.adapterConfig,
      runtimeConfig: f.worker.runtimeConfig, metadata: f.worker.metadata, permissions: { canCreateAgents: true }, spentMonthlyCents: 19.5,
      coordinationHealth: { reason: "terminated_ancestor", firstInvalidAncestor: { id: f.leadAgentId, name: "Manager" } } });
    expect((await db.select().from(agents).where(eq(agents.id, f.workerId)))[0]).toEqual(f.worker);
  });

  it("projects only current space chain fields for plugin normalization", async () => {
    const f = await fixture();
    const captured = await observe(observed => agentRecordQueries(observed).listSpaceAgentEligibilityRows(f.spaceId));
    expect(captured.calls).toBe(1);
    expect(captured.bytes).toBeLessThan(4096);
    expect(captured.result.map(row => row.id).sort()).toEqual([f.workerId, f.leadAgentId, f.unrelatedId, f.archivedId].sort());
    for (const row of captured.result) expect(Object.keys(row).sort()).toEqual(["spaceId", "id", "name", "leadAgentId", "status"].sort());
    const normalized = agentRecordQueries(db).normalizeAgentRow(f.worker, captured.result);
    expect(normalized).toMatchObject({ adapterConfig: f.worker.adapterConfig, metadata: f.worker.metadata,
      coordinationHealth: { reason: "terminated_ancestor", firstInvalidAncestor: { id: f.leadAgentId } } });
    expect(await agentRecordQueries(db).listSpaceAgentEligibilityRows(randomUUID())).toEqual([]);
    expect(await agentRecordQueries(db).getById(randomUUID())).toBeNull();
  });

  it("rechecks manager status, name, selected configuration, missing managers, and cycles on later reads", async () => {
    const f = await fixture(), records = agentRecordQueries(db);
    expect((await records.getById(f.workerId))?.coordinationHealth.reason).toBe("terminated_ancestor");
    await db.update(agents).set({ status: "paused", name: "Current manager" }).where(eq(agents.id, f.leadAgentId));
    await db.update(agents).set({ adapterConfig: { instructions: "changed instructions" } }).where(eq(agents.id, f.workerId));
    expect(await records.getById(f.workerId)).toMatchObject({ adapterConfig: { instructions: "changed instructions" },
      coordinationHealth: { status: "healthy", pausedAncestors: [{ id: f.leadAgentId, name: "Current manager", status: "paused" }] } });
    await db.update(agents).set({ leadAgentId: f.foreignId }).where(eq(agents.id, f.workerId));
    expect((await records.getById(f.workerId))?.coordinationHealth.reason).toBe("missing_lead_agent");
    await db.update(agents).set({ leadAgentId: f.leadAgentId }).where(eq(agents.id, f.workerId));
    await db.update(agents).set({ leadAgentId: f.workerId }).where(eq(agents.id, f.leadAgentId));
    expect((await records.getById(f.workerId))?.coordinationHealth.reason).toBe("cycle");
  });
});
