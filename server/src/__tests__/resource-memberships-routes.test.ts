import { randomUUID } from "node:crypto";
import express from "express";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agentMemberships,
  agents,
  spaces,
  createDb,
  documentMemberships,
  documents,
  projectMemberships,
  projects,
} from "@outpost/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { resourceMembershipRoutes } from "../routes/resource-memberships.js";
import { errorHandler } from "../middleware/index.js";
import { resourceMembershipService } from "../services/resource-memberships.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres resource membership tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

function operatorActor(spaceId: string, role: "admin" | "operator" | "viewer" = "viewer") {
  return {
    type: "operator" as const,
    userId: "user-1",
    source: "session" as const,
    isInstanceAdmin: false,
    spaceIds: [spaceId],
    memberships: [{ spaceId, membershipRole: role, status: "active" }],
  };
}

function createApp(db: ReturnType<typeof createDb>, actor: Express.Request["actor"]) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api", resourceMembershipRoutes(db));
  app.use(errorHandler);
  return app;
}

describeEmbeddedPostgres("resource membership routes", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("outpost-resource-memberships-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(documentMemberships);
    await db.delete(projectMemberships);
    await db.delete(agentMemberships);
    await db.delete(documents);
    await db.delete(projects);
    await db.delete(agents);
    await db.delete(spaces);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seed() {
    const spaceId = randomUUID();
    const otherSpaceId = randomUUID();
    const projectId = randomUUID();
    const otherProjectId = randomUUID();
    const archivedProjectId = randomUUID();
    const agentId = randomUUID();
    const otherAgentId = randomUUID();
    const terminatedAgentId = randomUUID();
    const documentId = randomUUID();
    const otherDocumentId = randomUUID();
    await db.insert(spaces).values([
      {
        id: spaceId,
        name: "Outpost",
        issuePrefix: `T${spaceId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
        requireOperatorApprovalForNewAgents: false,
      },
      {
        id: otherSpaceId,
        name: "Other",
        issuePrefix: `T${otherSpaceId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
        requireOperatorApprovalForNewAgents: false,
      },
    ]);
    await db.insert(documents).values([
      { id: documentId, spaceId, title: "Plan", latestBody: "Plan body", createdByUserId: "user-1" },
      { id: otherDocumentId, spaceId: otherSpaceId, title: "Other", latestBody: "Other body" },
    ]);
    await db.insert(projects).values([
      { id: projectId, spaceId, name: "Growth", status: "in_progress" },
      { id: archivedProjectId, spaceId, name: "Archived", status: "completed", archivedAt: new Date() },
      { id: otherProjectId, spaceId: otherSpaceId, name: "Other", status: "in_progress" },
    ]);
    await db.insert(agents).values([
      {
        id: agentId,
        spaceId,
        name: "CodexCoder",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: otherAgentId,
        spaceId: otherSpaceId,
        name: "OtherAgent",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: terminatedAgentId,
        spaceId,
        name: "Terminated",
        role: "engineer",
        status: "terminated",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);
    return {
      archivedProjectId,
      spaceId,
      documentId,
      otherAgentId,
      otherDocumentId,
      otherProjectId,
      projectId,
      agentId,
      terminatedAgentId,
    };
  }

  it("defaults missing membership rows to joined", async () => {
    const { spaceId } = await seed();
    const app = createApp(db, operatorActor(spaceId));

    const res = await request(app).get(`/api/spaces/${spaceId}/resource-memberships/me`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      projectMemberships: {},
      agentMemberships: {},
      starredProjectIds: [],
      starredAgentIds: [],
      starredDocumentIds: [],
      projectStarredAt: {},
      agentStarredAt: {},
      documentStarredAt: {},
      updatedAt: null,
    });
  });

  it("allows viewer self-service mutations, logs changes, and keeps repeats idempotent", async () => {
    const { spaceId, projectId } = await seed();
    const app = createApp(db, operatorActor(spaceId, "viewer"));

    const first = await request(app)
      .put(`/api/spaces/${spaceId}/resource-memberships/me/projects/${projectId}`)
      .send({ state: "left" });
    const second = await request(app)
      .put(`/api/spaces/${spaceId}/resource-memberships/me/projects/${projectId}`)
      .send({ state: "left" });

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ resourceType: "project", resourceId: projectId, state: "left", starredAt: null });
    expect(second.status).toBe(200);

    const rows = await db.select().from(projectMemberships);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ spaceId, projectId, userId: "user-1", state: "left" });

    const activity = await db.select().from(activityLog);
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({
      spaceId,
      actorType: "user",
      actorId: "user-1",
      action: "resource_membership.left",
      entityType: "project",
      entityId: projectId,
    });
  });

  it("stars projects idempotently and exposes starred project contract data", async () => {
    const { spaceId, projectId } = await seed();
    const app = createApp(db, operatorActor(spaceId, "viewer"));

    const first = await request(app)
      .put(`/api/spaces/${spaceId}/resource-memberships/me/projects/${projectId}`)
      .send({ starred: true });
    const second = await request(app)
      .put(`/api/spaces/${spaceId}/resource-memberships/me/projects/${projectId}`)
      .send({ starred: true });
    const list = await request(app).get(`/api/spaces/${spaceId}/resource-memberships/me`);

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ resourceType: "project", resourceId: projectId, state: "joined" });
    expect(first.body.starredAt).toEqual(expect.any(String));
    expect(second.status).toBe(200);
    expect(second.body.starredAt).toBe(first.body.starredAt);
    expect(list.body.starredProjectIds).toEqual([projectId]);
    expect(list.body.projectStarredAt[projectId]).toEqual(first.body.starredAt);

    const rows = await db.select().from(projectMemberships);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ spaceId, projectId, userId: "user-1", state: "joined" });
    expect(rows[0]?.starredAt).toBeInstanceOf(Date);

    const activity = await db.select().from(activityLog);
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({
      action: "resource_membership.starred",
      entityType: "project",
      entityId: projectId,
    });
    expect(activity[0]?.details).toMatchObject({
      userId: "user-1",
      resourceType: "project",
      resourceId: projectId,
      state: "joined",
      starred: true,
    });
  });

  it("clears starred_at when leaving a starred resource", async () => {
    const { spaceId, projectId } = await seed();
    const app = createApp(db, operatorActor(spaceId));

    await request(app)
      .put(`/api/spaces/${spaceId}/resource-memberships/me/projects/${projectId}`)
      .send({ starred: true })
      .expect(200);
    const leave = await request(app)
      .put(`/api/spaces/${spaceId}/resource-memberships/me/projects/${projectId}`)
      .send({ state: "left" });

    expect(leave.status).toBe(200);
    expect(leave.body).toMatchObject({ state: "left", starredAt: null });
    const [row] = await db.select().from(projectMemberships);
    expect(row).toMatchObject({ state: "left", starredAt: null });

    const activity = await db.select().from(activityLog);
    expect(activity.map((entry) => entry.action)).toEqual([
      "resource_membership.starred",
      "resource_membership.left",
    ]);
    expect(activity[1]?.details).toMatchObject({ state: "left", starred: false, starredAt: null });
  });

  it("starring a left resource rejoins it", async () => {
    const { spaceId, agentId } = await seed();
    const app = createApp(db, operatorActor(spaceId));

    await request(app)
      .put(`/api/spaces/${spaceId}/resource-memberships/me/agents/${agentId}`)
      .send({ state: "left" })
      .expect(200);
    const star = await request(app)
      .put(`/api/spaces/${spaceId}/resource-memberships/me/agents/${agentId}`)
      .send({ starred: true });

    expect(star.status).toBe(200);
    expect(star.body).toMatchObject({ resourceType: "agent", resourceId: agentId, state: "joined" });
    expect(star.body.starredAt).toEqual(expect.any(String));

    const [row] = await db.select().from(agentMemberships);
    expect(row).toMatchObject({ state: "joined" });
    expect(row?.starredAt).toBeInstanceOf(Date);

    const activity = await db.select().from(activityLog);
    expect(activity.map((entry) => entry.action)).toEqual([
      "resource_membership.left",
      "resource_membership.starred",
    ]);
  });

  it("unstars agents idempotently without requiring a state change", async () => {
    const { spaceId, agentId } = await seed();
    const app = createApp(db, operatorActor(spaceId));

    await request(app)
      .put(`/api/spaces/${spaceId}/resource-memberships/me/agents/${agentId}`)
      .send({ starred: true })
      .expect(200);
    const first = await request(app)
      .put(`/api/spaces/${spaceId}/resource-memberships/me/agents/${agentId}`)
      .send({ starred: false });
    const second = await request(app)
      .put(`/api/spaces/${spaceId}/resource-memberships/me/agents/${agentId}`)
      .send({ starred: false });

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ state: "joined", starredAt: null });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ state: "joined", starredAt: null });

    const [row] = await db.select().from(agentMemberships);
    expect(row).toMatchObject({ state: "joined", starredAt: null });

    const activity = await db.select().from(activityLog);
    expect(activity.map((entry) => entry.action)).toEqual([
      "resource_membership.starred",
      "resource_membership.unstarred",
    ]);
  });

  it("omits archived projects and terminated agents from starred sidebar data", async () => {
    const { archivedProjectId, spaceId, terminatedAgentId } = await seed();
    const starredAt = new Date();
    await db.insert(projectMemberships).values({
      spaceId,
      projectId: archivedProjectId,
      userId: "user-1",
      state: "joined",
      starredAt,
    });
    await db.insert(agentMemberships).values({
      spaceId,
      agentId: terminatedAgentId,
      userId: "user-1",
      state: "joined",
      starredAt,
    });
    const app = createApp(db, operatorActor(spaceId));

    const res = await request(app).get(`/api/spaces/${spaceId}/resource-memberships/me`);

    expect(res.status).toBe(200);
    expect(res.body.projectMemberships[archivedProjectId]).toBe("joined");
    expect(res.body.agentMemberships[terminatedAgentId]).toBe("joined");
    expect(res.body.starredProjectIds).toEqual([]);
    expect(res.body.starredAgentIds).toEqual([]);
    expect(res.body.projectStarredAt).toEqual({});
    expect(res.body.agentStarredAt).toEqual({});
  });

  it("rejects starring archived projects and terminated agents", async () => {
    const { archivedProjectId, spaceId, terminatedAgentId } = await seed();
    const app = createApp(db, operatorActor(spaceId));

    const projectRes = await request(app)
      .put(`/api/spaces/${spaceId}/resource-memberships/me/projects/${archivedProjectId}`)
      .send({ starred: true });
    const agentRes = await request(app)
      .put(`/api/spaces/${spaceId}/resource-memberships/me/agents/${terminatedAgentId}`)
      .send({ starred: true });

    expect(projectRes.status).toBe(404);
    expect(agentRes.status).toBe(404);
  });

  it("rejects agent API key actors", async () => {
    const { spaceId, agentId } = await seed();
    const app = createApp(db, {
      type: "agent",
      agentId,
      spaceId,
      source: "agent_key",
    });

    const res = await request(app).get(`/api/spaces/${spaceId}/resource-memberships/me`);

    expect(res.status).toBe(403);
  });

  it("rejects cross-space target resources", async () => {
    const { spaceId, otherAgentId, otherProjectId } = await seed();
    const app = createApp(db, operatorActor(spaceId));

    const projectRes = await request(app)
      .put(`/api/spaces/${spaceId}/resource-memberships/me/projects/${otherProjectId}`)
      .send({ state: "left" });
    const agentRes = await request(app)
      .put(`/api/spaces/${spaceId}/resource-memberships/me/agents/${otherAgentId}`)
      .send({ state: "left" });

    expect(projectRes.status).toBe(404);
    expect(agentRes.status).toBe(404);
    await expect(db.select().from(projectMemberships)).resolves.toHaveLength(0);
    await expect(db.select().from(agentMemberships)).resolves.toHaveLength(0);
  });

  it("denies direct service calls that try to mutate another user's membership", async () => {
    const { spaceId, projectId } = await seed();
    const svc = resourceMembershipService(db);

    await expect(
      svc.updateProject({
        spaceId,
        projectId,
        userId: "other-user",
        state: "left",
        actor: operatorActor(spaceId),
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("stars and unstars documents idempotently and cascades on document deletion", async () => {
    const { spaceId, documentId } = await seed();
    const app = createApp(db, operatorActor(spaceId));

    const [first, second] = await Promise.all([
      request(app)
        .put(`/api/spaces/${spaceId}/resource-memberships/me/documents/${documentId}`)
        .send({ starred: true }),
      request(app)
        .put(`/api/spaces/${spaceId}/resource-memberships/me/documents/${documentId}`)
        .send({ starred: true }),
    ]);
    const list = await request(app).get(`/api/spaces/${spaceId}/resource-memberships/me`);

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ resourceType: "document", resourceId: documentId, starredAt: expect.any(String) });
    expect(second.status).toBe(200);
    expect(second.body.starredAt).toBe(first.body.starredAt);
    expect(list.body.starredDocumentIds).toEqual([documentId]);
    expect(list.body.documentStarredAt[documentId]).toBe(first.body.starredAt);
    await expect(db.select().from(documentMemberships)).resolves.toHaveLength(1);

    const unstars = await Promise.all([
      request(app)
        .put(`/api/spaces/${spaceId}/resource-memberships/me/documents/${documentId}`)
        .send({ starred: false }),
      request(app)
        .put(`/api/spaces/${spaceId}/resource-memberships/me/documents/${documentId}`)
        .send({ starred: false }),
    ]);
    expect(unstars.map((response) => response.status)).toEqual([200, 200]);
    await expect(db.select().from(documentMemberships)).resolves.toHaveLength(0);

    await request(app)
      .put(`/api/spaces/${spaceId}/resource-memberships/me/documents/${documentId}`)
      .send({ starred: true })
      .expect(200);
    await db.delete(documents).where(eq(documents.id, documentId));
    await expect(db.select().from(documentMemberships)).resolves.toHaveLength(0);

    const activity = await db.select().from(activityLog);
    expect(activity.map((entry) => entry.action)).toEqual([
      "resource_membership.starred",
      "resource_membership.unstarred",
      "resource_membership.starred",
    ]);
    expect(activity[0]).toMatchObject({ entityType: "document", entityId: documentId });
  });

  it("returns identical 404s for cross-space documents", async () => {
    const { spaceId, otherDocumentId } = await seed();
    const app = createApp(db, operatorActor(spaceId));

    const response = await request(app)
      .put(`/api/spaces/${spaceId}/resource-memberships/me/documents/${otherDocumentId}`)
      .send({ starred: true });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Document not found");
    await expect(db.select().from(documentMemberships)).resolves.toHaveLength(0);
  });
});
