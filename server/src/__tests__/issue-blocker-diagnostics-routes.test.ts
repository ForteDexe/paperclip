import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  spaces,
  createDb,
  heartbeatRuns,
  issueRelations,
  issues,
  projects,
} from "@outpost/db";
import { LOW_TRUST_REVIEW_PRESET } from "@outpost/shared";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres blocker diagnostic route tests on this host: ${
      embeddedPostgresSupport.reason ?? "unsupported environment"
    }`,
  );
}

type Db = ReturnType<typeof createDb>;
type SpaceRow = typeof spaces.$inferSelect;
type AgentRow = typeof agents.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;
type IssueRow = typeof issues.$inferSelect;

function createApp(db: Db, actor: Express.Request["actor"]) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api", issueRoutes(db, {} as any));
  app.use(errorHandler);
  return app;
}

function operatorActor(space: SpaceRow): Express.Request["actor"] {
  return {
    type: "operator",
    userId: "operator-user",
    spaceIds: [space.id],
    memberships: [{ spaceId: space.id, membershipRole: "operator", status: "active" }],
    isInstanceAdmin: true,
    source: "local_implicit",
  };
}

function agentActor(space: SpaceRow, agent: AgentRow, runId: string): Express.Request["actor"] {
  return {
    type: "agent",
    agentId: agent.id,
    spaceId: space.id,
    runId,
    source: "agent_jwt",
  };
}

async function seedSpace(db: Db, label = "Diagnostics") {
  const nonce = randomUUID().slice(0, 8);
  const [space] = await db.insert(spaces).values({
    name: `${label} ${nonce}`,
    issuePrefix: `DG${nonce.slice(0, 4).toUpperCase()}`,
    defaultResponsibleUserId: "operator-user",
  }).returning();
  return space!;
}

async function seedAgent(db: Db, spaceId: string, permissions: Record<string, unknown> = {}) {
  const [agent] = await db.insert(agents).values({
    spaceId,
    name: `Agent ${randomUUID().slice(0, 6)}`,
    role: "engineer",
    adapterType: "process",
    adapterConfig: {},
    runtimeConfig: {},
    permissions,
  }).returning();
  return agent!;
}

async function seedProject(db: Db, spaceId: string, name: string) {
  const [project] = await db.insert(projects).values({
    spaceId,
    name,
    status: "in_progress",
  }).returning();
  return project!;
}

async function seedIssue(
  db: Db,
  input: {
    spaceId: string;
    projectId?: string | null;
    title: string;
    status?: string;
    assigneeAgentId?: string | null;
    parentId?: string | null;
  },
) {
  const [issue] = await db.insert(issues).values({
    spaceId: input.spaceId,
    projectId: input.projectId ?? null,
    parentId: input.parentId ?? null,
    title: input.title,
    status: input.status ?? "todo",
    priority: "medium",
    assigneeAgentId: input.assigneeAgentId ?? null,
    responsibleUserId: "operator-user",
  }).returning();
  return issue!;
}

async function blockIssue(db: Db, spaceId: string, blockerIssueId: string, blockedIssueId: string) {
  await db.insert(issueRelations).values({
    spaceId,
    issueId: blockerIssueId,
    relatedIssueId: blockedIssueId,
    type: "blocks",
  });
}

async function attachLowTrustRun(db: Db, fixture: {
  space: SpaceRow;
  agent: AgentRow;
  allowedProject: ProjectRow;
  root: IssueRow;
  visibleBlocker: IssueRow;
}) {
  const executionPolicy = {
    authorizationPolicy: {
      trustBoundary: {
        mode: LOW_TRUST_REVIEW_PRESET,
        spaceId: fixture.space.id,
        projectIds: [fixture.allowedProject.id],
        rootIssueId: fixture.root.id,
        issueIds: [fixture.root.id, fixture.visibleBlocker.id],
        allowedAgentIds: [],
      },
    },
  };
  await db.update(agents).set({
    permissions: {
      trustPreset: LOW_TRUST_REVIEW_PRESET,
      authorizationPolicy: executionPolicy.authorizationPolicy,
    },
  }).where(eq(agents.id, fixture.agent.id));
  fixture.agent.permissions = {
    trustPreset: LOW_TRUST_REVIEW_PRESET,
    authorizationPolicy: executionPolicy.authorizationPolicy,
  };

  const [run] = await db.insert(heartbeatRuns).values({
    spaceId: fixture.space.id,
    agentId: fixture.agent.id,
    status: "running",
    contextSnapshot: {
      issueId: fixture.root.id,
      executionPolicy,
    },
  }).returning();
  await db.update(issues).set({
    assigneeAgentId: fixture.agent.id,
    checkoutRunId: run!.id,
    executionRunId: run!.id,
    executionPolicy,
  }).where(eq(issues.id, fixture.root.id));
  return run!;
}

describeEmbeddedPostgres("issue blocker diagnostics route", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("outpost-issue-blocker-diagnostics-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueRelations);
    await db.delete(heartbeatRuns);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(projects);
    await db.delete(spaces);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("returns stale-blocker diagnosis and anomaly flags for a done blocker on a blocked issue", async () => {
    const space = await seedSpace(db);
    const agent = await seedAgent(db, space.id);
    const project = await seedProject(db, space.id, "Core");
    const root = await seedIssue(db, {
      spaceId: space.id,
      projectId: project.id,
      title: "Ship root",
      status: "blocked",
      assigneeAgentId: agent.id,
    });
    const blocker = await seedIssue(db, {
      spaceId: space.id,
      projectId: project.id,
      title: "Finished blocker",
      status: "done",
    });
    await blockIssue(db, space.id, blocker.id, root.id);

    const res = await request(createApp(db, operatorActor(space)))
      .get(`/api/issues/${root.id}/diagnostics/blockers`);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      diagnosis: expect.stringContaining("stale blocker hold"),
      readiness: {
        allBlockersDone: true,
        isDependencyReady: true,
        unresolvedBlockerCount: 0,
        pendingFinalizeBlockerCount: 0,
      },
      omittedUnauthorizedBlockerCount: 0,
      truncated: false,
    });
    expect(res.body.blockers).toHaveLength(1);
    expect(res.body.blockers[0]).toMatchObject({
      id: blocker.id,
      status: "done",
      isDependencyReady: true,
      flags: ["done_but_blocking"],
    });
  });

  it("returns null diagnosis for an unblocked issue with no blocker relations", async () => {
    const space = await seedSpace(db);
    const project = await seedProject(db, space.id, "Core");
    const issue = await seedIssue(db, {
      spaceId: space.id,
      projectId: project.id,
      title: "Ready work",
      status: "todo",
    });

    const res = await request(createApp(db, operatorActor(space)))
      .get(`/api/issues/${issue.id}/diagnostics/blockers`);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.diagnosis).toBeNull();
    expect(res.body.blockers).toEqual([]);
    expect(res.body.readiness).toMatchObject({
      allBlockersDone: true,
      isDependencyReady: true,
      unresolvedBlockerCount: 0,
      pendingFinalizeBlockerCount: 0,
    });
  });

  it("omits unauthorized blocker nodes and derives diagnosis only from visible data", async () => {
    const space = await seedSpace(db);
    const agent = await seedAgent(db, space.id);
    const allowedProject = await seedProject(db, space.id, "Allowed");
    const hiddenProject = await seedProject(db, space.id, "Hidden");
    const hiddenMarker = `HIDDEN-BLOCKER-${randomUUID()}`;
    const root = await seedIssue(db, {
      spaceId: space.id,
      projectId: allowedProject.id,
      title: "Scoped root",
      status: "blocked",
    });
    const visibleBlocker = await seedIssue(db, {
      spaceId: space.id,
      projectId: allowedProject.id,
      title: "Visible blocker",
      status: "in_progress",
    });
    const hiddenBlocker = await seedIssue(db, {
      spaceId: space.id,
      projectId: hiddenProject.id,
      title: hiddenMarker,
      status: "cancelled",
    });
    await blockIssue(db, space.id, visibleBlocker.id, root.id);
    await blockIssue(db, space.id, hiddenBlocker.id, root.id);
    const run = await attachLowTrustRun(db, { space, agent, allowedProject, root, visibleBlocker });

    const res = await request(createApp(db, agentActor(space, agent, run.id)))
      .get(`/api/issues/${root.id}/diagnostics/blockers`);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.blockers).toHaveLength(1);
    expect(res.body.blockers[0]).toMatchObject({
      id: visibleBlocker.id,
      status: "in_progress",
      isUnresolved: true,
    });
    expect(res.body.readiness).toBeNull();
    expect(res.body.omittedUnauthorizedBlockerCount).toBe(1);
    expect(res.body.diagnosis).toContain("authorization boundary");
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(hiddenBlocker.id);
    expect(serialized).not.toContain(hiddenMarker);
    expect(serialized).not.toContain("cancelled");
    expect(serialized).not.toContain("payload");
    expect(serialized).not.toContain("details");
    expect(serialized).not.toContain("triggerDetail");
    expect(serialized).not.toContain("error");
  });

  it("denies cross-space issue reads", async () => {
    const spaceA = await seedSpace(db, "Space A");
    const spaceB = await seedSpace(db, "Space B");
    const agentB = await seedAgent(db, spaceB.id);
    const projectA = await seedProject(db, spaceA.id, "A");
    const issueA = await seedIssue(db, {
      spaceId: spaceA.id,
      projectId: projectA.id,
      title: "Space A issue",
      status: "blocked",
    });
    const [runB] = await db.insert(heartbeatRuns).values({
      spaceId: spaceB.id,
      agentId: agentB.id,
      status: "running",
      contextSnapshot: { issueId: issueA.id },
    }).returning();

    const res = await request(createApp(db, agentActor(spaceB, agentB, runB!.id)))
      .get(`/api/issues/${issueA.id}/diagnostics/blockers`);

    // Uniform 404 so cross-tenant ids are indistinguishable from missing ones.
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(res.body.error).toBe("Issue not found");
  });

  it("caps blocker output and withholds readiness when truncated", async () => {
    const space = await seedSpace(db);
    const project = await seedProject(db, space.id, "Core");
    const root = await seedIssue(db, {
      spaceId: space.id,
      projectId: project.id,
      title: "Wide blocked issue",
      status: "blocked",
    });
    const blockerRows = [];
    for (let index = 0; index < 101; index += 1) {
      blockerRows.push({
        spaceId: space.id,
        projectId: project.id,
        title: `Blocker ${String(index).padStart(3, "0")}`,
        status: "done",
        priority: "medium",
        responsibleUserId: "operator-user",
      });
    }
    const insertedBlockers = await db.insert(issues).values(blockerRows).returning();
    await db.insert(issueRelations).values(insertedBlockers.map((blocker) => ({
      spaceId: space.id,
      issueId: blocker.id,
      relatedIssueId: root.id,
      type: "blocks" as const,
    })));

    const res = await request(createApp(db, operatorActor(space)))
      .get(`/api/issues/${root.id}/diagnostics/blockers`);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.blockers).toHaveLength(100);
    expect(res.body.truncated).toBe(true);
    expect(res.body.readiness).toBeNull();
    expect(res.body.omittedUnauthorizedBlockerCount).toBeNull();
    expect(res.body.diagnosis).toContain("truncated at 100 blockers");
    expect(res.body.caps).toEqual({ maxBlockers: 100 });
  });
});
