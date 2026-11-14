import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { activityLog, spaces, spaceMemberships, createDb, environments, projectAccessMembers, projects } from "@outpost/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { projectRoutes } from "../routes/projects.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres project list archived tests on this host: ${
      embeddedPostgresSupport.reason ?? "unsupported environment"
    }`,
  );
}

function operatorActor(spaceId: string): Express.Request["actor"] {
  return {
    type: "operator",
    userId: "user-1",
    source: "session",
    isInstanceAdmin: true,
    spaceIds: [spaceId],
    memberships: [{ spaceId, membershipRole: "admin", status: "active" }],
  };
}

function createApp(db: ReturnType<typeof createDb>, actor: Express.Request["actor"]) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api", projectRoutes(db));
  app.use(errorHandler);
  return app;
}

describeEmbeddedPostgres("project list archived route defaults", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("outpost-projects-list-archived-");
    db = createDb(tempDb.connectionString);
  }, 120_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(spaceMemberships);
    await db.delete(projects);
    await db.delete(spaces);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seed() {
    const spaceId = randomUUID();
    const activeProjectId = randomUUID();
    const archivedProjectId = randomUUID();

    await db.insert(spaces).values({
      id: spaceId,
      name: "Outpost",
      issuePrefix: `T${spaceId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireOperatorApprovalForNewAgents: false,
    });
    await db.insert(projects).values([
      { id: activeProjectId, spaceId, name: "Active Project", status: "in_progress" },
      {
        id: archivedProjectId,
        spaceId,
        name: "Archived Project",
        status: "completed",
        archivedAt: new Date(),
      },
    ]);

    return { activeProjectId, archivedProjectId, spaceId };
  }

  it("omits archived projects by default", async () => {
    const { activeProjectId, archivedProjectId, spaceId } = await seed();
    const app = createApp(db, operatorActor(spaceId));

    const res = await request(app).get(`/api/spaces/${spaceId}/projects`);

    expect(res.status).toBe(200);
    expect(res.body.map((project: { id: string }) => project.id)).toEqual([activeProjectId]);
    expect(res.body.map((project: { id: string }) => project.id)).not.toContain(archivedProjectId);
  });

  it("includes archived projects when includeArchived is true", async () => {
    const { activeProjectId, archivedProjectId, spaceId } = await seed();
    const app = createApp(db, operatorActor(spaceId));

    const res = await request(app).get(`/api/spaces/${spaceId}/projects?includeArchived=true`);

    expect(res.status).toBe(200);
    expect(res.body.map((project: { id: string }) => project.id).sort()).toEqual([activeProjectId, archivedProjectId].sort());
  });

  it("omits the database-only legacy environment from the DELETE response", async () => {
    const { activeProjectId, spaceId } = await seed();
    await db.insert(spaceMemberships).values({ spaceId, principalType: "user", principalId: "user-1",
      status: "active", membershipRole: "operator" });
    const [environment] = await db.insert(environments).values({ name: randomUUID(), driver: "ssh" }).returning();
    await db.update(projects).set({ legacyEnvironmentId: environment.id }).where(eq(projects.id, activeProjectId));
    const app = createApp(db, operatorActor(spaceId));
    const res = await request(app).delete(`/api/projects/${activeProjectId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(activeProjectId);
    expect(res.body).not.toHaveProperty("legacyEnvironmentId");
    expect(res.body).not.toHaveProperty("environmentId");
  });
});

describeEmbeddedPostgres("private project route visibility", { concurrent: false }, () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const previousPrivacyMode = process.env.OUTPOST_ISSUE_PRIVACY_MODE;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("outpost-private-project-routes-");
    db = createDb(tempDb.connectionString);
    process.env.OUTPOST_ISSUE_PRIVACY_MODE = "enforce";
  }, 20_000);

  afterEach(async () => {
    await db.delete(spaceMemberships);
    await db.delete(projects);
    await db.delete(spaces);
  });

  afterAll(async () => {
    if (previousPrivacyMode === undefined) delete process.env.OUTPOST_ISSUE_PRIVACY_MODE;
    else process.env.OUTPOST_ISSUE_PRIVACY_MODE = previousPrivacyMode;
    await tempDb?.cleanup();
  });

  it("omits private projects from non-member lists and returns 404 on direct fetch", async () => {
    const spaceId = randomUUID();
    const privateProjectId = randomUUID();
    const memberUserId = "project-member";
    await db.insert(spaces).values({
      id: spaceId,
      name: "Private projects",
      issuePrefix: `P${spaceId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
    });
    await db.insert(projects).values([
      { spaceId, name: "Open project", visibility: "open" },
      { id: privateProjectId, spaceId, name: "Secret project", visibility: "private" },
    ]);
    await db.insert(spaceMemberships).values([memberUserId, "project-outsider"].map((principalId) => ({
      spaceId,
      principalType: "user" as const,
      principalId,
      status: "active",
      membershipRole: "admin",
    })));
    await db.insert(projectAccessMembers).values({
      spaceId,
      projectId: privateProjectId,
      subjectType: "user",
      subjectId: memberUserId,
    });
    const actorFor = (userId: string): Express.Request["actor"] => ({
      type: "operator",
      userId,
      source: "session",
      isInstanceAdmin: false,
      spaceIds: [spaceId],
      memberships: [{ spaceId, membershipRole: "admin", status: "active" }],
    });

    const outsiderApp = createApp(db, actorFor("project-outsider"));
    const outsiderList = await request(outsiderApp).get(`/api/spaces/${spaceId}/projects`);
    expect(outsiderList.status).toBe(200);
    expect(outsiderList.body.map((project: { id: string }) => project.id)).not.toContain(privateProjectId);
    await request(outsiderApp).get(`/api/projects/${privateProjectId}`).expect(404);

    const memberApp = createApp(db, actorFor(memberUserId));
    const memberList = await request(memberApp).get(`/api/spaces/${spaceId}/projects`);
    expect(memberList.body.map((project: { id: string }) => project.id)).toContain(privateProjectId);
    await request(memberApp).get(`/api/projects/${privateProjectId}`).expect(200);
  });
});
