import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import request from "supertest";
import { agents, heartbeatRuns, issueComments, issueRecoveryActions, issueRelations, issueThreadInteractions, issues, statusCards } from "@outpost/db";
import { spaceSearchQuerySchema, createIssueSchema, defaultStatusCardRefreshPolicy, PROVIDER_QUOTA_MONITOR_SERVICE_NAME, type Issue } from "@outpost/shared";
import { issueDisplayStatusSql } from "../services/issue-display-status.js";
import { issueService } from "../services/issues.js";
import { spaceSearchService } from "../services/space-search.js";
import { statusCardService } from "../services/status-cards.js";
import { issueRoutes } from "../routes/issues.js";
import {
  describeEmbeddedPostgres, routeApp,
  seedSpaceWithOperatorAccess, useEmbeddedPostgres,
} from "./helpers/route-test-harness.js";

describeEmbeddedPostgres("Execution-backed task presentation", () => {
  const ctx = useEmbeddedPostgres("outpost-monitoring-status-", {
    resetEach: async (db) => { await db.execute(sql`SET client_min_messages = warning`); await db.execute(sql`TRUNCATE TABLE spaces CASCADE`); },
  });

  async function fixture() {
    const space = await seedSpaceWithOperatorAccess(ctx.db, "Monitoring");
    const agentId = randomUUID();
    await ctx.db.insert(agents).values({ id: agentId, spaceId: space.spaceId, name: "Monitor owner", role: "engineer", status: "paused", adapterType: "process", adapterConfig: {} });
    const nextCheckAt = new Date(Date.now() + 60 * 60_000);
    const issueId = randomUUID();
    await ctx.db.insert(issues).values({
      id: issueId, spaceId: space.spaceId, title: "Check deployment", status: "in_progress",
      assigneeAgentId: agentId, createdByUserId: space.actor.userId,
      monitorNextCheckAt: nextCheckAt,
      executionPolicy: { mode: "normal", stages: [], commentRequired: false, monitor: { nextCheckAt: nextCheckAt.toISOString(), notes: "Check deployment" } },
    });
    return { ...space, agentId, issueId };
  }

  async function displayStatus(id: string) {
    const [row] = await ctx.db.select({ status: issues.status, displayStatus: issueDisplayStatusSql() }).from(issues).where(eq(issues.id, id));
    return row;
  }

  it.each(["failed", "cancelled", "timed_out", "succeeded", "scheduled_retry"])("does not show In Progress after a run becomes %s, even with stale locks", async (status) => {
    const f = await fixture();
    await ctx.db.update(issues).set({ monitorNextCheckAt: null, executionPolicy: null }).where(eq(issues.id, f.issueId));
    const [run] = await ctx.db.insert(heartbeatRuns).values({ spaceId: f.spaceId, agentId: f.agentId, issueId: f.issueId, status }).returning();
    await ctx.db.update(issues).set({ executionRunId: run!.id, checkoutRunId: run!.id }).where(eq(issues.id, f.issueId));
    expect(await displayStatus(f.issueId)).toEqual({ status: "in_progress", displayStatus: "todo" });
    const svc = issueService(ctx.db);
    expect(await svc.count(f.spaceId, { displayStatus: "in_progress" })).toBe(0);
    expect(await svc.list(f.spaceId, { displayStatus: "todo", limit: 1 })).toEqual([expect.objectContaining({ id: f.issueId })]);
    // Presentation must not clear ownership or change recovery/admission inputs.
    expect((await ctx.db.select().from(issues).where(eq(issues.id, f.issueId)))[0]).toMatchObject({ status: "in_progress", executionRunId: run!.id, checkoutRunId: run!.id });
  });

  it("shows a stopped task waiting for a human as In Review across API reads and search", async () => {
    const f = await fixture();
    await ctx.db.update(issues).set({ monitorNextCheckAt: null, executionPolicy: null }).where(eq(issues.id, f.issueId));
    await ctx.db.insert(heartbeatRuns).values({ spaceId: f.spaceId, agentId: f.agentId, issueId: f.issueId, status: "failed", errorCode: "authentication_failed" });
    const [interaction] = await ctx.db.insert(issueThreadInteractions).values({ spaceId: f.spaceId, issueId: f.issueId, kind: "request_confirmation", addresseeUserId: f.actor.userId,
      payload: { version: 1, prompt: "Authorize the connection" } }).returning();
    const app = routeApp(ctx.db, f.actor, issueRoutes);
    expect((await request(app).get(`/api/issues/${f.issueId}`).expect(200)).body).toMatchObject({ status: "in_progress", displayStatus: "in_review" });
    const summary = await request(app).get(`/api/spaces/${f.spaceId}/issues/summaries?ids=${f.issueId}`).expect(200);
    expect(summary.body[0]).toMatchObject({ displayStatus: "in_review" });
    const result = await spaceSearchService(ctx.db).search(f.spaceId, spaceSearchQuerySchema.parse({ q: "deployment", displayStatus: "in_review" }));
    expect(result.results[0]?.issue).toMatchObject({ id: f.issueId, displayStatus: "in_review" });
    await ctx.db.update(issueThreadInteractions).set({ status: "answered" }).where(eq(issueThreadInteractions.id, interaction!.id));
    expect((await displayStatus(f.issueId)).displayStatus).toBe("todo");
  });

  it.each(["dismissed", "historical"])("does not turn a monitor into review for a %s request", async (kind) => {
    const f = await fixture();
    const createdAt = new Date(Date.now() - 60_000);
    await ctx.db.insert(issueThreadInteractions).values({ spaceId: f.spaceId, issueId: f.issueId,
      kind: kind === "dismissed" ? "request_confirmation" : "ask_user_questions", status: "pending", createdAt,
      dismissedAt: kind === "dismissed" ? new Date() : null, effectiveResolverPolicySource: "requested",
      payload: { version: 1, prompt: "Earlier request" } });
    if (kind === "historical") await ctx.db.insert(issueComments).values({ spaceId: f.spaceId, issueId: f.issueId,
      authorUserId: f.actor.userId, body: "Continue with the current instructions", createdAt: new Date() });
    expect((await displayStatus(f.issueId)).displayStatus).toBe("monitoring");
    expect(await issueService(ctx.db).count(f.spaceId, { displayStatus: "in_review" })).toBe(0);
  });

  it("does not treat a retained reviewer as pending after changes are requested", async () => {
    const f = await fixture();
    await ctx.db.update(issues).set({ executionState: { status: "changes_requested", currentStageId: "review",
      currentStageType: "review", currentParticipant: { type: "user", userId: "reviewer" }, lastDecisionOutcome: "changes_requested" } }).where(eq(issues.id, f.issueId));
    expect((await displayStatus(f.issueId)).displayStatus).toBe("monitoring");
    await ctx.db.update(issues).set({ monitorNextCheckAt: null }).where(eq(issues.id, f.issueId));
    expect((await displayStatus(f.issueId)).displayStatus).toBe("todo");
  });

  it("requires task-scoped active execution and preserves human ownership", async () => {
    const f = await fixture();
    await ctx.db.update(issues).set({ monitorNextCheckAt: null, executionPolicy: null }).where(eq(issues.id, f.issueId));
    await ctx.db.insert(heartbeatRuns).values({ spaceId: f.spaceId, agentId: f.agentId, status: "running" });
    expect((await displayStatus(f.issueId)).displayStatus).toBe("todo");
    const foreign = await fixture();
    await ctx.db.insert(heartbeatRuns).values({ spaceId: foreign.spaceId, agentId: foreign.agentId, issueId: f.issueId, status: "running" });
    expect((await displayStatus(f.issueId)).displayStatus).toBe("todo");
    await ctx.db.update(issues).set({ assigneeAgentId: null, assigneeUserId: f.actor.userId }).where(eq(issues.id, f.issueId));
    expect((await displayStatus(f.issueId)).displayStatus).toBe("in_progress");
  });

  it("projects a scheduled wait consistently across detail, compact rows, summaries, search and counts", async () => {
    const f = await fixture();
    const svc = issueService(ctx.db);
    expect(await svc.getById(f.issueId)).toMatchObject({ status: "in_progress", displayStatus: "monitoring" });
    expect(await svc.list(f.spaceId, { displayStatus: "monitoring", listProjection: "index" })).toEqual([expect.objectContaining({ id: f.issueId, status: "in_progress", displayStatus: "monitoring" })]);
    expect(await svc.count(f.spaceId, { displayStatus: "monitoring" })).toBe(1);
    const app = routeApp(ctx.db, f.actor, issueRoutes);
    const summary = await request(app).get(`/api/spaces/${f.spaceId}/issues/summaries?ids=${f.issueId}`).expect(200);
    expect(summary.body[0]).toMatchObject({ status: "in_progress", displayStatus: "monitoring" });
    const result = await spaceSearchService(ctx.db).search(f.spaceId, spaceSearchQuerySchema.parse({ q: "deployment", displayStatus: "monitoring" }));
    expect(result.results[0]?.issue).toMatchObject({ id: f.issueId, status: "in_progress", displayStatus: "monitoring" });
    expect(result.filterOptionCounts.displayStatus?.monitoring).toBe(1);
    expect(result.filterOptionCounts.status.in_progress).toBe(1);
    const [card] = await ctx.db.insert(statusCards).values({ spaceId: f.spaceId, interestPrompt: "Watch deployment", mentionedIssueIds: [f.issueId], refreshPolicy: defaultStatusCardRefreshPolicy }).returning();
    expect(await statusCardService(ctx.db).listMentionedIssues(card!)).toEqual([expect.objectContaining({ id: f.issueId, status: "in_progress", displayStatus: "monitoring" })]);
    // Existing agent/API lifecycle filters keep their original meaning.
    expect(await svc.count(f.spaceId, { status: "in_progress" })).toBe(1);
    expect(createIssueSchema.safeParse({ title: "Manual monitoring", status: "monitoring" }).success).toBe(false);
  });

  it("filters before pagination and keeps In Progress separate from Monitoring", async () => {
    const f = await fixture();
    const [active] = await ctx.db.insert(issues).values({ spaceId: f.spaceId, title: "Ordinary work", status: "in_progress", assigneeAgentId: f.agentId }).returning();
    await ctx.db.insert(heartbeatRuns).values({ spaceId: f.spaceId, agentId: f.agentId, issueId: active!.id, status: "running" });
    const svc = issueService(ctx.db);
    expect(await svc.list(f.spaceId, { displayStatus: "monitoring", limit: 1, offset: 0 })).toEqual([expect.objectContaining({ id: f.issueId })]);
    expect(await svc.list(f.spaceId, { displayStatus: "monitoring", limit: 1, offset: 1 })).toEqual([]);
    expect(await svc.count(f.spaceId, { displayStatus: "in_progress" })).toBe(1);
    expect(await svc.count(f.spaceId, { status: "in_progress" })).toBe(2);
  });

  it("shows the same wait indicator in list blocker summaries and task detail relations", async () => {
    const f = await fixture();
    const [dependent] = await ctx.db.insert(issues).values({ spaceId: f.spaceId, title: "Ship after deployment", status: "blocked" }).returning();
    await ctx.db.insert(issueRelations).values({ spaceId: f.spaceId, issueId: f.issueId, relatedIssueId: dependent!.id, type: "blocks" });
    const svc = issueService(ctx.db);
    const list = await svc.list(f.spaceId, { includeBlockedBy: true }) as Array<Awaited<ReturnType<typeof svc.list>>[number] & Pick<Issue, "blockedBy">>;
    expect(list.find(row => row.id === dependent!.id)?.blockedBy).toEqual([expect.objectContaining({ id: f.issueId, displayStatus: "monitoring" })]);
    const detail = await request(routeApp(ctx.db, f.actor, issueRoutes)).get(`/api/issues/${dependent!.id}`).expect(200);
    expect(detail.body.blockedBy).toEqual([expect.objectContaining({ id: f.issueId, displayStatus: "monitoring" })]);
  });

  it("returns to In Progress during the check and Monitoring after another yield, then Done", async () => {
    const f = await fixture();
    const runId = randomUUID();
    await ctx.db.insert(heartbeatRuns).values({ id: runId, spaceId: f.spaceId, agentId: f.agentId, issueId: f.issueId, status: "queued" });
    expect((await displayStatus(f.issueId)).displayStatus).toBe("in_progress");
    await ctx.db.update(heartbeatRuns).set({ status: "running" }).where(eq(heartbeatRuns.id, runId));
    await ctx.db.update(issues).set({ executionRunId: runId, checkoutRunId: runId }).where(eq(issues.id, f.issueId));
    expect((await displayStatus(f.issueId)).displayStatus).toBe("in_progress");
    await ctx.db.update(heartbeatRuns).set({ status: "succeeded" }).where(eq(heartbeatRuns.id, runId));
    await ctx.db.update(issues).set({ executionRunId: null, checkoutRunId: null }).where(eq(issues.id, f.issueId));
    expect((await displayStatus(f.issueId)).displayStatus).toBe("monitoring");
    await ctx.db.update(issues).set({ status: "done" }).where(eq(issues.id, f.issueId));
    expect(await displayStatus(f.issueId)).toEqual({ status: "done", displayStatus: "done" });
  });

  it.each(["blocked", "in_review", "todo", "cancelled"])("preserves %s even with a retained monitor", async (status) => {
    const f = await fixture();
    await ctx.db.update(issues).set({ status }).where(eq(issues.id, f.issueId));
    expect((await displayStatus(f.issueId)).displayStatus).toBe(status);
  });

  it("does not label cleared, consumed, orphaned or quota-recovery schedules Monitoring", async () => {
    const f = await fixture();
    await ctx.db.update(issues).set({ executionState: { monitor: { status: "cleared" } } }).where(eq(issues.id, f.issueId));
    expect((await displayStatus(f.issueId)).displayStatus).toBe("todo");
    await ctx.db.update(issues).set({ executionState: null, monitorNextCheckAt: null }).where(eq(issues.id, f.issueId));
    expect((await displayStatus(f.issueId)).displayStatus).toBe("todo");
    await ctx.db.update(issues).set({ monitorNextCheckAt: new Date(), executionPolicy: { monitor: { serviceName: PROVIDER_QUOTA_MONITOR_SERVICE_NAME } } }).where(eq(issues.id, f.issueId));
    expect((await displayStatus(f.issueId)).displayStatus).toBe("todo");
    await ctx.db.update(issues).set({ executionPolicy: null }).where(eq(issues.id, f.issueId));
    expect((await displayStatus(f.issueId)).displayStatus).toBe("todo");
  });

  it("keeps recovery and review holds visible and never writes a new lifecycle state", async () => {
    const f = await fixture();
    await ctx.db.insert(issueRecoveryActions).values({ spaceId: f.spaceId, sourceIssueId: f.issueId, kind: "source", ownerType: "operator", cause: "process_lost", fingerprint: randomUUID(), nextAction: "Inspect stopped run" });
    expect((await displayStatus(f.issueId)).displayStatus).toBe("blocked");
    await ctx.db.execute(sql`UPDATE issue_recovery_actions SET status = 'escalated' WHERE source_issue_id = ${f.issueId}`);
    expect((await displayStatus(f.issueId)).displayStatus).toBe("blocked");
    await ctx.db.execute(sql`UPDATE issue_recovery_actions SET status = 'resolved' WHERE source_issue_id = ${f.issueId}`);
    expect((await displayStatus(f.issueId)).displayStatus).toBe("monitoring");
    await ctx.db.update(issues).set({ executionState: { status: "pending", currentStageId: "review", currentStageType: "review", currentParticipant: { type: "user", userId: "reviewer" } } }).where(eq(issues.id, f.issueId));
    expect((await displayStatus(f.issueId)).displayStatus).toBe("in_review");
  });
});
