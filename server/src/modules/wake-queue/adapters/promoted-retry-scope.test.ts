import { agentWakeupRequests, agents, spaces, createDb, heartbeatRuns, issues } from "@outpost/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../../../__tests__/helpers/embedded-postgres.js";
import { createReleaseIssueExecution } from "../application/use-cases.js";
import { createPostgresWakeQueueAdapter } from "./postgres.js";

const support = await getEmbeddedPostgresTestSupport();

// An operator Retry receipt stores only `{ issueId, taskRetry }`, with no saved
// wake context. Its promoted run takes the issue's execution lock, so it must
// stay issue-scoped for workspace and trust-boundary preparation.
describe.skipIf(!support.supported)("promoted Retry receipt scope", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("wake-promoted-retry-scope-");
    db = createDb(database.connectionString);
  }, 60_000);

  afterAll(async () => {
    await db?.$client.end();
    await database?.cleanup();
  });

  it("keeps a promoted Retry receipt without saved wake context scoped to its issue", async () => {
    const [space] = await db.insert(spaces).values({ name: "Retry scope fixture", issuePrefix: "RSF",
      defaultResponsibleUserId: "responsible-user" }).returning();
    const [agent] = await db.insert(agents).values({ spaceId: space.id, name: "Retry agent", adapterType: "process",
      runtimeConfig: { heartbeat: { wakeOnDemand: true, maxConcurrentRuns: 1 } } }).returning();
    const [issue] = await db.insert(issues).values({ spaceId: space.id, title: "Retry scope fixture issue",
      status: "in_review", priority: "medium", assigneeAgentId: agent.id }).returning();
    const [finished] = await db.insert(heartbeatRuns).values({ spaceId: space.id, agentId: agent.id,
      invocationSource: "on_demand", status: "succeeded", contextSnapshot: { issueId: issue.id } }).returning();
    await db.update(issues).set({ executionRunId: finished.id }).where(eq(issues.id, issue.id));
    const [wake] = await db.insert(agentWakeupRequests).values({
      spaceId: space.id, agentId: agent.id, source: "on_demand", triggerDetail: "manual", reason: "task_retry",
      status: "deferred_issue_execution", requestedByActorType: "user", requestedByActorId: "responsible-user",
      payload: { issueId: issue.id,
        taskRetry: { schema: "outpost.task-retry.v1", sourceRunId: finished.id, actorId: "responsible-user" } },
    }).returning();
    const release = createReleaseIssueExecution({
      issueLock: createPostgresWakeQueueAdapter(db, {
        resolveResponsibleUserId: async () => "responsible-user",
        getRoutineEnv: async () => ({ routineId: null, env: null, responsibleUserId: null }),
        resolveSessionBeforeForWakeup: async () => null,
      }),
      recovery: { escalateStrandedAssignedIssue: async () => undefined, escalateStrandedRecoveryIssueInPlace: async () => undefined },
    });

    const result = await release({ spaceId: space.id, runId: finished.id, now: new Date(), suppressImmediateRecovery: true });

    expect(result.outcome.kind).toBe("promoted");
    const [promoted] = await db.select().from(heartbeatRuns).where(eq(heartbeatRuns.wakeupRequestId, wake.id));
    expect(promoted).toMatchObject({ scopeKind: "issue", issueId: issue.id,
      contextSnapshot: { issueId: issue.id, taskId: issue.id, taskKey: issue.id, wakeReason: "task_retry" } });
    expect((await db.select().from(issues).where(eq(issues.id, issue.id)))[0].executionRunId).toBe(promoted.id);
  });
});
