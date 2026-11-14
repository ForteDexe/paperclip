import { agents, spaces, createDb, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS, heartbeatRuns, issueComments, issues } from "@outpost/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "../../__tests__/helpers/embedded-postgres.js";
import { createHeartbeatLifecycle, type HeartbeatLifecycleDependencies } from "./run-lifecycle.js";
import { createHeartbeatRunPreparation } from "./run-preparation.js";
import { createHeartbeatRunState } from "./run-state.js";

const support = await getEmbeddedPostgresTestSupport();
describe.skipIf(!support.supported)("persisted run completion comment selection", () => {
  let database: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    database = await startEmbeddedPostgresTestDatabase("outpost-run-comment-selection-");
    db = createDb(database.connectionString);
  }, EMBEDDED_POSTGRES_TEST_TIMEOUT_MS);
  afterAll(async () => { await db?.$client.end(); await database?.cleanup(); });

  it("retains system notices while selecting only a same-space task reply", async () => {
    const [space] = await db.insert(spaces).values({ name: "Notice selection", issuePrefix: "NSL" }).returning();
    const [otherSpace] = await db.insert(spaces).values({ name: "Other space", issuePrefix: "OTH" }).returning();
    const [agent] = await db.insert(agents).values({ spaceId: space.id, name: "Agent", adapterType: "process" }).returning();
    const [issue] = await db.insert(issues).values({ spaceId: space.id, title: "Reply Hi", assigneeAgentId: agent.id }).returning();
    const [run] = await db.insert(heartbeatRuns).values({ spaceId: space.id, agentId: agent.id, issueId: issue.id, status: "running" }).returning();
    const [notice] = await db.insert(issueComments).values({ spaceId: space.id, issueId: issue.id,
      authorAgentId: agent.id, createdByRunId: run.id, body: "## Workspace Ready",
      presentation: { kind: "system_notice", tone: "info", title: "Workspace ready", density: "compact", detailsDefaultOpen: false },
    }).returning();
    const dependencies = {
      ...createHeartbeatRunState(db), ...createHeartbeatRunPreparation(db),
      issuesSvc: { addComment: vi.fn(), listReviewAttention: vi.fn() },
      recovery: { escalateStrandedAssignedIssue: vi.fn() },
      spaceSkills: { completeTestRunForIssue: vi.fn() },
      budgets: { getInvocationBlock: vi.fn(async () => null) },
      treeControlSvc: { getActivePauseHoldGate: vi.fn(async () => null) },
      enqueueWakeup: vi.fn(), getCurrentUserRedactionOptions: vi.fn(async () => ({ enabled: false })),
      getAgentInvokability: vi.fn<HeartbeatLifecycleDependencies["getAgentInvokability"]>(async () => ({ invokable: true })),
      emitTerminalAgentTaskRun: vi.fn(), budgetHooks: {},
    } satisfies HeartbeatLifecycleDependencies;
    const lifecycle = createHeartbeatLifecycle(db, dependencies);
    expect(await lifecycle.findRunIssueComment(run.id, space.id, issue.id, {})).toBeNull();
    const [reply] = await db.insert(issueComments).values({ spaceId: space.id, issueId: issue.id,
      authorAgentId: agent.id, createdByRunId: run.id, body: "Hi",
    }).returning();
    expect(await lifecycle.findRunIssueComment(run.id, space.id, issue.id, {})).toMatchObject({ id: reply.id, body: "Hi" });
    expect(await lifecycle.findRunIssueComment(run.id, otherSpace.id, issue.id, {})).toBeNull();
    expect(await db.select().from(issueComments)).toEqual(expect.arrayContaining([expect.objectContaining({ id: notice.id }), expect.objectContaining({ id: reply.id })]));
  });
});
