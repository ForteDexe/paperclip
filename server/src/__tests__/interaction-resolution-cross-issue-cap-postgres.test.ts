import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  agentWakeupRequests,
  agents,
  spaces,
  spaceMemberships,
  createDb,
  heartbeatRuns,
  issueThreadInteractions,
  issues,
} from "@outpost/db";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";
import { CROSS_ISSUE_INFLUENCE_LIMIT } from "../services/cross-issue-influence-limit.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres interaction-resolution cap tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

/**
 * Route-level proof for the per-run cross-issue influence cap on issue-thread
 * interaction resolution, against the real routes, real services, and a real
 * database: the mocked route harness can prove ordering, but only this can prove
 * that a capped run leaves no interaction result, child task, activity receipt,
 * or wake behind, and that concurrent resolutions cannot race past the cap.
 */
describeEmbeddedPostgres("cross-issue interaction resolution cap (routes + postgres)", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("outpost-interaction-cap-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  // An allowed resolution wakes the assignee, and that wake can land a heartbeat
  // run row just after the response, so teardown is best-effort in foreign-key
  // order. Every assertion below is scoped to its own seeded space instead of
  // relying on an empty database.
  afterEach(async () => {
    const cleanups = [
      () => db.delete(issueThreadInteractions),
      () => db.delete(activityLog),
      () => db.delete(heartbeatRuns),
      () => db.delete(agentWakeupRequests),
      () => db.delete(heartbeatRuns),
      () => db.delete(issues),
      () => db.delete(spaceMemberships),
      () => db.delete(agents),
      () => db.delete(spaces),
    ];
    for (const cleanup of cleanups) await cleanup().catch(() => undefined);
  });

  afterAll(async () => {
    // End the postgres.js pool before stopping the embedded server. Stopping
    // the server first tears the TCP connection down under the still-open
    // client, and a batched write the driver scheduled via setImmediate can
    // then fire after the connection dropped its socket — an unhandled
    // `Cannot read properties of null (reading 'write')` that fails the run
    // even though every test passed. `end()` waits for in-flight queries
    // (including a fire-and-forget wake landing just after a response) and
    // closes the sockets from the client side first.
    await db.$client.end();
    await tempDb?.cleanup();
  });

  function app(actor: Record<string, unknown>) {
    const testApp = express();
    testApp.use(express.json());
    testApp.use((req, _res, next) => {
      (req as any).actor = actor;
      next();
    });
    testApp.use("/api", issueRoutes(db, {} as any, {}));
    testApp.use(errorHandler);
    return testApp;
  }

  function agentActor(spaceId: string, agentId: string, runId: string) {
    return { type: "agent", source: "agent_key", spaceId, agentId, runId };
  }

  function operatorActor(spaceId: string, userId: string) {
    return {
      type: "operator",
      source: "session",
      userId,
      spaceIds: [spaceId],
      memberships: [{ spaceId, status: "active", membershipRole: "operator" }],
      isInstanceAdmin: false,
    };
  }

  const INTERACTION_FIXTURES = {
    accept: {
      // A suggested-task card proves the 429 also stops the child-task effect.
      kind: "suggest_tasks",
      payload: {
        version: 1,
        tasks: [{ clientKey: "spawned", title: "Spawned by a capped run" }],
      },
      body: { selectedClientKeys: ["spawned"] },
    },
    reject: {
      kind: "request_confirmation",
      payload: { version: 1, prompt: "Proceed?" },
      body: { reason: "Not now" },
    },
    respond: {
      kind: "ask_user_questions",
      payload: {
        version: 1,
        questions: [{
          id: "scope",
          prompt: "Which scope?",
          selectionMode: "single",
          options: [{ id: "phase-1", label: "Phase 1" }],
        }],
      },
      body: { answers: [{ questionId: "scope", optionIds: ["phase-1"] }] },
    },
    verdicts: {
      kind: "request_item_verdicts",
      payload: {
        version: 1,
        prompt: "Review these",
        items: [{ id: "item-1", label: "Item one" }],
        verdicts: ["approve", "reject"],
      },
      body: { verdicts: [{ id: "item-1", verdict: "approve" }] },
    },
  } as const;

  type ResolutionRoute = keyof typeof INTERACTION_FIXTURES;

  async function seedSpaceAndAgent(prefix: string) {
    const spaceId = randomUUID();
    const agentId = randomUUID();
    const userId = `${prefix.toLowerCase()}-operator`;
    await db.insert(spaces).values({
      id: spaceId,
      name: `${prefix} Space`,
      issuePrefix: prefix,
      requireOperatorApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      spaceId,
      name: `${prefix} Resolver`,
      role: "engineer",
      status: "idle",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(spaceMemberships).values({
      spaceId,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "operator",
    });
    return { spaceId, agentId, userId };
  }

  let issueSequence = 0;

  async function seedIssue(spaceId: string, prefix: string, assigneeAgentId: string | null) {
    const issueId = randomUUID();
    issueSequence += 1;
    await db.insert(issues).values({
      id: issueId,
      spaceId,
      identifier: `${prefix}-${issueSequence}`,
      title: `${prefix} issue ${issueSequence}`,
      status: "in_progress",
      priority: "medium",
      assigneeAgentId,
    });
    return issueId;
  }

  /** A run whose persisted context names `sourceIssueId`, not the target issue. */
  async function seedRun(spaceId: string, agentId: string, sourceIssueId: string) {
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId,
      spaceId,
      agentId,
      invocationSource: "assignment",
      triggerDetail: "system",
      status: "running",
      contextSnapshot: { issueId: sourceIssueId, wakeReason: "issue_assigned" },
    });
    return runId;
  }

  async function seedInteraction(spaceId: string, issueId: string, route: ResolutionRoute) {
    const fixture = INTERACTION_FIXTURES[route];
    const [row] = await db.insert(issueThreadInteractions).values({
      spaceId,
      issueId,
      kind: fixture.kind,
      status: "pending",
      continuationPolicy: "wake_assignee",
      requestedResolverPolicy: "anyone",
      effectiveResolverPolicy: "anyone",
      payload: fixture.payload as never,
    }).returning({ id: issueThreadInteractions.id });
    return row.id;
  }

  async function spendBudget(spaceId: string, agentId: string, runId: string, attempts: number) {
    if (attempts === 0) return;
    await db.insert(activityLog).values(Array.from({ length: attempts }, () => ({
      spaceId,
      actorType: "agent" as const,
      actorId: agentId,
      agentId,
      runId,
      action: "issue.cross_issue_influence_observed",
      entityType: "issue",
      entityId: runId,
    })));
  }

  async function countInfluenceRows(spaceId: string, runId: string, action: string) {
    const rows = await db
      .select({ id: activityLog.id })
      .from(activityLog)
      .where(and(
        eq(activityLog.spaceId, spaceId),
        eq(activityLog.runId, runId),
        eq(activityLog.action, action),
      ));
    return rows.length;
  }

  it.each(["accept", "reject", "respond", "verdicts"] as const)(
    "fails a capped run closed on cross-issue %s with no interaction, task, activity, or wake",
    async (route) => {
      const { spaceId, agentId } = await seedSpaceAndAgent("CAP");
      const sourceIssueId = await seedIssue(spaceId, "CAP", agentId);
      const targetIssueId = await seedIssue(spaceId, "CAP", agentId);
      const runId = await seedRun(spaceId, agentId, sourceIssueId);
      await spendBudget(spaceId, agentId, runId, CROSS_ISSUE_INFLUENCE_LIMIT);
      const interactionId = await seedInteraction(spaceId, targetIssueId, route);

      const res = await request(app(agentActor(spaceId, agentId, runId)))
        .post(`/api/issues/${targetIssueId}/interactions/${interactionId}/${route}`)
        .send(INTERACTION_FIXTURES[route].body);

      expect(res.status, JSON.stringify(res.body)).toBe(429);
      expect(res.body.details).toMatchObject({
        code: "cross_issue_influence_cap_exceeded",
        cap: CROSS_ISSUE_INFLUENCE_LIMIT,
        count: CROSS_ISSUE_INFLUENCE_LIMIT + 1,
        mode: "enforce",
      });
      expect(res.body.error).toContain("Try this:");
      // The refusal must not leak the run's own (possibly inaccessible) source
      // issue or the resolver policy it passed.
      expect(JSON.stringify(res.body)).not.toContain(sourceIssueId);
      expect(JSON.stringify(res.body)).not.toContain("anyone");

      const [interaction] = await db
        .select({ status: issueThreadInteractions.status, result: issueThreadInteractions.result })
        .from(issueThreadInteractions)
        .where(eq(issueThreadInteractions.id, interactionId));
      expect(interaction).toMatchObject({ status: "pending", result: null });

      const childIssues = await db
        .select({ id: issues.id })
        .from(issues)
        .where(and(eq(issues.spaceId, spaceId), eq(issues.parentId, targetIssueId)));
      expect(childIssues).toEqual([]);

      const wakes = await db
        .select({ id: agentWakeupRequests.id })
        .from(agentWakeupRequests)
        .where(eq(agentWakeupRequests.spaceId, spaceId));
      expect(wakes).toEqual([]);

      const resolutionActivity = await db
        .select({ action: activityLog.action, details: activityLog.details })
        .from(activityLog)
        .where(and(eq(activityLog.spaceId, spaceId), eq(activityLog.entityId, targetIssueId)));
      expect(resolutionActivity.map((row) => row.action)).toEqual([
        "issue.cross_issue_influence_cap_rejected",
      ]);
      expect(resolutionActivity[0].details).toMatchObject({
        kind: "interaction_resolution",
        allowed: false,
      });
      expect(await countInfluenceRows(spaceId, runId, "issue.cross_issue_influence_observed"))
        .toBe(CROSS_ISSUE_INFLUENCE_LIMIT);
    },
    30_000,
  );

  it("charges one budget slot for an allowed cross-issue resolution", async () => {
    const { spaceId, agentId } = await seedSpaceAndAgent("ALW");
    const sourceIssueId = await seedIssue(spaceId, "ALW", agentId);
    const targetIssueId = await seedIssue(spaceId, "ALW", agentId);
    const runId = await seedRun(spaceId, agentId, sourceIssueId);
    const interactionId = await seedInteraction(spaceId, targetIssueId, "respond");

    const res = await request(app(agentActor(spaceId, agentId, runId)))
      .post(`/api/issues/${targetIssueId}/interactions/${interactionId}/respond`)
      .send(INTERACTION_FIXTURES.respond.body);

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ status: "answered" });
    expect(await countInfluenceRows(spaceId, runId, "issue.cross_issue_influence_observed")).toBe(1);

    const [observed] = await db
      .select({ details: activityLog.details })
      .from(activityLog)
      .where(and(
        eq(activityLog.spaceId, spaceId),
        eq(activityLog.action, "issue.cross_issue_influence_observed"),
      ));
    expect(observed.details).toMatchObject({
      kind: "interaction_resolution",
      sourceIssueId,
      targetIssueId,
      count: 1,
    });
  }, 30_000);

  it("leaves same-issue and operator resolutions outside the counter", async () => {
    const { spaceId, agentId, userId } = await seedSpaceAndAgent("SME");
    const issueId = await seedIssue(spaceId, "SME", agentId);
    const operatorIssueId = await seedIssue(spaceId, "SME", agentId);
    const runId = await seedRun(spaceId, agentId, issueId);
    await spendBudget(spaceId, agentId, runId, CROSS_ISSUE_INFLUENCE_LIMIT);
    const sameIssueInteractionId = await seedInteraction(spaceId, issueId, "respond");
    const operatorInteractionId = await seedInteraction(spaceId, operatorIssueId, "respond");

    const sameIssue = await request(app(agentActor(spaceId, agentId, runId)))
      .post(`/api/issues/${issueId}/interactions/${sameIssueInteractionId}/respond`)
      .send(INTERACTION_FIXTURES.respond.body);
    expect(sameIssue.status, JSON.stringify(sameIssue.body)).toBe(200);

    const operator = await request(app(operatorActor(spaceId, userId)))
      .post(`/api/issues/${operatorIssueId}/interactions/${operatorInteractionId}/respond`)
      .send(INTERACTION_FIXTURES.respond.body);
    expect(operator.status, JSON.stringify(operator.body)).toBe(200);

    expect(await countInfluenceRows(spaceId, runId, "issue.cross_issue_influence_observed"))
      .toBe(CROSS_ISSUE_INFLUENCE_LIMIT);
    expect(await countInfluenceRows(spaceId, runId, "issue.cross_issue_influence_cap_rejected")).toBe(0);
  }, 30_000);

  it("cannot let concurrent cross-issue resolutions race past the cap", async () => {
    const { spaceId, agentId } = await seedSpaceAndAgent("RCE");
    const sourceIssueId = await seedIssue(spaceId, "RCE", agentId);
    const firstTargetId = await seedIssue(spaceId, "RCE", agentId);
    const secondTargetId = await seedIssue(spaceId, "RCE", agentId);
    const runId = await seedRun(spaceId, agentId, sourceIssueId);
    // One slot left in the shared budget for two simultaneous resolutions.
    await spendBudget(spaceId, agentId, runId, CROSS_ISSUE_INFLUENCE_LIMIT - 1);
    const firstInteractionId = await seedInteraction(spaceId, firstTargetId, "respond");
    const secondInteractionId = await seedInteraction(spaceId, secondTargetId, "respond");
    const client = app(agentActor(spaceId, agentId, runId));

    const results = await Promise.all([
      request(client)
        .post(`/api/issues/${firstTargetId}/interactions/${firstInteractionId}/respond`)
        .send(INTERACTION_FIXTURES.respond.body),
      request(client)
        .post(`/api/issues/${secondTargetId}/interactions/${secondInteractionId}/respond`)
        .send(INTERACTION_FIXTURES.respond.body),
    ]);

    expect(results.map((res) => res.status).sort()).toEqual([200, 429]);
    expect(await countInfluenceRows(spaceId, runId, "issue.cross_issue_influence_observed"))
      .toBe(CROSS_ISSUE_INFLUENCE_LIMIT);
    expect(await countInfluenceRows(spaceId, runId, "issue.cross_issue_influence_cap_rejected")).toBe(1);

    const answered = await db
      .select({ status: issueThreadInteractions.status })
      .from(issueThreadInteractions)
      .where(eq(issueThreadInteractions.spaceId, spaceId));
    expect(answered.map((row) => row.status).sort()).toEqual(["answered", "pending"]);
  }, 30_000);
});
