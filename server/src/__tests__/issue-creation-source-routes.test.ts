import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { activityLog, agents, spaces, createDb, heartbeatRuns, issues } from "@outpost/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { issueRoutes } from "../routes/issues.js";
import { errorHandler } from "../middleware/index.js";

const support = await getEmbeddedPostgresTestSupport();
const describePostgres = support.supported ? describe : describe.skip;

describePostgres("agent-created follow-ups: parent links and creation source", () => {
  let db: ReturnType<typeof createDb>;
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  const spaceId = randomUUID();
  const otherSpaceId = randomUUID();
  const qaAgentId = randomUUID();
  const engineerAgentId = randomUUID();
  const foreignAgentId = randomUUID();
  const sourceId = randomUUID();
  const conversationId = randomUUID();
  const privateSourceId = randomUUID();
  const protectedSourceId = randomUUID();
  const foreignSourceId = randomUUID();
  const runOnSource = randomUUID();
  const runOnConversation = randomUUID();
  const runOnPrivate = randomUUID();
  const runOnProtected = randomUUID();
  const foreignRun = randomUUID();
  const legacyRun = randomUUID();

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("outpost-creation-source-");
    db = createDb(database.connectionString);
    await db.insert(spaces).values([
      { id: spaceId, name: "Outpost", issuePrefix: "PAP", defaultResponsibleUserId: "operator-user", requireOperatorApprovalForNewAgents: false },
      { id: otherSpaceId, name: "Other", issuePrefix: "OTH", defaultResponsibleUserId: "operator-user", requireOperatorApprovalForNewAgents: false },
    ]);
    await db.insert(agents).values([
      { id: qaAgentId, spaceId, name: "Outpost QA", role: "qa", adapterType: "codex_local", status: "active" },
      { id: engineerAgentId, spaceId, name: "Engineer", role: "engineer", adapterType: "codex_local", status: "active" },
      { id: foreignAgentId, spaceId: otherSpaceId, name: "Other QA", role: "qa", adapterType: "codex_local", status: "active" },
    ]);
    await db.insert(issues).values([
      { id: sourceId, spaceId, title: "Verify Tailscale fix", identifier: "PAP-168", issueNumber: 168, status: "in_progress", assigneeAgentId: qaAgentId, createdByAgentId: engineerAgentId },
      { id: conversationId, spaceId, title: "Chat with QA", identifier: "PAP-170", issueNumber: 170, status: "in_review", assigneeAgentId: qaAgentId, conversationAgentId: qaAgentId, conversationUserId: "operator-user", conversationState: "waiting" },
      { id: privateSourceId, spaceId, title: "Private finding", identifier: "PAP-171", issueNumber: 171, status: "in_progress", visibility: "private", privacyRootIssueId: privateSourceId, assigneeAgentId: qaAgentId },
      { id: protectedSourceId, spaceId, title: "Protected task", identifier: "PAP-172", issueNumber: 172, status: "in_progress", assigneeAgentId: qaAgentId, executionPolicy: { authorizationPolicy: { assignmentPolicy: { mode: "protected" } } } },
      { id: foreignSourceId, spaceId: otherSpaceId, title: "Foreign source", identifier: "OTH-1", issueNumber: 1 },
    ]);
    await db.insert(heartbeatRuns).values([
      { id: runOnSource, spaceId, agentId: qaAgentId, scopeKind: "issue", issueId: sourceId, nativeIssueId: sourceId, status: "running", contextSnapshot: { issueId: sourceId } },
      { id: runOnConversation, spaceId, agentId: qaAgentId, scopeKind: "issue", issueId: conversationId, status: "running", contextSnapshot: { issueId: conversationId } },
      { id: runOnPrivate, spaceId, agentId: qaAgentId, scopeKind: "issue", issueId: privateSourceId, status: "running", contextSnapshot: { issueId: privateSourceId } },
      { id: runOnProtected, spaceId, agentId: qaAgentId, scopeKind: "issue", issueId: protectedSourceId, status: "running", contextSnapshot: { issueId: protectedSourceId } },
      { id: foreignRun, spaceId: otherSpaceId, agentId: foreignAgentId, scopeKind: "issue", issueId: foreignSourceId, status: "running" },
      { id: legacyRun, spaceId, agentId: qaAgentId, status: "succeeded", contextSnapshot: { taskKey: "PAP-168" } },
    ]);
  }, 30_000);
  afterAll(async () => { await database?.cleanup(); });

  const operatorActor = { type: "operator", userId: "operator-user", source: "local_implicit", isInstanceAdmin: true } as Express.Request["actor"];
  function agentActor(agentId: string, runId?: string): Express.Request["actor"] {
    return { type: "agent", spaceId, agentId, runId, source: "agent_jwt", onBehalfOfUserId: null, onBehalfOfMemberships: [] } as Express.Request["actor"];
  }
  function app(actor: Express.Request["actor"]) {
    const instance = express();
    instance.use(express.json());
    instance.use((req, _res, next) => { req.actor = actor; next(); });
    instance.use("/api", issueRoutes(db, {} as never));
    instance.use(errorHandler);
    return instance;
  }
  async function createdActivity(issueId: string) {
    const [row] = await db.select().from(activityLog)
      .where(and(eq(activityLog.entityId, issueId), eq(activityLog.action, "issue.created")));
    return row ?? null;
  }

  it("parents an ordinary delegated follow-up under the run's task when parentId is omitted", async () => {
    const created = await request(app(agentActor(qaAgentId, runOnSource)))
      .post(`/api/spaces/${spaceId}/issues`)
      .send({ title: "Fix regression found during verification" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.parentId).toBe(sourceId);
    expect(created.body.originRunId).toBe(runOnSource);
    expect(created.body.blockedBy ?? []).toEqual([]);
    const activity = await createdActivity(created.body.id);
    expect(activity?.details).toMatchObject({ parentId: sourceId, parentDefaultedFromRunIssue: true });

    const detail = await request(app(operatorActor)).get(`/api/issues/${created.body.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.createdFrom).toEqual({
      issue: { id: sourceId, identifier: "PAP-168", title: "Verify Tailscale fix", status: "in_progress" },
      run: { id: runOnSource, agentId: qaAgentId },
      agent: { id: qaAgentId, name: "Outpost QA" },
    });
  });

  it("keeps an explicit parentId: null standalone but still exposes the source task", async () => {
    const created = await request(app(agentActor(qaAgentId, runOnSource)))
      .post(`/api/spaces/${spaceId}/issues`)
      .send({ title: "Intentional top-level follow-up", parentId: null });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.parentId).toBeNull();
    const activity = await createdActivity(created.body.id);
    expect(activity?.details).not.toHaveProperty("parentDefaultedFromRunIssue");

    const detail = await request(app(operatorActor)).get(`/api/issues/${created.body.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.parentId).toBeNull();
    expect(detail.body.createdFrom).toMatchObject({
      issue: { id: sourceId, identifier: "PAP-168" },
      agent: { name: "Outpost QA" },
    });
  });

  it("never parents conversation handoffs or operator-created tasks", async () => {
    const handoff = await request(app(agentActor(qaAgentId, runOnConversation)))
      .post(`/api/spaces/${spaceId}/issues`)
      .send({ title: "Execution task from chat" });
    expect(handoff.status, JSON.stringify(handoff.body)).toBe(201);
    expect(handoff.body.parentId).toBeNull();

    const manual = await request(app(operatorActor))
      .post(`/api/spaces/${spaceId}/issues`)
      .send({ title: "Operator task" });
    expect(manual.status, JSON.stringify(manual.body)).toBe(201);
    expect(manual.body.parentId).toBeNull();
    const detail = await request(app(operatorActor)).get(`/api/issues/${manual.body.id}`);
    expect(detail.body.createdFrom).toBeNull();
  });

  it("stays standalone instead of failing when the default parent would be a delegation cycle", async () => {
    const created = await request(app(agentActor(qaAgentId, runOnSource)))
      .post(`/api/spaces/${spaceId}/issues`)
      .send({ title: "Bug for the engineer who delegated to QA", assigneeAgentId: engineerAgentId });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.parentId).toBeNull();
    expect(created.body.assigneeAgentId).toBe(engineerAgentId);
    const detail = await request(app(operatorActor)).get(`/api/issues/${created.body.id}`);
    expect(detail.body.createdFrom).toMatchObject({ issue: { id: sourceId } });
  });

  it("stays standalone instead of failing when the default parent is protected without a grant", async () => {
    // The agent runs the protected task, so it may mutate it, but a protected
    // assignment policy denies child creation without an explicit grant.
    const created = await request(app(agentActor(qaAgentId, runOnProtected)))
      .post(`/api/spaces/${spaceId}/issues`)
      .send({ title: "Follow-up from a protected task" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.parentId).toBeNull();
    const activity = await createdActivity(created.body.id);
    expect(activity?.details).not.toHaveProperty("parentDefaultedFromRunIssue");
    const detail = await request(app(operatorActor)).get(`/api/issues/${created.body.id}`);
    expect(detail.body.createdFrom).toMatchObject({ issue: { id: protectedSourceId, identifier: "PAP-172" } });

    const explicit = await request(app(agentActor(qaAgentId, runOnProtected)))
      .post(`/api/spaces/${spaceId}/issues`)
      .send({ title: "Explicit child of a protected task", parentId: protectedSourceId });
    expect(explicit.status, JSON.stringify(explicit.body)).toBe(403);
  });

  it("still honors an explicit parent and rejects an explicit delegation cycle", async () => {
    const [other] = await db.insert(issues).values({ spaceId, title: "Another parent", status: "todo" }).returning();
    const created = await request(app(agentActor(qaAgentId, runOnSource)))
      .post(`/api/spaces/${spaceId}/issues`)
      .send({ title: "Explicit child", parentId: other!.id });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.parentId).toBe(other!.id);
    const activity = await createdActivity(created.body.id);
    expect(activity?.details).not.toHaveProperty("parentDefaultedFromRunIssue");

    const cycle = await request(app(agentActor(qaAgentId, runOnSource)))
      .post(`/api/spaces/${spaceId}/issues`)
      .send({ title: "Explicit cycle", parentId: sourceId, assigneeAgentId: engineerAgentId });
    expect(cycle.status).toBe(409);
  });

  it("resolves historical provenance from the creation activity's run", async () => {
    const historicalId = randomUUID();
    await db.insert(issues).values({ id: historicalId, spaceId, title: "Historical follow-up", status: "todo", createdByAgentId: qaAgentId });
    await db.insert(activityLog).values({ spaceId, actorType: "agent", actorId: qaAgentId, runId: legacyRun, action: "issue.created", entityType: "issue", entityId: historicalId });
    const detail = await request(app(operatorActor)).get(`/api/issues/${historicalId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.createdFrom).toMatchObject({ issue: { id: sourceId, identifier: "PAP-168" }, run: { id: legacyRun } });
  });

  it("returns null when provenance is missing, inaccessible, or from another space", async () => {
    const orphanId = randomUUID();
    const fromPrivateId = randomUUID();
    const fromForeignId = randomUUID();
    await db.insert(issues).values([
      { id: orphanId, spaceId, title: "No provenance", status: "todo", createdByAgentId: qaAgentId },
      { id: fromPrivateId, spaceId, title: "Created from a private task", status: "todo", originRunId: runOnPrivate, createdByAgentId: qaAgentId },
      { id: fromForeignId, spaceId, title: "Origin run in another space", status: "todo", originRunId: foreignRun },
    ]);
    await db.insert(activityLog).values({ spaceId, actorType: "agent", actorId: qaAgentId, runId: null, action: "issue.created", entityType: "issue", entityId: orphanId });

    const orphan = await request(app(operatorActor)).get(`/api/issues/${orphanId}`);
    expect(orphan.body.createdFrom).toBeNull();

    const foreign = await request(app(operatorActor)).get(`/api/issues/${fromForeignId}`);
    expect(foreign.status).toBe(200);
    expect(foreign.body.createdFrom).toBeNull();

    const asOutsider = await request(app(agentActor(engineerAgentId))).get(`/api/issues/${fromPrivateId}`);
    expect(asOutsider.status, JSON.stringify(asOutsider.body)).toBe(200);
    expect(asOutsider.body.createdFrom).toBeNull();

    const asParticipant = await request(app(agentActor(qaAgentId))).get(`/api/issues/${fromPrivateId}`);
    expect(asParticipant.status).toBe(200);
    expect(asParticipant.body.createdFrom).toMatchObject({ issue: { id: privateSourceId, identifier: "PAP-171" } });
  });
});
