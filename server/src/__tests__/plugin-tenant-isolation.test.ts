import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  spaces,
  createDb,
  pluginEntities,
  pluginJobs,
  pluginJobRuns,
  pluginLogs,
  pluginWebhookDeliveries,
  plugins,
} from "@outpost/db";
import { buildHostServices, flushPluginLogBuffer } from "../services/plugin-host-services.js";
import { pluginRegistryService } from "../services/plugin-registry.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

function createEventBusStub() {
  return {
    forPlugin() {
      return {
        emit: vi.fn(),
        subscribe: vi.fn(),
        clear: vi.fn(),
      };
    },
  } as any;
}

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

function issuePrefix(id: string) {
  return `T${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping plugin tenant-isolation tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("plugin tenant isolation (space_id FK)", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("outpost-plugin-tenant-isolation-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(pluginEntities);
    await db.delete(pluginJobRuns);
    await db.delete(pluginJobs);
    await db.delete(pluginLogs);
    await db.delete(pluginWebhookDeliveries);
    await db.delete(plugins);
    await db.delete(spaces);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedPlugin() {
    const pluginId = randomUUID();
    await db.insert(plugins).values({
      id: pluginId,
      pluginKey: "outpost.tenant-isolation-test",
      packageName: "@outpost/plugin-tenant-isolation-test",
      version: "0.0.1",
      apiVersion: 1,
      categories: ["automation"],
      manifestJson: {
        id: "outpost.tenant-isolation-test",
        apiVersion: 1,
        version: "0.0.1",
        displayName: "Tenant Isolation Test",
        description: "Test plugin",
        author: "Outpost",
        categories: ["automation"],
        capabilities: [],
        entrypoints: { worker: "./dist/worker.js" },
      },
      status: "ready",
      installOrder: 1,
    });
    return pluginId;
  }

  async function seedSpace() {
    const spaceId = randomUUID();
    await db.insert(spaces).values({
      id: spaceId,
      name: `Tenant ${spaceId.slice(0, 6)}`,
      issuePrefix: issuePrefix(spaceId),
    });
    return spaceId;
  }

  it("allows NULL space_id on plugin_logs (instance-scope rows behave as before)", async () => {
    const pluginId = await seedPlugin();
    await db.insert(pluginLogs).values({
      pluginId,
      // spaceId intentionally omitted — NULL means instance-scope.
      level: "info",
      message: "instance-scope log",
    });
    const rows = await db.select().from(pluginLogs).where(eq(pluginLogs.pluginId, pluginId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.spaceId).toBeNull();
  });

  it("cascades plugin_logs / plugin_entities / plugin_job_runs / plugin_webhook_deliveries when the owning space is deleted", async () => {
    const pluginId = await seedPlugin();
    const spaceA = await seedSpace();
    const spaceB = await seedSpace();

    // Seed a job + run so we can verify plugin_job_runs cascades too.
    const jobAId = randomUUID();
    const jobBId = randomUUID();
    await db.insert(pluginJobs).values([
      { id: jobAId, pluginId, jobKey: "cron-a", schedule: "* * * * *" },
      { id: jobBId, pluginId, jobKey: "cron-b", schedule: "* * * * *" },
    ]);

    await db.insert(pluginLogs).values([
      { pluginId, spaceId: spaceA, level: "info", message: "A log" },
      { pluginId, spaceId: spaceB, level: "info", message: "B log" },
      { pluginId, level: "info", message: "instance log" },
    ]);

    await db.insert(pluginEntities).values([
      {
        pluginId,
        spaceId: spaceA,
        entityType: "issue",
        scopeKind: "space",
        scopeId: spaceA,
        externalId: "ext-a",
      },
      {
        pluginId,
        spaceId: spaceB,
        entityType: "issue",
        scopeKind: "space",
        scopeId: spaceB,
        externalId: "ext-b",
      },
    ]);

    await db.insert(pluginJobRuns).values([
      { jobId: jobAId, pluginId, spaceId: spaceA, trigger: "manual" },
      { jobId: jobBId, pluginId, spaceId: spaceB, trigger: "manual" },
      { jobId: jobAId, pluginId, trigger: "schedule" },
    ]);

    await db.insert(pluginWebhookDeliveries).values([
      { pluginId, spaceId: spaceA, webhookKey: "wh", payload: { who: "A" } },
      { pluginId, spaceId: spaceB, webhookKey: "wh", payload: { who: "B" } },
      { pluginId, webhookKey: "wh", payload: { who: "instance" } },
    ]);

    // Delete space A — only A's rows should be reaped. B's and NULL-scope rows stay.
    await db.delete(spaces).where(eq(spaces.id, spaceA));

    const logs = await db.select().from(pluginLogs);
    expect(logs.map((r) => r.spaceId).sort((a, b) => String(a).localeCompare(String(b)))).toEqual(
      [spaceB, null].sort((a, b) => String(a).localeCompare(String(b))),
    );

    const entities = await db.select().from(pluginEntities);
    expect(entities).toHaveLength(1);
    expect(entities[0]?.spaceId).toBe(spaceB);

    const runs = await db.select().from(pluginJobRuns);
    expect(runs.map((r) => r.spaceId).sort((a, b) => String(a).localeCompare(String(b)))).toEqual(
      [spaceB, null].sort((a, b) => String(a).localeCompare(String(b))),
    );

    const deliveries = await db.select().from(pluginWebhookDeliveries);
    expect(deliveries.map((r) => r.spaceId).sort((a, b) => String(a).localeCompare(String(b)))).toEqual(
      [spaceB, null].sort((a, b) => String(a).localeCompare(String(b))),
    );
  });

  it("plugin_entities unique index is scoped per space — two tenants can share (pluginId, entityType, externalId)", async () => {
    const pluginId = await seedPlugin();
    const spaceA = await seedSpace();
    const spaceB = await seedSpace();

    // Space A claims external id "ext-1".
    await db.insert(pluginEntities).values({
      pluginId,
      spaceId: spaceA,
      entityType: "page",
      scopeKind: "space",
      scopeId: spaceA,
      externalId: "ext-1",
    });

    // Space B uses the SAME (pluginId, entityType, externalId) — must succeed
    // under the per-space unique index (would have collided under the old index).
    await db.insert(pluginEntities).values({
      pluginId,
      spaceId: spaceB,
      entityType: "page",
      scopeKind: "space",
      scopeId: spaceB,
      externalId: "ext-1",
    });

    const rows = await db.select().from(pluginEntities);
    expect(rows).toHaveLength(2);

    // Re-inserting the same (spaceId, pluginId, entityType, externalId) tuple
    // for space A must violate the unique constraint. Drizzle wraps the
    // underlying pg error as "Failed query: ..." — inspect the cause to confirm
    // it's the unique violation on our index (pg error code 23505).
    const err = await db
      .insert(pluginEntities)
      .values({
        pluginId,
        spaceId: spaceA,
        entityType: "page",
        scopeKind: "space",
        scopeId: spaceA,
        externalId: "ext-1",
      })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(Error);
    // postgres error code 23505 = unique_violation, the constraint name is
    // not always surfaced on .cause by the driver, but the code is sufficient
    // to prove the unique index rejected the duplicate.
    const cause = (err as { cause?: { code?: string } }).cause;
    expect(cause?.code).toBe("23505");
  });

  it("pluginRegistryService.upsertEntity scopes its lookup by spaceId — never overwrites another tenant's row", async () => {
    const pluginId = await seedPlugin();
    const spaceA = await seedSpace();
    const spaceB = await seedSpace();

    const registry = pluginRegistryService(db);

    // Space A claims (issue, ext-shared) with title "A".
    const createdA = await registry.upsertEntity(pluginId, {
      spaceId: spaceA,
      entityType: "issue",
      scopeKind: "space",
      scopeId: spaceA,
      externalId: "ext-shared",
      title: "A",
      status: "open",
      data: {},
    });

    // Space B upserts the SAME (entityType, externalId) tuple under its own
    // scope — must create a NEW row for B, NOT overwrite A.
    const createdB = await registry.upsertEntity(pluginId, {
      spaceId: spaceB,
      entityType: "issue",
      scopeKind: "space",
      scopeId: spaceB,
      externalId: "ext-shared",
      title: "B",
      status: "open",
      data: {},
    });

    expect(createdA?.id).toBeTruthy();
    expect(createdB?.id).toBeTruthy();
    expect(createdA?.id).not.toBe(createdB?.id);

    // Space B updates its own row — A's row must remain untouched.
    const updatedB = await registry.upsertEntity(pluginId, {
      spaceId: spaceB,
      entityType: "issue",
      scopeKind: "space",
      scopeId: spaceB,
      externalId: "ext-shared",
      title: "B-updated",
      status: "closed",
      data: {},
    });
    expect(updatedB?.id).toBe(createdB?.id);
    expect(updatedB?.title).toBe("B-updated");

    const rows = await db.select().from(pluginEntities);
    expect(rows).toHaveLength(2);
    const rowA = rows.find((r) => r.spaceId === spaceA);
    const rowB = rows.find((r) => r.spaceId === spaceB);
    expect(rowA?.title).toBe("A");
    expect(rowA?.status).toBe("open");
    expect(rowB?.title).toBe("B-updated");
    expect(rowB?.status).toBe("closed");

    // Instance-scope upsert (spaceId = NULL) on the same tuple must also
    // create its own row, not collide with A or B.
    const createdInstance = await registry.upsertEntity(pluginId, {
      spaceId: null,
      entityType: "issue",
      scopeKind: "instance",
      scopeId: null,
      externalId: "ext-shared",
      title: "instance",
      status: "open",
      data: {},
    });
    expect(createdInstance?.id).toBeTruthy();
    expect(createdInstance?.id).not.toBe(createdA?.id);
    expect(createdInstance?.id).not.toBe(createdB?.id);

    const allRows = await db.select().from(pluginEntities);
    expect(allRows).toHaveLength(3);
  });

  it("pluginRegistryService.getEntityByExternalId scopes by spaceId — never returns another tenant's row", async () => {
    const pluginId = await seedPlugin();
    const spaceA = await seedSpace();
    const spaceB = await seedSpace();

    const registry = pluginRegistryService(db);

    await registry.upsertEntity(pluginId, {
      spaceId: spaceA,
      entityType: "issue",
      scopeKind: "space",
      scopeId: spaceA,
      externalId: "ext-shared",
      title: "A",
      status: "open",
      data: {},
    });
    await registry.upsertEntity(pluginId, {
      spaceId: spaceB,
      entityType: "issue",
      scopeKind: "space",
      scopeId: spaceB,
      externalId: "ext-shared",
      title: "B",
      status: "open",
      data: {},
    });
    await registry.upsertEntity(pluginId, {
      spaceId: null,
      entityType: "issue",
      scopeKind: "instance",
      scopeId: null,
      externalId: "ext-shared",
      title: "instance",
      status: "open",
      data: {},
    });

    const fromA = await registry.getEntityByExternalId(pluginId, "issue", "ext-shared", spaceA);
    expect(fromA?.spaceId).toBe(spaceA);
    expect(fromA?.title).toBe("A");

    const fromB = await registry.getEntityByExternalId(pluginId, "issue", "ext-shared", spaceB);
    expect(fromB?.spaceId).toBe(spaceB);
    expect(fromB?.title).toBe("B");

    const fromInstance = await registry.getEntityByExternalId(pluginId, "issue", "ext-shared", null);
    expect(fromInstance?.spaceId).toBeNull();
    expect(fromInstance?.title).toBe("instance");

    const services = buildHostServices(db, pluginId, "tenant-isolation-test", createEventBusStub());
    await expect(services.entities.list({
      entityType: "issue", scopeKind: "space", scopeId: spaceB, externalId: "ext-shared", limit: 1,
    })).resolves.toEqual([expect.objectContaining({ title: "B" })]);
    await expect(services.entities.list({
      entityType: "issue", scopeKind: "space", scopeId: randomUUID(), externalId: "ext-shared", limit: 1,
    })).resolves.toEqual([]);

    // Unknown tenant returns null, not another tenant's row.
    const unknown = await registry.getEntityByExternalId(
      pluginId,
      "issue",
      "ext-shared",
      randomUUID(),
    );
    expect(unknown).toBeNull();
  });

  it("pluginRegistryService.createJobRun + createWebhookDelivery persist spaceId so cascade delete reaps them", async () => {
    const pluginId = await seedPlugin();
    const spaceA = await seedSpace();
    const spaceB = await seedSpace();

    const registry = pluginRegistryService(db);
    const jobId = randomUUID();
    await db.insert(pluginJobs).values({
      id: jobId,
      pluginId,
      jobKey: "test-job",
      schedule: "* * * * *",
    });

    const runA = await registry.createJobRun(pluginId, jobId, "manual", spaceA);
    const runB = await registry.createJobRun(pluginId, jobId, "manual", spaceB);
    const runInstance = await registry.createJobRun(pluginId, jobId, "schedule", null);

    expect(runA?.spaceId).toBe(spaceA);
    expect(runB?.spaceId).toBe(spaceB);
    expect(runInstance?.spaceId).toBeNull();

    const whA = await registry.createWebhookDelivery(pluginId, "wh", spaceA, {
      payload: { who: "A" },
    });
    const whB = await registry.createWebhookDelivery(pluginId, "wh", spaceB, {
      payload: { who: "B" },
    });
    const whInstance = await registry.createWebhookDelivery(pluginId, "wh", null, {
      payload: { who: "instance" },
    });

    expect(whA?.spaceId).toBe(spaceA);
    expect(whB?.spaceId).toBe(spaceB);
    expect(whInstance?.spaceId).toBeNull();

    // Cascade: deleting space A reaps A's rows; B's and instance-scope rows stay.
    await db.delete(spaces).where(eq(spaces.id, spaceA));

    const runs = await db.select().from(pluginJobRuns);
    expect(runs.map((r) => r.spaceId).sort((a, b) => String(a).localeCompare(String(b)))).toEqual(
      [spaceB, null].sort((a, b) => String(a).localeCompare(String(b))),
    );

    const deliveries = await db.select().from(pluginWebhookDeliveries);
    expect(
      deliveries.map((r) => r.spaceId).sort((a, b) => String(a).localeCompare(String(b))),
    ).toEqual([spaceB, null].sort((a, b) => String(a).localeCompare(String(b))));
  });

  it("buildHostServices.logger.log + flushPluginLogBuffer persist spaceId so cascade delete reaps log rows", async () => {
    const pluginId = await seedPlugin();
    const spaceA = await seedSpace();
    const spaceB = await seedSpace();

    // Flush any leftovers from prior tests (the buffer is module-scoped).
    await flushPluginLogBuffer();
    await db.delete(pluginLogs);

    const services = buildHostServices(db, pluginId, "tenant-isolation-test", createEventBusStub());
    try {
      await services.logger.log({
        level: "info",
        message: "A log",
        spaceId: spaceA,
      });
      await services.logger.log({
        level: "warn",
        message: "B log",
        spaceId: spaceB,
      });
      await services.logger.log({
        level: "info",
        message: "instance log",
        // spaceId omitted — explicit instance-scope.
      });
      await services.logger.log({
        level: "debug",
        message: "explicit-null log",
        spaceId: null,
      });

      await flushPluginLogBuffer();

      const rows = await db
        .select()
        .from(pluginLogs)
        .where(eq(pluginLogs.pluginId, pluginId));
      const byMessage = new Map(rows.map((r) => [r.message, r]));
      expect(byMessage.get("A log")?.spaceId).toBe(spaceA);
      expect(byMessage.get("B log")?.spaceId).toBe(spaceB);
      expect(byMessage.get("instance log")?.spaceId).toBeNull();
      expect(byMessage.get("explicit-null log")?.spaceId).toBeNull();

      // Cascade: deleting space A reaps A's log row; B's + NULL rows remain.
      await db.delete(spaces).where(eq(spaces.id, spaceA));

      const afterDelete = await db
        .select()
        .from(pluginLogs)
        .where(eq(pluginLogs.pluginId, pluginId));
      const messages = afterDelete.map((r) => r.message).sort();
      expect(messages).toEqual(["B log", "explicit-null log", "instance log"]);
    } finally {
      services.dispose();
      // Ensure no leftover entries leak into other tests.
      await flushPluginLogBuffer();
    }
  });

  it("plugin_entities unique index treats NULL spaceId as equal (NULLS NOT DISTINCT) so instance-scope dedup holds", async () => {
    const pluginId = await seedPlugin();

    // First instance-scope entity (spaceId = NULL) — succeeds.
    await db.insert(pluginEntities).values({
      pluginId,
      spaceId: null,
      entityType: "cron",
      scopeKind: "instance",
      scopeId: null,
      externalId: "global-cron-1",
    });

    // Second instance-scope row with the SAME (pluginId, entityType, externalId)
    // must be rejected. Without `.nullsNotDistinct()`, postgres would treat the
    // two NULL space_ids as distinct and silently allow the duplicate.
    const err = await db
      .insert(pluginEntities)
      .values({
        pluginId,
        spaceId: null,
        entityType: "cron",
        scopeKind: "instance",
        scopeId: null,
        externalId: "global-cron-1",
      })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(Error);
    expect((err as { cause?: { code?: string } }).cause?.code).toBe("23505");
  });
});
