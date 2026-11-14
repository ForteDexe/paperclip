import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { activityLog, agentCommentary, agents, spaces, createDb, heartbeatRuns, issueComments, issues } from "@outpost/db";
import { startRecoveryPostgres } from "../../__tests__/helpers/recovery-postgres.js";
import { OutpostRunnerToolAuthority } from "./outpost-runner-tool-authority.js";

describe("tool receipt recovery through the mutation owner", () => {
  let temporary: Awaited<ReturnType<typeof startRecoveryPostgres>>;
  let db: ReturnType<typeof createDb>;
  beforeAll(async () => {
    temporary = await startRecoveryPostgres("tool-receipt-recovery-");
    db = createDb(temporary.connectionString);
  });
  afterAll(async () => { await temporary?.cleanup(); });

  async function fixture() {
    const spaceId = randomUUID(), agentId = randomUUID(), nextId = randomUUID(), issueId = randomUUID(), runId = randomUUID();
    await db.insert(spaces).values({ id: spaceId, name: "Receipt recovery", issuePrefix: `R${spaceId.slice(0, 6)}` });
    await db.insert(agents).values([
      { id: agentId, spaceId, name: "Manager", role: "lead", status: "active", adapterType: "outpost_runner" },
      { id: nextId, spaceId, name: "Engineer", role: "engineer", status: "active", adapterType: "outpost_runner" },
    ]);
    await db.insert(issues).values({ id: issueId, spaceId, title: "Coordinate", status: "in_progress", assigneeAgentId: agentId });
    await db.insert(heartbeatRuns).values({ id: runId, spaceId, agentId, status: "running", runtimeMode: "native", nativeIssueId: issueId, contextSnapshot: { issueId } });
    await db.update(issues).set({ executionRunId: runId }).where(eq(issues.id, issueId));
    const enqueueWakeup = vi.fn().mockResolvedValue(null);
    const stopTaskForReassignment = vi.fn().mockResolvedValue(undefined);
    const binding = { spaceId, agentId, issueId, runId, enqueueWakeup, stopTaskForReassignment, syncIssueExternalObjects: vi.fn().mockResolvedValue(undefined) };
    const replacement = () => new OutpostRunnerToolAuthority(db, binding);
    const effects = async () => ({
      activity: await db.select().from(activityLog).where(eq(activityLog.spaceId, spaceId)),
      comments: await db.select().from(issueComments).where(eq(issueComments.spaceId, spaceId)),
      commentary: await db.select().from(agentCommentary).where(eq(agentCommentary.spaceId, spaceId)),
      tasks: await db.select().from(issues).where(eq(issues.spaceId, spaceId)),
    });
    return { ...binding, nextId, replacement, effects };
  }

  it.each(["set_task_title", "submit_complaint", "submit_suggestion"])("recovers the owner's committed %s receipt without another effect", async tool => {
    const f = await fixture();
    const args = tool === "set_task_title"
      ? { title: "  A precise title  ", idempotencyKey: " receipt " }
      : { body: "  Synthetic feedback  ", idempotencyKey: " receipt " };
    const call = { tool, callId: "lost-response", arguments: args };
    const result = await f.replacement().execute(call);
    if (tool === "set_task_title") {
      // A later human edit must survive replay of the older successful title.
      await db.update(issues).set({ title: "Later human title" }).where(eq(issues.id, f.issueId));
    }
    const before = await f.effects();
    expect(await f.replacement().recover(call)).toEqual({ result: tool === "set_task_title" ? result : { ...result as object, replayed: true } });
    expect(await f.effects()).toEqual(before);
    expect(await f.replacement().recover({ ...call, arguments: { ...args, ...(tool === "set_task_title" ? { title: "Different intent" } : { body: "Different intent" }) } })).toBeNull();
    expect(await f.replacement().recover({ ...call, arguments: { ...args, idempotencyKey: "missing" } })).toBeNull();
    expect(await f.effects()).toEqual(before);
    await db.update(heartbeatRuns).set({ status: "cancelled" }).where(eq(heartbeatRuns.id, f.runId));
    await expect(f.replacement().recover(call)).rejects.toThrow("binding_not_authorized");
  });

  it("uses the progress owner's normalized key and holds absent or conflicting mutations", async () => {
    const f = await fixture();
    const call = { tool: "report_progress", callId: "lost-progress", arguments: { body: "Completed a step", idempotencyKey: " progress-1 " } };
    const result = await f.replacement().execute(call);
    const before = await f.effects();
    expect(await f.replacement().recover(call)).toEqual({ result });
    expect(await f.replacement().recover({ ...call, arguments: { ...call.arguments, body: "Different intent" } })).toBeNull();
    expect(await f.replacement().recover({ ...call, arguments: { ...call.arguments, idempotencyKey: "missing" } })).toBeNull();
    expect(await f.effects()).toEqual(before);
  });

  it("recovers a schema-normalized monitor without resetting its saved deadline", async () => {
    const f = await fixture();
    const call = { tool: "set_task_monitor", callId: "lost-monitor", arguments: { idempotencyKey: " monitor-1 ",
      monitor: { nextCheckAt: new Date(Date.now() + 60_000).toISOString(), notes: "  Check the saved result  " } } };
    const result = await f.replacement().execute(call);
    const before = await f.effects();
    expect(await f.replacement().recover(call)).toEqual({ result: { ...result as object, replayed: true } });
    expect(await f.replacement().recover({ ...call, arguments: { ...call.arguments, idempotencyKey: "missing" } })).toBeNull();
    expect(await f.effects()).toEqual(before);
  });

  it.each(["create_task", "reassign_task"])("repairs %s's dispatch after commit without repeating the business mutation", async tool => {
    const f = await fixture();
    const targetId = randomUUID();
    if (tool === "reassign_task") await db.insert(issues).values({ id: targetId, spaceId: f.spaceId, title: "Existing task", status: "todo", assigneeAgentId: f.agentId });
    const args = tool === "create_task"
      ? { title: "Delegate implementation", assigneeActorId: f.nextId, idempotencyKey: " dispatch-1 " }
      : { taskId: targetId, assigneeActorId: f.nextId, expectedAssigneeActorId: f.agentId, expectedStatusVersion: 0, reason: "Delegate implementation", idempotencyKey: " dispatch-1 " };
    const call = { tool, callId: "lost-dispatch", arguments: args };
    f.enqueueWakeup.mockRejectedValueOnce(new Error("queue response lost"));
    await expect(f.replacement().execute(call)).rejects.toThrow("queue response lost");
    const before = await f.effects();
    const originalWake = f.enqueueWakeup.mock.calls[0];
    const stopCount = f.stopTaskForReassignment.mock.calls.length;
    const recovered = await f.replacement().recover(call);
    expect(recovered?.result).toMatchObject({ disposition: "applied", scheduledWakeIds: [expect.any(String)] });
    expect(f.enqueueWakeup).toHaveBeenCalledTimes(2);
    expect(f.enqueueWakeup.mock.calls[1]).toEqual(originalWake);
    expect(f.stopTaskForReassignment).toHaveBeenCalledTimes(stopCount);
    expect(await f.effects()).toEqual(before);
    // An uncertain call with no receipt must not create, reassign, stop or wake.
    expect(await f.replacement().recover({ ...call, arguments: { ...args, idempotencyKey: "missing" } })).toBeNull();
    expect(f.enqueueWakeup).toHaveBeenCalledTimes(2);
    expect(f.stopTaskForReassignment).toHaveBeenCalledTimes(stopCount);
    expect(await f.effects()).toEqual(before);
    expect(await db.select().from(activityLog).where(and(eq(activityLog.spaceId, f.spaceId),
      eq(activityLog.action, tool === "create_task" ? "issue.created" : "issue.reassigned")))).toHaveLength(1);
  });
});
