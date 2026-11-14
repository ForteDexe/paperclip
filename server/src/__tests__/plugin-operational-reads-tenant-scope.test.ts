import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  spaces,
  createDb,
  pluginJobRuns,
  pluginJobs,
  pluginLogs,
  pluginWebhookDeliveries,
  plugins,
} from "@outpost/db";
import { errorHandler } from "../middleware/index.js";
import { pluginRoutes } from "../routes/plugins.js";
import { pluginJobStore } from "../services/plugin-job-store.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

/**
 * Regression coverage for tenant scoping on plugin operational reads.
 *
 * `plugin_logs`, `plugin_job_runs` and `plugin_webhook_deliveries` all carry a
 * `space_id` attribution (NULL for instance-scope rows). A operator member of
 * one space must not be able to read rows attributed to another space
 * through the plugin diagnostics routes; instance administrators keep the
 * instance-wide view.
 */

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping plugin operational-read tenant-scope tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

function issuePrefix(id: string) {
  return `T${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

type Actor = {
  type: "operator";
  source: string;
  userId: string;
  spaceIds: string[];
  memberships: Array<{ spaceId: string; membershipRole: string; status: string }>;
  isInstanceAdmin: boolean;
};

function buildApp(actor: Actor, db: ReturnType<typeof createDb>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { actor: Actor }).actor = actor;
    next();
  });
  app.use(
    "/api",
    pluginRoutes(
      db,
      {} as never,
      { jobStore: pluginJobStore(db) } as never,
      undefined,
      undefined,
      undefined,
    ),
  );
  app.use(errorHandler);
  return app;
}

describeEmbeddedPostgres("plugin operational reads are space-scoped", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  const spaceA = randomUUID();
  const spaceB = randomUUID();
  const pluginId = randomUUID();
  const jobId = randomUUID();

  const logA = randomUUID();
  const logB = randomUUID();
  const logInstance = randomUUID();

  const runA = randomUUID();
  const runB = randomUUID();
  const runInstance = randomUUID();

  const deliveryA = randomUUID();
  const deliveryB = randomUUID();
  const deliveryInstance = randomUUID();

  const operatorA: Actor = {
    type: "operator",
    source: "session",
    userId: `user-${randomUUID()}`,
    spaceIds: [spaceA],
    memberships: [{ spaceId: spaceA, membershipRole: "owner", status: "active" }],
    isInstanceAdmin: false,
  };

  const instanceAdmin: Actor = {
    type: "operator",
    source: "session",
    userId: `admin-${randomUUID()}`,
    spaceIds: [],
    memberships: [],
    isInstanceAdmin: true,
  };

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("outpost-plugin-operational-reads-");
    db = createDb(tempDb.connectionString);

    await db.insert(spaces).values([
      { id: spaceA, name: `Space A ${spaceA}`, issuePrefix: issuePrefix(spaceA) },
      { id: spaceB, name: `Space B ${spaceB}`, issuePrefix: issuePrefix(spaceB) },
    ]);

    await db.insert(plugins).values({
      id: pluginId,
      pluginKey: "outpost.operational-reads-test",
      packageName: "@outpost/plugin-operational-reads-test",
      version: "0.0.1",
      apiVersion: 1,
      categories: ["automation"],
      manifestJson: {
        id: "outpost.operational-reads-test",
        apiVersion: 1,
        name: "Operational reads test",
        version: "0.0.1",
        entrypoints: {},
        capabilities: [],
      } as never,
      status: "ready",
    });

    await db.insert(pluginJobs).values({
      id: jobId,
      pluginId,
      jobKey: "sync",
      schedule: "0 * * * *",
    });

    const base = Date.now();
    await db.insert(pluginLogs).values([
      { id: logA, pluginId, spaceId: spaceA, level: "info", message: "space A log", createdAt: new Date(base) },
      { id: logB, pluginId, spaceId: spaceB, level: "warn", message: "space B secret log", createdAt: new Date(base + 1_000) },
      { id: logInstance, pluginId, spaceId: null, level: "debug", message: "instance log", createdAt: new Date(base + 2_000) },
    ]);

    await db.insert(pluginJobRuns).values([
      { id: runA, jobId, pluginId, spaceId: spaceA, trigger: "manual", status: "succeeded", createdAt: new Date(base) },
      { id: runB, jobId, pluginId, spaceId: spaceB, trigger: "manual", status: "failed", error: "space B failure", logs: ["space B run log"], createdAt: new Date(base + 1_000) },
      { id: runInstance, jobId, pluginId, spaceId: null, trigger: "schedule", status: "succeeded", createdAt: new Date(base + 2_000) },
    ]);

    await db.insert(pluginWebhookDeliveries).values([
      { id: deliveryA, pluginId, spaceId: spaceA, webhookKey: "hook", status: "success", payload: { who: "A" }, createdAt: new Date(base) },
      { id: deliveryB, pluginId, spaceId: spaceB, webhookKey: "hook", status: "failed", error: "space B delivery error", payload: { who: "B" }, createdAt: new Date(base + 1_000) },
      { id: deliveryInstance, pluginId, spaceId: null, webhookKey: "hook", status: "success", payload: { who: "instance" }, createdAt: new Date(base + 2_000) },
    ]);
  }, 20_000);

  afterEach(async () => {
    // Fixtures are seeded once for the suite; nothing mutates them.
  });

  afterAll(async () => {
    await db.delete(pluginWebhookDeliveries);
    await db.delete(pluginJobRuns);
    await db.delete(pluginJobs);
    await db.delete(pluginLogs);
    await db.delete(plugins);
    await db.delete(spaces);
    await db.$client.end({ timeout: 1 }).catch(() => {});
    await tempDb?.cleanup();
    tempDb = null;
  });

  it("returns only the caller's space logs to a single-space operator member", async () => {
    const app = buildApp(operatorA, db);

    const res = await request(app).get(`/api/plugins/${pluginId}/logs`);

    expect(res.status).toBe(200);
    expect(res.body.map((row: { id: string }) => row.id)).toEqual([logA]);
    expect(res.body[0].spaceId).toBe(spaceA);
    expect(JSON.stringify(res.body)).not.toContain("space B secret log");
  });

  it("returns only the caller's space job runs to a single-space operator member", async () => {
    const app = buildApp(operatorA, db);

    const res = await request(app).get(`/api/plugins/${pluginId}/jobs/${jobId}/runs`);

    expect(res.status).toBe(200);
    expect(res.body.map((row: { id: string }) => row.id)).toEqual([runA]);
    expect(JSON.stringify(res.body)).not.toContain("space B failure");
  });

  it("scopes dashboard job runs and webhook deliveries to the caller's space", async () => {
    const app = buildApp(operatorA, db);

    const res = await request(app).get(`/api/plugins/${pluginId}/dashboard`);

    expect(res.status).toBe(200);
    expect(res.body.recentJobRuns.map((row: { id: string }) => row.id)).toEqual([runA]);
    expect(res.body.recentWebhookDeliveries.map((row: { id: string }) => row.id)).toEqual([
      deliveryA,
    ]);
    expect(JSON.stringify(res.body)).not.toContain("space B");
  });

  it("keeps the instance-wide view for instance administrators", async () => {
    const app = buildApp(instanceAdmin, db);

    const logs = await request(app).get(`/api/plugins/${pluginId}/logs`);
    const runs = await request(app).get(`/api/plugins/${pluginId}/jobs/${jobId}/runs`);
    const dashboard = await request(app).get(`/api/plugins/${pluginId}/dashboard`);

    expect(logs.status).toBe(200);
    expect(logs.body.map((row: { id: string }) => row.id)).toEqual([logInstance, logB, logA]);

    expect(runs.status).toBe(200);
    expect(runs.body.map((row: { id: string }) => row.id)).toEqual([runInstance, runB, runA]);

    expect(dashboard.status).toBe(200);
    expect(dashboard.body.recentJobRuns.map((row: { id: string }) => row.id)).toEqual([
      runInstance,
      runB,
      runA,
    ]);
    expect(dashboard.body.recentWebhookDeliveries.map((row: { id: string }) => row.id)).toEqual([
      deliveryInstance,
      deliveryB,
      deliveryA,
    ]);
  });
});
