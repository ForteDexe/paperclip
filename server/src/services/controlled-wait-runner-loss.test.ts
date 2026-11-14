import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { AdapterSandboxExecutionTarget } from "@outpost/adapter-utils/execution-target";
import { activityLog, agentWakeupRequests, heartbeatRuns, issueComments, issueRecoveryActions, issueThreadInteractions, issues } from "@outpost/db";
import { appendHeartbeatRunEvent } from "./heartbeat-run-events.js";
import { heartbeatService } from "./heartbeat.js";
import { requestInterruptedNativeTurnRetry } from "./heartbeat/restart-interrupted-turn.js";
import { getExecutionBlocker } from "./execution-blocker.js";
import { taskInterruptionPresentation } from "./task-interruption-presentation.js";
import { readSystemRecovery } from "./system-recovery-state.js";
import { reconcileRetainedWorkspaces } from "./workspace-recovery.js";
import { requestTaskRetry } from "./task-retry.js";
import { buildExecutionContinuation } from "./execution-continuation.js";
import { useWorkspaceRecoveryFixture, action, db, run, seed } from "./__tests__/workspace-recovery-fixture.js";

const targets = vi.hoisted(() => new Map<string, AdapterSandboxExecutionTarget>());
vi.mock("./environment-execution-target.js", async importOriginal => {
  const actual = await importOriginal<typeof import("./environment-execution-target.js")>();
  return { ...actual, resolveEnvironmentExecutionTarget: async (input: Parameters<typeof actual.resolveEnvironmentExecutionTarget>[0]) =>
    (input.leaseId ? targets.get(input.leaseId) : undefined) ?? actual.resolveEnvironmentExecutionTarget(input) };
});

