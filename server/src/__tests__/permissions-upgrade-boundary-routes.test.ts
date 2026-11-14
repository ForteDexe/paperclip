import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agents,
  assets,
  spaces,
  spaceMemberships,
  createDb,
  documents,
  heartbeatRuns,
  issueAttachments,
  issueComments,
  issueDocuments,
  issues,
  issueWorkProducts,
  principalPermissionGrants,
} from "@outpost/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

vi.hoisted(() => {
  process.env.OUTPOST_HOME = "/tmp/outpost-test-home";
  process.env.OUTPOST_INSTANCE_ID = "vitest";
  process.env.OUTPOST_LOG_DIR = "/tmp/outpost-test-home/logs";
  process.env.OUTPOST_IN_WORKTREE = "false";
});

vi.mock("../services/issue-assignment-wakeup.js", () => ({
  queueIssueAssignmentWakeup: vi.fn(),
}));

import { activityRoutes } from "../routes/activity.js";
import { issueRoutes } from "../routes/issues.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

type Db = ReturnType<typeof createDb>;

function agentActor(spaceId: string, agentId: string): Express.Request["actor"] {
  return {
    type: "agent",
    agentId,
    spaceId,
    runId: undefined,
    source: "agent_jwt",
  };
}

async function createApp(db: Db, actor: Express.Request["actor"]) {
  process.env.OUTPOST_LOG_DIR = "/tmp/outpost-test-home/logs";
  process.env.OUTPOST_IN_WORKTREE = "false";
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api", issueRoutes(db, {} as any));
  app.use("/api", activityRoutes(db));
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.status ?? 500).json({ error: err.message ?? "Internal server error" });
  });
  return app;
}

async function seedSpace(db: Db, label: string) {
  return db
    .insert(spaces)
    .values({
      name: `Permissions Boundary ${label}`,
      issuePrefix: `PB${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`,
    })
    .returning()
    .then((rows) => rows[0]!);
}

async function seedAgent(
  db: Db,
  spaceId: string,
  input: { role?: string; permissions?: Record<string, unknown>; status?: "active" | "idle" } = {},
) {
  return db
    .insert(agents)
    .values({
      spaceId,
      name: `Agent ${randomUUID()}`,
      role: input.role ?? "engineer",
      status: input.status ?? "active",
      adapterType: "process",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: input.permissions ?? {},
    })
    .returning()
    .then((rows) => rows[0]!);
}

