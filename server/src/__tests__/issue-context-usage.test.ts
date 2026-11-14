import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, spaces, createDb, heartbeatRunEvents, heartbeatRuns, issues } from "@outpost/db";
import { issueContextUsage } from "../services/issue-context-usage.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe : describe.skip;
suite("issue context usage", () => {
  let db: ReturnType<typeof createDb>;
  let temporaryDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  beforeAll(async () => {
    temporaryDb = await startEmbeddedPostgresTestDatabase("issue-context-usage-");
    db = createDb(temporaryDb.connectionString);
  }, 60_000);
  afterAll(async () => { await temporaryDb?.cleanup(); });

  function orp(runId: string, sessionId: string, eventType: string, payload: Record<string, unknown>) {
    return { orpEvent: { schema: "outpost.orp.event.v1", runId, normalizedSessionId: sessionId, eventType, payload } };
  }

  it("returns the latest reported context window and counts the session's compactions", async () => {
    const spaceId = randomUUID(), agentId = randomUUID(), issueId = randomUUID(), otherIssueId = randomUUID();
    await db.insert(spaces).values({ id: spaceId, name: "Context fixture", issuePrefix: `X${spaceId.slice(0, 6)}` });
    await db.insert(agents).values({ id: agentId, spaceId, name: "Codie", role: "engineer", status: "idle", adapterType: "codex_local" });
    await db.insert(issues).values([
      { id: issueId, spaceId, title: "Context", status: "in_progress", assigneeAgentId: agentId },
      { id: otherIssueId, spaceId, title: "Other", status: "in_progress", assigneeAgentId: agentId },
    ]);
    expect(await issueContextUsage(db, spaceId, { id: issueId, assigneeAgentId: agentId })).toBeNull();

    const runId = randomUUID(), otherRunId = randomUUID();
    await db.insert(heartbeatRuns).values([
      { id: runId, spaceId, agentId, scopeKind: "issue", issueId, status: "running" },
      { id: otherRunId, spaceId, agentId, scopeKind: "issue", issueId: otherIssueId, status: "running" },
    ]);
    const usage = (usedTokens: number, total = { inputTokens: 76_682, cacheReadTokens: 48_896, outputTokens: 1_089 }) => ({
      kind: "usage",
      usage: { total, runDelta: total, context: { usedTokens, windowTokens: 258_400 } },
    });
    const base = { spaceId, agentId, stream: "system" as const, level: "info" as const };
    await db.insert(heartbeatRunEvents).values([
      { ...base, runId, seq: 1, eventType: "item.completed", payload: orp(runId, "session-a", "item.completed", usage(229_500)),
        createdAt: new Date("2026-11-05T10:00:00Z") },
      { ...base, runId, seq: 2, eventType: "context.compacted", payload: orp(runId, "session-a", "context.compacted", {
        schema: "outpost.context.compacted.v1", compactionId: "c-1" }), createdAt: new Date("2026-11-05T10:00:01Z") },
      // The same compaction reported twice (item completion and thread/compacted) counts once.
      { ...base, runId, seq: 5, eventType: "context.compacted", payload: orp(runId, "session-a", "context.compacted", {
        schema: "outpost.context.compacted.v1", compactionId: "c-1" }), createdAt: new Date("2026-11-05T10:00:01Z") },
      { ...base, runId, seq: 3, eventType: "item.completed", payload: orp(runId, "session-a", "item.completed", usage(38_200)),
        createdAt: new Date("2026-11-05T10:00:02Z") },
      { ...base, runId, seq: 4, eventType: "item.completed", payload: orp(runId, "session-a", "item.completed", { kind: "usage", usage: { total: {} } }),
        createdAt: new Date("2026-11-05T10:00:03Z") },
      { ...base, runId: otherRunId, seq: 1, eventType: "item.completed", payload: orp(otherRunId, "session-b", "item.completed", usage(5)),
        createdAt: new Date("2026-11-05T10:00:04Z") },
    ]);

    const issue = { id: issueId, assigneeAgentId: agentId };
    expect(await issueContextUsage(db, spaceId, issue)).toMatchObject({
      runId,
      agentId,
      sessionId: "session-a",
      usedTokens: 38_200,
      windowTokens: 258_400,
      totals: { inputTokens: 76_682, cachedInputTokens: 48_896, outputTokens: 1_089 },
      costUsd: null,
      compactions: 1,
    });
    expect(await issueContextUsage(db, randomUUID(), issue)).toBeNull();
    // Another assignee's session never shows through.
    expect(await issueContextUsage(db, spaceId, { id: issueId, assigneeAgentId: randomUUID() })).toBeNull();
    expect(await issueContextUsage(db, spaceId, { id: issueId, assigneeAgentId: null })).toBeNull();

    // A newer run that starts a fresh session hides the old session's reading
    // until the new session reports its own context.
    const freshRunId = randomUUID();
    await db.insert(heartbeatRuns).values({ id: freshRunId, spaceId, agentId, scopeKind: "issue", issueId, status: "running",
      createdAt: new Date("2026-11-05T11:00:00Z") });
    await db.insert(heartbeatRunEvents).values({ ...base, runId: freshRunId, seq: 1, eventType: "item.completed",
      payload: orp(freshRunId, "session-c", "item.completed", { kind: "usage", usage: { total: {} } }),
      createdAt: new Date("2026-11-05T11:00:01Z") });
    expect(await issueContextUsage(db, spaceId, issue)).toBeNull();
    await db.insert(heartbeatRunEvents).values({ ...base, runId: freshRunId, seq: 2, eventType: "item.completed",
      payload: orp(freshRunId, "session-c", "item.completed", usage(12_000)), createdAt: new Date("2026-11-05T11:00:02Z") });
    expect(await issueContextUsage(db, spaceId, issue)).toMatchObject({ sessionId: "session-c", usedTokens: 12_000, compactions: 0 });

    // A session reused across more runs than the lookup window still counts
    // compactions from its oldest runs.
    const later = ["2026-11-05T12:00:00Z", "2026-11-05T13:00:00Z", "2026-11-05T14:00:00Z"];
    for (const [index, at] of later.entries()) {
      const id = randomUUID();
      await db.insert(heartbeatRuns).values({ id, spaceId, agentId, scopeKind: "issue", issueId, status: "succeeded", createdAt: new Date(at) });
      await db.insert(heartbeatRunEvents).values({ ...base, runId: id, seq: 1, eventType: "item.completed",
        payload: orp(id, "session-c", "item.completed", usage(13_000 + index)), createdAt: new Date(at) });
    }
    await db.insert(heartbeatRunEvents).values({ ...base, runId: freshRunId, seq: 3, eventType: "context.compacted",
      payload: orp(freshRunId, "session-c", "context.compacted", { schema: "outpost.context.compacted.v1", compactionId: "c-2" }),
      createdAt: new Date("2026-11-05T11:00:03Z") });
    expect(await issueContextUsage(db, spaceId, issue)).toMatchObject({ sessionId: "session-c", usedTokens: 13_002, compactions: 1 });
  });
});