describe("a held task with a pending decision after its remote runner was lost", () => {
  useWorkspaceRecoveryFixture(targets);

  const shapes = {
    parkedQuestion: { wakeReason: "issue_assigned", turnEvents: ["turn.started", "turn.accepted"],
      kind: "ask_user_questions", fromFailedRun: true },
    olderConnectionRequest: { wakeReason: "issue_monitor_due", turnEvents: [],
      kind: "connection_intent", fromFailedRun: false },
  } as const;

  async function lostRunnerWithPendingDecision(shape: keyof typeof shapes) {
    const s = shapes[shape];
    const f = await seed("native");
    const original = await run(f.runId);
    const [wake] = await db.insert(agentWakeupRequests).values({ spaceId: f.spaceId, agentId: original.agentId,
      source: "automation", triggerDetail: "system", reason: s.wakeReason, status: "failed", runId: f.runId,
      finishedAt: new Date(), payload: { issueId: f.issueId } }).returning();
    await db.update(heartbeatRuns).set({ errorCode: "native_continuation_requires_reconciliation",
      error: "runner_remote_process_identity_unavailable", wakeupRequestId: wake.id, responsibleUserId: "local-operator",
      startedAt: new Date(Date.now() - 20 * 60_000), contextSnapshot: { issueId: f.issueId, wakeReason: s.wakeReason },
    }).where(eq(heartbeatRuns.id, f.runId));
    for (const eventType of s.turnEvents)
      await appendHeartbeatRunEvent(db, { spaceId: f.spaceId, runId: f.runId, agentId: original.agentId,
        eventType, stream: "system", level: "info", message: eventType });
    const [older] = s.fromFailedRun ? [] : await db.insert(heartbeatRuns).values({ spaceId: f.spaceId,
      agentId: original.agentId, issueId: f.issueId, status: "succeeded", createdAt: new Date(Date.now() - 2 * 86_400_000),
      finishedAt: new Date(Date.now() - 86_400_000), contextSnapshot: { issueId: f.issueId } }).returning();
    const [decision] = await db.insert(issueThreadInteractions).values({ spaceId: f.spaceId, issueId: f.issueId,
      kind: s.kind, status: "pending", continuationPolicy: "wake_assignee", sourceRunId: older?.id ?? f.runId,
      createdByAgentId: original.agentId, title: "Which default should new agents get?",
      payload: { version: 1, questions: [{ id: "q1", prompt: "Which default?", selectionMode: "single",
        options: [{ id: "a", label: "Read only" }, { id: "b", label: "Full" }] }] } as never }).returning();
    const service = heartbeatService(db, { environmentRuntime: f.environmentRuntime });
    await db.insert(heartbeatRuns).values({ spaceId: f.spaceId, agentId: original.agentId, status: "running" });
    expect(await requestInterruptedNativeTurnRetry(db, f.runId)).toMatchObject({ requested: false });
    await vi.waitFor(async () => {
      await Promise.all(await reconcileRetainedWorkspaces(db, f.environmentRuntime, current => service.resumeRemoteStopComments(current)) ?? []);
      expect(readSystemRecovery((await action(f.actionId)).evidence)?.state).toBe("complete");
    }, { timeout: 10_000, interval: 10 });
    expect(await readFile(path.join(f.host, "saved.txt"), "utf8")).toBe("finished work\n");
    return { ...f, agentId: original.agentId, decision, service };
  }
  const queuedSuccessors = async (spaceId: string) => db.select().from(heartbeatRuns)
    .where(and(eq(heartbeatRuns.spaceId, spaceId), eq(heartbeatRuns.status, "queued")));
  const deferredWaits = async (spaceId: string) => (await db.select().from(agentWakeupRequests).where(and(
    eq(agentWakeupRequests.spaceId, spaceId), eq(agentWakeupRequests.status, "deferred_issue_execution"))))
    .map(wake => (wake.payload?.executionWait as { reason?: string } | undefined)?.reason);
  type Decision = typeof issueThreadInteractions.$inferSelect;
  const resolve = (decision: Decision, resolvedBy: string) => db.update(issueThreadInteractions).set({ status: "answered",
    resolvedByUserId: resolvedBy, resolvedAt: new Date(), result: { version: 1, answers: [{ questionId: "q1", optionIds: ["a"] }] } as never })
    .where(eq(issueThreadInteractions.id, decision.id));
  const deliverAnswer = (f: Awaited<ReturnType<typeof lostRunnerWithPendingDecision>>, decision: Decision, userId: string) =>
    f.service.wakeup(f.agentId, {
      source: "automation", triggerDetail: "system", reason: "issue_commented",
      payload: { issueId: f.issueId, interactionId: decision.id, interactionKind: decision.kind,
        interactionStatus: "answered", sourceCommentId: null, sourceRunId: decision.sourceRunId, mutation: "interaction" },
      idempotencyKey: `interaction:${decision.id}:answered`,
      requestedByActorType: "user", requestedByActorId: userId,
      contextSnapshot: { issueId: f.issueId, taskId: f.issueId, interactionId: decision.id,
        interactionKind: decision.kind, interactionStatus: "answered", sourceCommentId: null,
        sourceRunId: decision.sourceRunId, wakeReason: "issue_commented", source: "issue.interaction.resolve" },
    });
  const answer = async (f: Awaited<ReturnType<typeof lostRunnerWithPendingDecision>>, userId: string, resolvedBy = userId) => {
    await resolve(f.decision, resolvedBy);
    await deliverAnswer(f, f.decision, userId);
  };
  const dispatchContinuation = (f: Awaited<ReturnType<typeof lostRunnerWithPendingDecision>>, successor: typeof heartbeatRuns.$inferSelect) =>
    buildExecutionContinuation({ db, spaceId: f.spaceId, issueId: f.issueId, agentId: f.agentId,
      runId: successor.id, context: successor.contextSnapshot ?? {}, summary: null, exposeLowTrustRaw: false });

  it.each(Object.keys(shapes) as Array<keyof typeof shapes>)("%s: Retry starts exactly one run after the sandbox work is saved", async shape => {
    const f = await lostRunnerWithPendingDecision(shape);
    const issue = (await db.select().from(issues).where(eq(issues.id, f.issueId)))[0];
    expect(await getExecutionBlocker(db, f.spaceId, f.issueId)).toMatchObject({ runId: f.runId, canRetry: true,
      runError: "runner_remote_process_identity_unavailable", workspaceRecovery: { status: "recovered" } });
    expect(await taskInterruptionPresentation(db, issue)).toMatchObject({ state: "failed", canRetry: true, observedRunId: f.runId });
    const receipt = await requestTaskRetry({ db, spaceId: f.spaceId, issueId: f.issueId, actorId: "local-operator",
      actorSource: "local_implicit", idempotencyKey: randomUUID(), observedRunId: f.runId });
    expect(receipt).toMatchObject({ accepted: true });
    await f.service.resumeTaskRetry(f.spaceId, receipt.requestId!);
    expect({ successors: (await queuedSuccessors(f.spaceId)).length, deferred: await deferredWaits(f.spaceId) })
      .toEqual({ successors: 1, deferred: [] });
    const [successor] = await queuedSuccessors(f.spaceId);
    expect(successor.contextSnapshot).toMatchObject({ previousRunId: f.runId, taskRetryRequestId: receipt.requestId, forceFreshSession: true });
    expect((await db.select().from(issueThreadInteractions).where(eq(issueThreadInteractions.id, f.decision.id)))[0].status).toBe("pending");
  }, 60_000);

  it.each(Object.keys(shapes) as Array<keyof typeof shapes>)("%s: the person's answer to the pending decision continues the task", async shape => {
    const f = await lostRunnerWithPendingDecision(shape);
    await answer(f, "local-operator");
    expect({ successors: (await queuedSuccessors(f.spaceId)).length, deferred: await deferredWaits(f.spaceId) })
      .toEqual({ successors: 1, deferred: [] });
    const [successor] = await queuedSuccessors(f.spaceId);
    expect(successor.contextSnapshot).toMatchObject({ interactionId: f.decision.id, previousRunId: f.runId, forceFreshSession: true,
      explicitUserContinuation: { previousRunId: f.runId, commentId: null } });
    expect(await action(f.actionId)).toMatchObject({ status: "resolved",
      evidence: { explicitUserContinuation: { actorId: "local-operator", interactionId: f.decision.id, previousRunId: f.runId } } });
    expect(await db.select().from(activityLog).where(and(eq(activityLog.spaceId, f.spaceId),
      eq(activityLog.action, "issue.execution_recovery_settled"), eq(activityLog.actorId, "local-operator")))).toHaveLength(1);
    const envelope = await dispatchContinuation(f, successor);
    expect(envelope).toMatchObject({ trigger: { interactionId: f.decision.id }, interruptedRunId: f.runId });
    expect(envelope.interactionOutcomes).toEqual(expect.arrayContaining([expect.objectContaining({ id: f.decision.id })]));
  }, 60_000);

  it("dispatches the first answer's successor after a second answer coalesces into it", async () => {
    const f = await lostRunnerWithPendingDecision("parkedQuestion");
    const [second] = await db.insert(issueThreadInteractions).values({ spaceId: f.spaceId, issueId: f.issueId,
      kind: "ask_user_questions", status: "pending", continuationPolicy: "wake_assignee", sourceRunId: f.runId,
      createdByAgentId: f.agentId, title: "Which audit level?", payload: f.decision.payload }).returning();
    await resolve(f.decision, "local-operator");
    await resolve(second, "local-operator");
    await deliverAnswer(f, f.decision, "local-operator");
    await deliverAnswer(f, second, "local-operator");
    const successors = await queuedSuccessors(f.spaceId);
    expect(successors).toHaveLength(1);
    const [secondWake] = await db.select().from(agentWakeupRequests).where(and(eq(agentWakeupRequests.spaceId, f.spaceId),
      eq(agentWakeupRequests.idempotencyKey, `interaction:${second.id}:answered`)));
    expect(secondWake).toMatchObject({ status: "deferred_issue_execution", runId: null });
    for (const context of [successors[0].contextSnapshot ?? {},
      { ...successors[0].contextSnapshot, interactionId: second.id, interactionStatus: "answered" }]) {
      const envelope = await dispatchContinuation(f, { ...successors[0], contextSnapshot: context });
      expect(envelope.interactionOutcomes).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: f.decision.id }), expect.objectContaining({ id: second.id })]));
    }
  }, 60_000);

  it.each([
    ["a plan review", "request_confirmation", { version: 1, prompt: "Approve the plan?", target: { type: "issue_document", key: "plan", revisionId: randomUUID() } }],
    ["a controlled tool action", "request_confirmation", { version: 1, prompt: "Run it?", toolAction: { tool: "deploy" } }],
    ["a secret proposal", "request_confirmation", { version: 1, prompt: "Store it?", secretProposal: { name: "TOKEN" } }],
    ["a connection authorization", "connection_intent", { version: 1, serviceName: "Sentry", connectionAuthorization: { scope: "read" } }],
  ])("keeps Retry on hold while %s is pending", async (_label, kind, payload) => {
    const f = await lostRunnerWithPendingDecision("parkedQuestion");
    await db.update(issueThreadInteractions).set({ kind, payload: payload as never })
      .where(eq(issueThreadInteractions.id, f.decision.id));
    const receipt = await requestTaskRetry({ db, spaceId: f.spaceId, issueId: f.issueId, actorId: "local-operator",
      actorSource: "local_implicit", idempotencyKey: randomUUID(), observedRunId: f.runId });
    await f.service.resumeTaskRetry(f.spaceId, receipt.requestId!);
    expect({ successors: (await queuedSuccessors(f.spaceId)).length, deferred: await deferredWaits(f.spaceId) })
      .toEqual({ successors: 0, deferred: ["decision_pending"] });
  }, 60_000);

  it("lets a new message supersede a plain question and continue the task", async () => {
    const f = await lostRunnerWithPendingDecision("parkedQuestion");
    const [comment] = await db.insert(issueComments).values({ spaceId: f.spaceId, issueId: f.issueId,
      authorType: "user", authorUserId: "local-operator", body: "Please continue." }).returning();
    await f.service.wakeup(f.agentId, {
      source: "automation", triggerDetail: "system", reason: "issue_commented",
      payload: { issueId: f.issueId, commentId: comment.id, mutation: "comment" },
      requestedByActorType: "user", requestedByActorId: "local-operator",
      contextSnapshot: { issueId: f.issueId, taskId: f.issueId, wakeReason: "issue_commented", wakeCommentId: comment.id },
    });
    expect({ successors: (await queuedSuccessors(f.spaceId)).length, deferred: await deferredWaits(f.spaceId) })
      .toEqual({ successors: 1, deferred: [] });
  }, 60_000);

  it("keeps a new message waiting while a plan review is pending", async () => {
    const f = await lostRunnerWithPendingDecision("parkedQuestion");
    await db.update(issueThreadInteractions).set({ kind: "request_confirmation",
      payload: { version: 1, prompt: "Approve the plan?", target: { type: "issue_document", key: "plan", revisionId: randomUUID() } } as never })
      .where(eq(issueThreadInteractions.id, f.decision.id));
    const [comment] = await db.insert(issueComments).values({ spaceId: f.spaceId, issueId: f.issueId,
      authorType: "user", authorUserId: "local-operator", body: "Please continue." }).returning();
    await f.service.wakeup(f.agentId, {
      source: "automation", triggerDetail: "system", reason: "issue_commented",
      payload: { issueId: f.issueId, commentId: comment.id, mutation: "comment" },
      requestedByActorType: "user", requestedByActorId: "local-operator",
      contextSnapshot: { issueId: f.issueId, taskId: f.issueId, wakeReason: "issue_commented", wakeCommentId: comment.id },
    });
    expect({ successors: (await queuedSuccessors(f.spaceId)).length, deferred: await deferredWaits(f.spaceId) })
      .toEqual({ successors: 0, deferred: ["decision_pending"] });
  }, 60_000);

  it("keeps the hold when the wake's user did not give the answer", async () => {
    const f = await lostRunnerWithPendingDecision("parkedQuestion");
    await answer(f, "other-user", "local-operator");
    expect(await queuedSuccessors(f.spaceId)).toHaveLength(0);
    expect(await deferredWaits(f.spaceId)).toEqual(["execution_recovery"]);
    expect((await db.select().from(issueRecoveryActions).where(eq(issueRecoveryActions.id, f.actionId)))[0].evidence)
      .not.toHaveProperty("explicitUserContinuation");
  }, 60_000);
});