describeEmbeddedPostgres("permissions upgrade visibility and route boundaries", () => {
  let db!: Db;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("outpost-permissions-boundary-routes-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueAttachments);
    await db.delete(assets);
    await db.delete(issueDocuments);
    await db.delete(documents);
    await db.delete(issueWorkProducts);
    await db.delete(issueComments);
    await db.delete(activityLog);
    await db.delete(principalPermissionGrants);
    await db.delete(spaceMemberships);
    await db.delete(heartbeatRuns);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(spaces);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("keeps V1 private agent visibility from becoming issue, comment, document, attachment, activity, or work product privacy", async () => {
    const space = await seedSpace(db, "Visibility");
    const readerAgent = await seedAgent(db, space.id);
    const privateTargetAgent = await seedAgent(db, space.id, {
      permissions: {
        authorizationPolicy: {
          agentVisibility: {
            mode: "private",
            hiddenFromDefaultDirectory: true,
          },
          assignmentPolicy: { mode: "protected" },
          protectedAgent: { requiresApproval: false },
          managedBy: "permissions-extension",
        },
      },
    });
    const issue = await db
      .insert(issues)
      .values({
        spaceId: space.id,
        identifier: `${space.issuePrefix}-1`,
        title: "Visible work for a private target agent",
        status: "todo",
        priority: "medium",
        assigneeAgentId: privateTargetAgent.id,
      })
      .returning()
      .then((rows) => rows[0]!);
    const comment = await db
      .insert(issueComments)
      .values({
        spaceId: space.id,
        issueId: issue.id,
        authorAgentId: privateTargetAgent.id,
        body: "Private target agent status is still space-visible.",
      })
      .returning()
      .then((rows) => rows[0]!);
    const doc = await db
      .insert(documents)
      .values({
        spaceId: space.id,
        title: "Plan",
        latestBody: "Shared plan body",
        createdByAgentId: privateTargetAgent.id,
        updatedByAgentId: privateTargetAgent.id,
      })
      .returning()
      .then((rows) => rows[0]!);
    await db.insert(issueDocuments).values({
      spaceId: space.id,
      issueId: issue.id,
      documentId: doc.id,
      key: "plan",
    });
    const asset = await db
      .insert(assets)
      .values({
        spaceId: space.id,
        provider: "local_disk",
        objectKey: `attachments/${randomUUID()}.txt`,
        contentType: "text/plain",
        byteSize: 12,
        sha256: "abc123",
        originalFilename: "note.txt",
        createdByAgentId: privateTargetAgent.id,
      })
      .returning()
      .then((rows) => rows[0]!);
    await db.insert(issueAttachments).values({
      spaceId: space.id,
      issueId: issue.id,
      issueCommentId: comment.id,
      assetId: asset.id,
    });
    await db.insert(issueWorkProducts).values({
      spaceId: space.id,
      issueId: issue.id,
      type: "url",
      provider: "test",
      title: "Preview",
      url: "https://example.test/preview",
      status: "ready",
    });
    await db.insert(activityLog).values({
      spaceId: space.id,
      actorType: "agent",
      actorId: privateTargetAgent.id,
      agentId: privateTargetAgent.id,
      action: "issue.updated",
      entityType: "issue",
      entityId: issue.id,
      details: { source: "test" },
    });

    const app = await createApp(db, agentActor(space.id, readerAgent.id));

    const [issueList, comments, docs, docDetail, attachments, activity, workProducts] = await Promise.all([
      request(app).get(`/api/spaces/${space.id}/issues`),
      request(app).get(`/api/issues/${issue.id}/comments`),
      request(app).get(`/api/issues/${issue.id}/documents`),
      request(app).get(`/api/issues/${issue.id}/documents/plan`),
      request(app).get(`/api/issues/${issue.id}/attachments`),
      request(app).get(`/api/issues/${issue.id}/activity`),
      request(app).get(`/api/issues/${issue.id}/work-products`),
    ]);

    expect(issueList.status, JSON.stringify(issueList.body)).toBe(200);
    expect(issueList.body.items ?? issueList.body).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: issue.id })]),
    );
    expect(comments.status, JSON.stringify(comments.body)).toBe(200);
    expect(comments.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: comment.id })]));
    expect(docs.status, JSON.stringify(docs.body)).toBe(200);
    expect(docs.body).toEqual(expect.arrayContaining([expect.objectContaining({ key: "plan" })]));
    expect(docDetail.status, JSON.stringify(docDetail.body)).toBe(200);
    expect(docDetail.body.body ?? docDetail.body.latestBody).toContain("Shared plan body");
    expect(attachments.status, JSON.stringify(attachments.body)).toBe(200);
    expect(attachments.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: expect.any(String) })]));
    expect(activity.status, JSON.stringify(activity.body)).toBe(200);
    expect(activity.body).toEqual(expect.arrayContaining([expect.objectContaining({ action: "issue.updated" })]));
    expect(workProducts.status, JSON.stringify(workProducts.body)).toBe(200);
    expect(workProducts.body).toEqual(expect.arrayContaining([expect.objectContaining({ title: "Preview" })]));
  }, 20_000);

  it("denies cross-space issue reads before private-agent grant evaluation can matter", async () => {
    const sourceSpace = await seedSpace(db, "Source");
    const targetSpace = await seedSpace(db, "Target");
    const sourceAgent = await seedAgent(db, sourceSpace.id);
    const privateTargetAgent = await seedAgent(db, targetSpace.id, {
      permissions: {
        authorizationPolicy: {
          agentVisibility: { mode: "private", hiddenFromDefaultDirectory: true },
          assignmentPolicy: { mode: "space_default" },
          protectedAgent: { requiresApproval: false },
        },
      },
    });
    const issue = await db
      .insert(issues)
      .values({
        spaceId: targetSpace.id,
        title: "Other space work",
        status: "todo",
        priority: "medium",
        assigneeAgentId: privateTargetAgent.id,
      })
      .returning()
      .then((rows) => rows[0]!);

    const res = await request(await createApp(db, agentActor(sourceSpace.id, sourceAgent.id)))
      .get(`/api/issues/${issue.id}`);

    // Cross-tenant reads return 404 (not 403) so the response is
    // indistinguishable from a nonexistent issue — no existence oracle.
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Issue not found");
  });

  it("allows same-space route assignment after upgrade but keeps private target assignment grant constrained", async () => {
    const space = await seedSpace(db, "Assignment");
    const actorAgent = await seedAgent(db, space.id);
    const openTargetAgent = await seedAgent(db, space.id);
    const privateTargetAgent = await seedAgent(db, space.id, {
      permissions: {
        authorizationPolicy: {
          agentVisibility: { mode: "private", hiddenFromDefaultDirectory: true },
          assignmentPolicy: { mode: "space_default" },
          protectedAgent: { requiresApproval: false },
          managedBy: "permissions-extension",
        },
      },
    });
    const app = await createApp(db, agentActor(space.id, actorAgent.id));

    const openAssignment = await request(app)
      .post(`/api/spaces/${space.id}/issues`)
      .send({ title: "Assignable after upgrade", assigneeAgentId: openTargetAgent.id });
    expect(openAssignment.status, JSON.stringify(openAssignment.body)).toBe(201);

    const deniedPrivateAssignment = await request(app)
      .post(`/api/spaces/${space.id}/issues`)
      .send({ title: "Private target needs scope", assigneeAgentId: privateTargetAgent.id });
    expect(deniedPrivateAssignment.status).toBe(403);
    expect(deniedPrivateAssignment.body.error).toContain("private");

    await db.insert(spaceMemberships).values({
      spaceId: space.id,
      principalType: "agent",
      principalId: actorAgent.id,
      status: "active",
      membershipRole: "member",
    });
    await db.insert(principalPermissionGrants).values({
      spaceId: space.id,
      principalType: "agent",
      principalId: actorAgent.id,
      permissionKey: "tasks:assign_scope",
      scope: { assigneeAgentIds: [privateTargetAgent.id] },
      grantedByUserId: null,
    });

    const allowedPrivateAssignment = await request(app)
      .post(`/api/spaces/${space.id}/issues`)
      .send({ title: "Private target has explicit scope", assigneeAgentId: privateTargetAgent.id });
    expect(allowedPrivateAssignment.status, JSON.stringify(allowedPrivateAssignment.body)).toBe(201);

    const otherPrivateTargetAgent = await seedAgent(db, space.id, {
      permissions: privateTargetAgent.permissions as Record<string, unknown>,
    });
    const deniedOutsideScope = await request(app)
      .post(`/api/spaces/${space.id}/issues`)
      .send({ title: "Different private target stays denied", assigneeAgentId: otherPrivateTargetAgent.id });
    expect(deniedOutsideScope.status).toBe(403);
    expect(deniedOutsideScope.body.error).toContain("private");
  });
});
