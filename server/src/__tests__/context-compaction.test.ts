import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { agents, spaces, createDb, heartbeatRuns, issues } from "@outpost/db";
import {
  ContextCompactionError,
  contextCompactionService,
  contextCompactionSupport,
  isContextCompactionRun,
  readContextCompactionRequest,
} from "../services/context-compaction.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

describe("context compaction support", () => {
  it("supports Codex and Claude on the Outpost runner only", () => {
    expect(contextCompactionSupport({ adapterType: "outpost_runner", adapterConfig: { provider: "codex" } }).supported).toBe(true);
    expect(contextCompactionSupport({ adapterType: "outpost_runner", adapterConfig: {} }).supported).toBe(true);
    expect(contextCompactionSupport({ adapterType: "outpost_runner", adapterConfig: { provider: "acpx", acpxAgent: "claude" } }).supported).toBe(true);
    expect(contextCompactionSupport({ adapterType: "outpost_runner", adapterConfig: { provider: "acpx", acpxAgent: "pi" } }).supported).toBe(false);
    expect(contextCompactionSupport({ adapterType: "outpost_runner", adapterConfig: { provider: "opencode" } }).supported).toBe(false);
    expect(contextCompactionSupport({ adapterType: "codex_local", adapterConfig: {} }).supported).toBe(false);
  });

  it("recognizes a compaction run from its context", () => {
    expect(readContextCompactionRequest({ contextCompactionRequestId: "req-1" })).toEqual({ requestId: "req-1" });
    expect(isContextCompactionRun({ contextCompactionRequestId: " " })).toBe(false);
    expect(isContextCompactionRun({ goalControlRequestId: "goal-1" })).toBe(false);
    expect(isContextCompactionRun(null)).toBe(false);
  });
});

const support = await getEmbeddedPostgresTestSupport();
const suite = support.supported ? describe : describe.skip;

suite("context compaction availability", () => {
  let db: ReturnType<typeof createDb>;
  let temporaryDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;
  beforeAll(async () => {
    temporaryDb = await startEmbeddedPostgresTestDatabase("context-compaction-");
    db = createDb(temporaryDb.connectionString);
  }, 60_000);
  afterAll(async () => { await temporaryDb?.cleanup(); });

  async function fixture(adapterConfig: Record<string, unknown> = { provider: "codex" }, adapterType = "outpost_runner") {
    const spaceId = randomUUID(), agentId = randomUUID(), issueId = randomUUID();
    await db.insert(spaces).values({ id: spaceId, name: "Compaction fixture", issuePrefix: `C${spaceId.slice(0, 6)}` });
    await db.insert(agents).values({ id: agentId, spaceId, name: "Codie", role: "engineer", status: "idle", adapterType, adapterConfig });
    await db.insert(issues).values({ id: issueId, spaceId, title: "Compact", status: "in_progress", assigneeAgentId: agentId });
    return { spaceId, agentId, issue: { id: issueId, assigneeAgentId: agentId as string | null, status: "in_progress" } };
  }

  it("is available for an idle supported agent and queues a compaction run", async () => {
    const { spaceId, agentId, issue } = await fixture();
    const wakeup = vi.fn(async () => ({ id: randomUUID() }));
    const service = contextCompactionService(db, { wakeup });
    expect(await service.availability(spaceId, issue)).toEqual({ status: "available", reasonCode: null, reason: null });
    const accepted = await service.request({ spaceId, issue, userId: "operator-user" });
    expect(wakeup).toHaveBeenCalledWith(agentId, expect.objectContaining({
      reason: "context_compaction",
      requestedByActorType: "user",
      requestedByActorId: "operator-user",
      allowRunCoalescing: false,
      manualUserWake: true,
      contextSnapshot: expect.objectContaining({
        issueId: issue.id,
        contextCompactionRequestId: accepted.requestId,
        skipIssueComment: true,
      }),
    }));
  });

  it("waits for an active run and reports a compaction already underway", async () => {
    const { spaceId, agentId, issue } = await fixture();
    const service = contextCompactionService(db, { wakeup: vi.fn() });
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({ id: runId, spaceId, agentId, scopeKind: "issue", issueId: issue.id, status: "running" });
    expect(await service.availability(spaceId, issue)).toMatchObject({ status: "unavailable", reasonCode: "agent_busy" });
    await expect(service.request({ spaceId, issue, userId: "operator-user" })).rejects.toMatchObject({ code: "agent_busy" });

    const { spaceId: otherSpaceId, agentId: otherAgentId, issue: otherIssue } = await fixture();
    const compactionRunId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: compactionRunId, spaceId: otherSpaceId, agentId: otherAgentId, scopeKind: "issue", status: "queued",
      contextSnapshot: { issueId: otherIssue.id, contextCompactionRequestId: "req-1" },
    });
    expect(await service.availability(otherSpaceId, otherIssue)).toEqual({
      status: "pending", reasonCode: null, reason: null, runId: compactionRunId,
    });
    await expect(service.request({ spaceId: otherSpaceId, issue: otherIssue, userId: "operator-user" }))
      .rejects.toBeInstanceOf(ContextCompactionError);
  });

  it("explains unsupported harnesses, closed tasks, and missing assignees", async () => {
    const unsupported = await fixture({ provider: "opencode" });
    const service = contextCompactionService(db);
    expect(await service.availability(unsupported.spaceId, unsupported.issue)).toMatchObject({
      status: "unavailable", reasonCode: "unsupported",
    });
    const closed = await fixture();
    expect(await service.availability(closed.spaceId, { ...closed.issue, status: "done" })).toMatchObject({
      status: "unavailable", reasonCode: "task_closed",
    });
    expect(await service.availability(closed.spaceId, { ...closed.issue, assigneeAgentId: null })).toMatchObject({
      status: "unavailable", reasonCode: "no_assignee",
    });
  });
});
