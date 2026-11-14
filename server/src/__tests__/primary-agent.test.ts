import { createAgentLifecycle } from "../services/agent-lifecycle.js";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, agents, spaces, spaceMemberships, createDb } from "@outpost/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { primaryAgentRoutes } from "../routes/primary-agent.js";
import { primaryAgentService } from "../services/primary-agent.js";

const support = await getEmbeddedPostgresTestSupport();
if (!support.supported) console.warn(`Primary agent database tests unavailable: ${support.reason}`);

(support.supported ? describe : describe.skip)("default agent", () => {
  let db: ReturnType<typeof createDb>;
  let temp: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;

  beforeAll(async () => {
    temp = await startEmbeddedPostgresTestDatabase("outpost-space-primary-agent-");
    db = createDb(temp.connectionString);
  }, 30_000);
  afterAll(async () => { await temp?.cleanup(); });

  const actor = (spaceId: string, userId = "user-a"): Express.Request["actor"] => ({
    type: "operator",
    source: "session",
    userId,
    spaceIds: [spaceId],
    memberships: [{ spaceId, membershipRole: "admin", status: "active" }],
  });
  const localActor = (userId = "local-operator"): Express.Request["actor"] => ({
    type: "operator", source: "local_implicit", userId, isInstanceAdmin: true,
  });
  const app = (identity: Express.Request["actor"]) => {
    const result = express();
    result.use(express.json());
    result.use((req, _res, next) => { req.actor = identity; next(); });
    result.use("/api", primaryAgentRoutes(db));
    result.use(errorHandler);
    return result;
  };
  async function space() {
    const id = randomUUID();
    await db.insert(spaces).values({ id, name: "Primary test", issuePrefix: `P${id.slice(0, 7)}` });
    await db.insert(spaceMemberships).values(["user-a", "user-b"].map(principalId => ({
      spaceId: id,
      principalType: "user" as const,
      principalId,
      status: "active" as const,
      membershipRole: "admin" as const,
    })));
    return id;
  }
  const create = (spaceId: string, name: string, userId?: string) => createAgentLifecycle(db).requestCreation(spaceId, {
    name, adapterType: "process", status: "idle",
  }, { createdByUserId: userId });
  const get = (spaceId: string, userId = "user-a") => primaryAgentService(db).get(spaceId, userId);
  const url = (spaceId: string) => `/api/spaces/${spaceId}/primary-agent/me`;

  it("sets the first human-created agent as the shared Space primary", async () => {
    const c = await space();
    await create(c, "Provisioned");
    expect(await get(c)).toMatchObject({ primaryAgentId: null, initialized: false });
    const first = await create(c, "Maia", "user-a");
    await create(c, "Alex", "user-b");
    expect(await get(c, "user-a")).toMatchObject({ primaryAgentId: first.id, initialized: true });
    expect((await get(c, "user-b")).primaryAgentId).toBe(first.id);
  });

  it("arbitrates simultaneous creation and preserves an explicit replacement", async () => {
    const c = await space();
    const created = await Promise.all([create(c, "Maia", "user-a"), create(c, "Alex", "user-b")]);
    const initial = (await get(c)).primaryAgentId;
    expect(created.map(agent => agent.id)).toContain(initial);
    const replacement = created.find(agent => agent.id !== initial)!;
    await request(app(localActor())).put(url(c)).send({ primaryAgentId: replacement.id }).expect(200);
    await create(c, "Later", "user-a");
    expect((await get(c)).primaryAgentId).toBe(replacement.id);
  });

  it("rejects cross-Space targets and requires explicit configure authority", async () => {
    const c = await space();
    const other = await space();
    const local = await create(c, "Local", "user-a");
    const elsewhere = await create(other, "Elsewhere", "user-a");
    await request(app(actor(c))).put(url(c)).send({ primaryAgentId: local.id }).expect(403);
    await request(app(localActor())).put(url(c)).send({ primaryAgentId: elsewhere.id }).expect(404);
    await request(app(localActor())).put(url(c)).send({ primaryAgentId: local.id }).expect(200);
  });

  it("retains paused/error primaries and clears terminated primaries", async () => {
    const c = await space();
    const first = await create(c, "Maia", "user-a");
    await createAgentLifecycle(db).pauseAgent(first.id);
    expect((await get(c)).primaryAgentId).toBe(first.id);
    await db.update(agents).set({ status: "error", lifecycleState: "ready", lifecycleHolds: [] }).where(eq(agents.id, first.id));
    expect((await get(c)).primaryAgentId).toBe(first.id);
    await createAgentLifecycle(db).terminateAgent(first.id);
    expect(await get(c)).toMatchObject({ primaryAgentId: null, initialized: false });
    const next = await create(c, "Alex", "user-b");
    expect((await get(c)).primaryAgentId).toBe(next.id);
  });

  it("audits Space-level initialization, updates, and clearing", async () => {
    const c = await space();
    const first = await create(c, "Maia", "user-a");
    const next = await create(c, "Alex");
    await primaryAgentService(db).set(c, "user-a", next.id, localActor("user-a"));
    await createAgentLifecycle(db).terminateAgent(next.id);
    const events = await db.select().from(activityLog).where(and(
      eq(activityLog.spaceId, c),
      eq(activityLog.entityType, "space"),
    ));
    expect(events.filter(event => event.action.startsWith("primary_agent.")).map(event => event.action).sort()).toEqual([
      "primary_agent.cleared", "primary_agent.initialized", "primary_agent.updated",
    ]);
    expect(events.some(event => event.entityId === c && JSON.stringify(event.details).includes(first.id))).toBe(true);
  });

  it("rejects creation inside a caller transaction", async () => {
    const c = await space();
    await expect(db.transaction(async tx => {
      await createAgentLifecycle(tx as unknown as typeof db).requestCreation(c, {
        name: "Rolled back", adapterType: "process",
      }, { createdByUserId: "user-a" });
      throw new Error("rollback");
    })).rejects.toThrow("root database");
    expect(await get(c)).toMatchObject({ primaryAgentId: null, initialized: false });
    expect(await db.select().from(agents).where(eq(agents.spaceId, c))).toHaveLength(0);
  });
});
