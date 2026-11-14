import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agents,
  agentRuntimeState,
  approvals,
  spaces,
  spaceMemberships,
  createDb,
  heartbeatRuns,
  principalPermissionGrants,
} from "@outpost/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { agentRoutes } from "../routes/agents.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping agent-create idempotency route tests on this host: ${
      embeddedPostgresSupport.reason ?? "unsupported environment"
    }`,
  );
}

type Db = ReturnType<typeof createDb>;

/**
 * Seed a space, a creation agent that carries the standard-trust
 * `canCreateAgents` permission, and a running heartbeat run for that agent. The
 * create route authorizes the agent through the legacy `agents:create` path, and
 * the run id is what the idempotency guard keys on.
 */
async function seedCreationFixture(db: Db) {
  const nonce = randomUUID().slice(0, 8);
  const [space] = await db
    .insert(spaces)
    .values({
      name: `Idempotency Co ${nonce}`,
      issuePrefix: `ID${nonce.slice(0, 4).toUpperCase()}`,
      defaultResponsibleUserId: "operator-user",
      // Direct creations (no operator approval) mirror the reported QA org where the
      // duplicate "Sam 2" agent was actually created.
      requireOperatorApprovalForNewAgents: false,
    })
    .returning();
  const [creatingAgent] = await db
    .insert(agents)
    .values({
      spaceId: space!.id,
      name: "Chief Of Staff",
      role: "general",
      adapterType: "process",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: { canCreateAgents: true },
    })
    .returning();
  const [run] = await db
    .insert(heartbeatRuns)
    .values({
      spaceId: space!.id,
      agentId: creatingAgent!.id,
      status: "running",
      contextSnapshot: {},
    })
    .returning();
  return { space: space!, creatingAgent: creatingAgent!, run: run! };
}

function agentActor(spaceId: string, agentId: string, runId: string): Express.Request["actor"] {
  return {
    type: "agent",
    agentId,
    spaceId,
    runId,
    source: "agent_jwt",
  };
}

function createApp(db: Db, actor: Express.Request["actor"]) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api", agentRoutes(db));
  app.use(errorHandler);
  return app;
}

describeEmbeddedPostgres("agent create idempotency within a run", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("outpost-agent-create-idempotency-");
    db = createDb(tempDb.connectionString);
    // Embedded Postgres cold-starts slowly on a loaded machine.
  }, 60_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(approvals);
    await db.delete(heartbeatRuns);
    await db.delete(principalPermissionGrants);
    await db.delete(spaceMemberships);
    await db.delete(agentRuntimeState);
    await db.delete(agents);
    await db.delete(spaces);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("returns the existing create when the same run re-posts an identical payload", async () => {
    const { space, creatingAgent, run } = await seedCreationFixture(db);
    const app = createApp(db, agentActor(space.id, creatingAgent.id, run.id));
    const payload = { name: "Sam", role: "engineer", title: "Store Builder", adapterType: "process" as const };

    const first = await request(app).post(`/api/spaces/${space.id}/agent-creations`).send(payload);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.agent?.name).toBe("Sam");
    const createdId = first.body.agent?.id as string;

    // The agent misreads the wrapped 201 body and re-sends the identical payload.
    const second = await request(app).post(`/api/spaces/${space.id}/agent-creations`).send(payload);
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body.idempotent).toBe(true);
    expect(second.body.agent?.id).toBe(createdId);
    expect(first.body.agent?.appearance).toMatchObject({ schemaVersion: 1, characterVersion: "cap-v1" });
    expect(second.body.agent?.appearance).toEqual(first.body.agent?.appearance);
    // The retry must not have auto-renamed a duplicate to "Sam 2".
    expect(second.body.agent?.name).toBe("Sam");

    const samAgents = await db
      .select({ id: agents.id, name: agents.name })
      .from(agents)
      .where(and(eq(agents.spaceId, space.id), eq(agents.role, "engineer")));
    expect(samAgents.map((row) => row.name)).toEqual(["Sam"]);
  });

  it("creates one agent when two identical retries overlap in the same run", async () => {
    const { space, creatingAgent, run } = await seedCreationFixture(db);
    const app = createApp(db, agentActor(space.id, creatingAgent.id, run.id));
    const payload = { name: "Sam", role: "engineer", title: "Store Builder", adapterType: "process" as const };

    // Both requests are in flight at once, so neither can see the other's
    // activity record unless the route serializes them.
    const [first, second] = await Promise.all([
      request(app).post(`/api/spaces/${space.id}/agent-creations`).send(payload),
      request(app).post(`/api/spaces/${space.id}/agent-creations`).send(payload),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses, JSON.stringify([first.body, second.body])).toEqual([200, 201]);
    const created = first.status === 201 ? first : second;
    const replayed = first.status === 200 ? first : second;
    expect(replayed.body.idempotent).toBe(true);
    expect(replayed.body.agent?.id).toBe(created.body.agent?.id);

    const samAgents = await db
      .select({ name: agents.name })
      .from(agents)
      .where(and(eq(agents.spaceId, space.id), eq(agents.role, "engineer")));
    expect(samAgents.map((row) => row.name)).toEqual(["Sam"]);
  });

  it("treats a changed payload in the same run as a new create, not a retry", async () => {
    const { space, creatingAgent, run } = await seedCreationFixture(db);
    const app = createApp(db, agentActor(space.id, creatingAgent.id, run.id));

    const first = await request(app)
      .post(`/api/spaces/${space.id}/agent-creations`)
      .send({ name: "Sam", role: "engineer", adapterType: "process" });
    expect(first.status, JSON.stringify(first.body)).toBe(201);

    // Same identity, corrected configuration: the agent meant a different create.
    const corrected = await request(app)
      .post(`/api/spaces/${space.id}/agent-creations`)
      .send({ name: "Sam", role: "engineer", adapterType: "process", title: "Store Builder" });
    expect(corrected.status, JSON.stringify(corrected.body)).toBe(201);
    expect(corrected.body.idempotent).toBeUndefined();
    expect(corrected.body.agent?.id).not.toBe(first.body.agent?.id);
    expect(corrected.body.agent?.title).toBe("Store Builder");
  });

  it("still creates a distinct agent for a different create in the same run", async () => {
    const { space, creatingAgent, run } = await seedCreationFixture(db);
    const app = createApp(db, agentActor(space.id, creatingAgent.id, run.id));

    const sam = await request(app)
      .post(`/api/spaces/${space.id}/agent-creations`)
      .send({ name: "Sam", role: "engineer", adapterType: "process" });
    expect(sam.status, JSON.stringify(sam.body)).toBe(201);

    const casey = await request(app)
      .post(`/api/spaces/${space.id}/agent-creations`)
      .send({ name: "Casey", role: "designer", adapterType: "process" });
    expect(casey.status, JSON.stringify(casey.body)).toBe(201);
    expect(casey.body.agent?.id).not.toBe(sam.body.agent?.id);

    const names = await db
      .select({ name: agents.name })
      .from(agents)
      .where(eq(agents.spaceId, space.id));
    expect(names.map((row) => row.name).sort()).toEqual(["Casey", "Chief Of Staff", "Sam"]);
  });

  it("does not deduplicate identical creations across different runs", async () => {
    const { space, creatingAgent, run } = await seedCreationFixture(db);
    const [secondRun] = await db
      .insert(heartbeatRuns)
      .values({ spaceId: space.id, agentId: creatingAgent.id, status: "running", contextSnapshot: {} })
      .returning();
    const payload = { name: "Sam", role: "engineer", adapterType: "process" as const };

    const firstRunApp = createApp(db, agentActor(space.id, creatingAgent.id, run.id));
    const firstRunCreate = await request(firstRunApp)
      .post(`/api/spaces/${space.id}/agent-creations`)
      .send(payload);
    expect(firstRunCreate.status, JSON.stringify(firstRunCreate.body)).toBe(201);

    const secondRunApp = createApp(db, agentActor(space.id, creatingAgent.id, secondRun!.id));
    const secondRunCreate = await request(secondRunApp).post(`/api/spaces/${space.id}/agent-creations`).send(payload);
    // A genuinely separate run is not a retry, so the legacy dedup names it "Sam 2".
    expect(secondRunCreate.status, JSON.stringify(secondRunCreate.body)).toBe(201);
    expect(secondRunCreate.body.idempotent).toBeUndefined();
    expect(secondRunCreate.body.agent?.name).toBe("Sam 2");
  });
});
