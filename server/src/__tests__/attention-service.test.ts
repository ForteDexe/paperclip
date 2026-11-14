import { resolveExternalTestDatabaseUrl } from "./helpers/external-test-database.js";
import { createAgentLifecycle } from "../services/agent-lifecycle.js";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import { createFullDatabaseResponseCapture, installDatabaseResponseCapture } from "./helpers/full-database-response-capture.js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  approvals,
  assets,
  budgetIncidents,
  budgetPolicies,
  spaces,
  createDb,
  decisionQueueItems,
  decisionQueues,
  decisions,
  decisionTriage,
  documents,
  heartbeatRunEvents,
  heartbeatRuns,
  inboxDismissals,
  invites,
  issueApprovals,
  issueAttachments,
  issueDocuments,
  issueRecoveryActions,
  issueRelations,
  issueThreadInteractions,
  issues,
  joinRequests,
  projects,
  projectWorkspaces,
} from "@outpost/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { attentionRoutes } from "../routes/attention.js";
import { attentionService } from "../services/attention.js";
import { issueThreadInteractionService } from "../services/issue-thread-interactions.js";
import { decisionHistoryService } from "../services/decision-history.js";
import { listAttentionExhaustedRuns } from "../services/attention-exhausted-runs.js";
import { agentService } from "../services/agents.js";
import { ROUTABLE_BLOCKED_ROLLOUT_AT } from "../services/routable-blocked.js";

const externalUrl = resolveExternalTestDatabaseUrl("OUTPOST_ATTENTION_TEST_DATABASE_URL");
const embeddedPostgresSupport = externalUrl ? { supported: true, reason: undefined } : await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres attention service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("attention service", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    if (!externalUrl) tempDb = await startEmbeddedPostgresTestDatabase("outpost-attention-service-");
    db = createDb(externalUrl ?? tempDb!.connectionString, { maxConnections: 6 });
  }, 30_000);

  afterEach(async () => {
    await db.transaction(async (tx) => {
      // CASCADE emits a notice for every related table; keep cleanup quiet while
      // retaining warnings/errors and the same complete database reset.
      await tx.execute(sql`SET LOCAL client_min_messages = warning`);
      await tx.execute(sql`TRUNCATE TABLE spaces CASCADE`);
    });
  });

  afterAll(async () => {
    await db?.$client.end({ timeout: 1 });
    await tempDb?.cleanup();
  });

  async function seedSpace(prefix = "ATN") {
    const spaceId = randomUUID();
    const workerId = randomUUID();
    const reviewerId = randomUUID();
    const errorAgentId = randomUUID();

    await db.insert(spaces).values({
      id: spaceId,
      name: `${prefix} Co`,
      issuePrefix: prefix,
      requireOperatorApprovalForNewAgents: false,
    });
    await db.insert(agents).values([
      {
        id: workerId,
        spaceId,
        name: "Worker",
        role: "engineer",
        status: "idle",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: reviewerId,
        spaceId,
        name: "Reviewer",
        role: "qa",
        status: "idle",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: errorAgentId,
        spaceId,
        name: "Broken Agent",
        role: "engineer",
        status: "error",
        errorReason: "adapter config missing",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);

    return { spaceId, workerId, reviewerId, errorAgentId, prefix };
  }

  async function insertIssue(input: {
    spaceId: string;
    id?: string;
    identifier: string;
    title: string;
    status: string;
    priority?: string;
    parentId?: string | null;
    assigneeAgentId?: string | null;
    assigneeUserId?: string | null;
    originKind?: string;
    originId?: string | null;
    originFingerprint?: string;
    projectId?: string | null;
    projectWorkspaceId?: string | null;
    executionState?: Record<string, unknown> | null;
    updatedAt?: Date;
    createdAt?: Date;
    unblockDescriptor?: { owner: { userId: string } | "operator"; action: string } | null;
    blockedTransitionAt?: Date | null;
    visibility?: "open" | "private";
    privacyRootIssueId?: string | null;
    responsibleUserId?: string | null;
    harnessKind?: string | null;
    reviewPolicy?: "anyone" | "not_creator" | "human_only" | null;
  }) {
    const id = input.id ?? randomUUID();
    await db.insert(issues).values({
      id,
      spaceId: input.spaceId,
      identifier: input.identifier,
      title: input.title,
      status: input.status,
      priority: input.priority ?? "medium",
      reviewPolicy: input.reviewPolicy ?? null,
      parentId: input.parentId ?? null,
      projectId: input.projectId ?? null,
      projectWorkspaceId: input.projectWorkspaceId ?? null,
      assigneeAgentId: input.assigneeAgentId ?? null,
      assigneeUserId: input.assigneeUserId ?? null,
      originKind: input.originKind ?? "manual",
      originId: input.originId ?? null,
      originFingerprint: input.originFingerprint ?? "default",
      executionState: input.executionState ?? null,
      unblockDescriptor: input.unblockDescriptor ?? null,
      blockedTransitionAt: input.blockedTransitionAt ?? null,
      visibility: input.visibility ?? "open",
      privacyRootIssueId: input.privacyRootIssueId ?? null,
      responsibleUserId: input.responsibleUserId ?? null,
      harnessKind: input.harnessKind ?? null,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    });
    return id;
  }

  function pendingUserExecutionState(userId = "operator-user") {
    return {
      status: "pending",
      currentStageId: null,
      currentStageIndex: null,
      currentStageType: "review",
      currentParticipant: { type: "user", userId },
      returnAssignee: null,
      reviewRequest: null,
      completedStageIds: [],
      lastDecisionId: null,
      lastDecisionOutcome: null,
      monitor: null,
    };
  }

  function pendingAgentExecutionState(agentId: string) {
    return {
      ...pendingUserExecutionState(),
      currentParticipant: { type: "agent", agentId },
    };
  }

  it("excludes internal harness reviews from items, counts, and decision queues", async () => {
    const { spaceId, workerId } = await seedSpace("ATH");
    const harnessIssueId = await insertIssue({
      spaceId,
      identifier: "ATH-1",
      title: "Internal harness review",
      status: "in_review",
      assigneeAgentId: workerId,
      harnessKind: "skill_test",
    });
    const queueId = randomUUID();
    await db.insert(decisionQueues).values({
      id: queueId,
      spaceId,
      key: "internal-review",
      title: "Internal review",
      createdByType: "user",
      createdByUserId: "operator-user",
    });
    await db.insert(decisionQueueItems).values({
      spaceId,
      queueId,
      sourceKind: "review",
      sourceId: harnessIssueId,
      addedByType: "user",
      addedByUserId: "operator-user",
    });

    const feed = await attentionService(db).list(spaceId, { userId: "operator-user" });

    expect(feed.items.some((item) => item.subject.id === harnessIssueId)).toBe(false);
    expect(feed.countsBySourceKind.review ?? 0).toBe(0);
    expect(feed.items.flatMap((item) => item.queues).some((queue) => queue.key === "internal-review")).toBe(false);
  });

  it("includes existing pending chat questions and confirmations, then retains answered questions in history", async () => {
    const { spaceId, workerId } = await seedSpace("CHQ");
    const issueId = randomUUID(), questionId = randomUUID(), confirmationId = randomUUID();
    await db.insert(issues).values({
      id: issueId, spaceId, identifier: "CHQ-1", title: "Chat with Worker", status: "in_review",
      conversationAgentId: workerId, conversationUserId: "operator-user", conversationState: "waiting", assigneeAgentId: workerId,
    });
    await db.insert(issueThreadInteractions).values([
      { id: questionId, spaceId, issueId, kind: "ask_user_questions", status: "pending", title: "Choose the screen",
        createdByAgentId: workerId, addresseeUserId: "operator-user", effectiveResolverPolicy: "human_only",
        payload: { version: 1, questions: [{ id: "screen", prompt: "Which screen should we redesign?", options: [], selectionMode: "single", required: true, allowOther: true }] } },
      { id: confirmationId, spaceId, issueId, kind: "request_confirmation", status: "pending", title: "Approve the plan",
        createdByAgentId: workerId, addresseeUserId: "operator-user", payload: { version: 1, prompt: "Approve this plan?" } },
    ]);
    const actor = { type: "operator" as const, source: "session" as const, userId: "operator-user", spaceIds: [spaceId] };
    const options = { userId: actor.userId, actor };
    const service = attentionService(db);
    const feed = await service.list(spaceId, options);
    expect(feed.items.filter((item) => item.sourceKind === "issue_thread_interaction").map((item) => item.subject.id).sort())
      .toEqual([questionId, confirmationId].sort());
    expect(feed.items.find((item) => item.subject.id === questionId)).toMatchObject({
      inlineResolvable: true,
      relatedIssue: { id: issueId, identifier: "CHQ-1", href: "/CHQ/issues/CHQ-1" },
      subject: { href: `/CHQ/issues/CHQ-1#interaction-${questionId}`, metadata: { kind: "ask_user_questions", issueId } },
      detail: { kind: "questions", questionCount: 1, firstQuestionText: "Which screen should we redesign?" },
      resolverAudience: { effectiveResolverPolicy: "human_only" },
    });
    expect(feed.countsBySourceKind.issue_thread_interaction).toBe(2);
    expect(feed.countsBySourceKind.review).toBe(0);

    await db.update(issueThreadInteractions).set({ status: "answered", resolvedAt: new Date(), resolvedByUserId: actor.userId,
      result: { version: 1, answers: [{ questionId: "screen", optionIds: [], otherText: "Agent detail" }] } }).where(eq(issueThreadInteractions.id, questionId));
    const after = await service.list(spaceId, options);
    expect(after.items.some((item) => item.subject.id === questionId)).toBe(false);
    expect(after.countsBySourceKind.issue_thread_interaction).toBe(1);
    const history = await decisionHistoryService(db).list(spaceId, options);
    expect(history.items).toEqual([expect.objectContaining({ sourceId: questionId, issueId, outcome: "answered", label: "Answers recorded" })]);
  });

  it("keeps chat attention space, issue visibility, and addressee filters while ignoring idle chats without requests", async () => {
    const { spaceId, workerId, reviewerId } = await seedSpace("CHA");
    const other = await seedSpace("CHB");
    const scenarios = [
      { user: "operator-user", allowed: true },
      { user: "other-user", addresseeUserId: "other-user" },
      { user: "private-owner", visibility: "private", createdByUserId: "private-owner" },
      { user: "hidden-owner", hiddenAt: new Date() },
      { user: "harness-owner", harnessKind: "skill_test" },
      { user: "agent-addressee", addresseeAgentId: reviewerId },
      { user: "idle-owner", idle: true },
      { user: "other-space", spaceId: other.spaceId, agentId: other.workerId },
    ];
    const expected: string[] = [];
    for (const [index, scenario] of scenarios.entries()) {
      const issueId = randomUUID(), interactionId = randomUUID();
      const scopedSpaceId = scenario.spaceId ?? spaceId, agentId = scenario.agentId ?? workerId;
      await db.insert(issues).values({
        id: issueId, spaceId: scopedSpaceId, identifier: `CH-${index}`, title: `Chat ${scenario.user}`, status: "in_review",
        conversationAgentId: agentId, conversationUserId: scenario.user, conversationState: "waiting", assigneeAgentId: agentId,
        visibility: scenario.visibility ?? "open", createdByUserId: scenario.createdByUserId,
        hiddenAt: scenario.hiddenAt, harnessKind: scenario.harnessKind,
      });
      if (scenario.idle) continue;
      await db.insert(issueThreadInteractions).values({
        id: interactionId, spaceId: scopedSpaceId, issueId, kind: "ask_user_questions", status: "pending",
        title: `Question ${scenario.user}`, createdByAgentId: agentId,
        addresseeUserId: scenario.addresseeUserId ?? (scenario.addresseeAgentId ? null : "operator-user"),
        addresseeAgentId: scenario.addresseeAgentId,
        payload: { version: 1, questions: [] },
      });
      if (scenario.allowed) expected.push(interactionId);
    }
    const actor = { type: "operator" as const, source: "session" as const, userId: "operator-user", spaceIds: [spaceId], ignoreInstanceAdmin: true };
    const feed = await attentionService(db).list(spaceId, { actor, userId: actor.userId });
    expect(feed.items.filter((item) => item.sourceKind === "issue_thread_interaction").map((item) => item.subject.id)).toEqual(expected);
    expect(feed.countsBySourceKind.review).toBe(0);
  });

  it("keeps agent join approvals and omits human membership requests", async () => {
    const { spaceId } = await seedSpace("AJR");
    const humanInviteId = randomUUID();
    const agentInviteId = randomUUID();
    await db.insert(invites).values([
      {
        id: humanInviteId,
        spaceId,
        tokenHash: `hash-${humanInviteId}`,
        allowedJoinTypes: "human",
        expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      },
      {
        id: agentInviteId,
        spaceId,
        tokenHash: `hash-${agentInviteId}`,
        allowedJoinTypes: "agent",
        expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      },
    ]);
    await db.insert(joinRequests).values([
      {
        id: randomUUID(),
        inviteId: humanInviteId,
        spaceId,
        requestType: "human",
        status: "pending_approval",
        requestIp: "127.0.0.1",
        requestEmailSnapshot: "person@example.test",
      },
      {
        id: randomUUID(),
        inviteId: agentInviteId,
        spaceId,
        requestType: "agent",
        status: "pending_approval",
        requestIp: "127.0.0.1",
        agentName: "Invited worker",
        adapterType: "codex_local",
      },
    ]);

    const feed = await attentionService(db).list(spaceId, { userId: "operator-user" });
    const joins = feed.items.filter((item) => item.sourceKind === "join_request");
    expect(joins.map((item) => item.subject.title)).toEqual(["Invited worker"]);
    expect(joins[0]?.subject.href).toBe("/AJR/inbox/mine");
  });

  it("returns ranked decision-only items for every active source and excludes non-human or transient rows", async () => {
    const { spaceId, workerId, reviewerId } = await seedSpace("ATN");
    const baseTime = new Date("2026-07-09T12:00:00.000Z");
    const interactionIssueId = await insertIssue({
      spaceId,
      identifier: "ATN-1",
      title: "Needs interaction",
      status: "in_progress",
      assigneeAgentId: workerId,
      updatedAt: baseTime,
    });
    const recoverySourceIssueId = await insertIssue({
      spaceId,
      identifier: "ATN-2",
      title: "Needs recovery",
      status: "in_progress",
      assigneeAgentId: workerId,
      updatedAt: baseTime,
    });
    const agentRecoverySourceIssueId = await insertIssue({
      spaceId,
      identifier: "ATN-21",
      title: "Agent-owned recovery source",
      status: "in_progress",
      assigneeAgentId: workerId,
      updatedAt: baseTime,
    });
    const productivitySourceIssueId = await insertIssue({
      spaceId,
      identifier: "ATN-3",
      title: "Needs productivity review source",
      status: "in_progress",
      assigneeAgentId: workerId,
      updatedAt: baseTime,
    });
    const agentProductivitySourceIssueId = await insertIssue({
      spaceId,
      identifier: "ATN-31",
      title: "Agent productivity review source",
      status: "in_progress",
      assigneeAgentId: workerId,
      updatedAt: baseTime,
    });
    const blockerParentId = await insertIssue({
      spaceId,
      identifier: "ATN-4",
      title: "Blocked parent",
      status: "blocked",
      blockedTransitionAt: new Date(ROUTABLE_BLOCKED_ROLLOUT_AT.getTime() + 1),
      updatedAt: new Date("2026-07-09T12:04:00.000Z"),
    });
    const blockerLeafId = await insertIssue({
      spaceId,
      identifier: "ATN-5",
      title: "Stalled review blocker",
      status: "in_review",
      assigneeAgentId: reviewerId,
      // PAP-16506: the /decisions review card states who may give the verdict,
      // so the subject has to carry the issue's opt-in constraint.
      reviewPolicy: "human_only",
      updatedAt: new Date("2026-07-09T12:05:00.000Z"),
    });
    await db.insert(issueRelations).values({
      spaceId,
      issueId: blockerLeafId,
      relatedIssueId: blockerParentId,
      type: "blocks",
    });
    const reviewUserIssueId = await insertIssue({
      spaceId,
      identifier: "ATN-6",
      title: "Human review",
      status: "in_review",
      executionState: pendingUserExecutionState(),
      updatedAt: new Date("2026-07-09T12:06:00.000Z"),
    });
    await insertIssue({
      spaceId,
      identifier: "ATN-7",
      title: "Agent review excluded",
      status: "in_review",
      executionState: pendingAgentExecutionState(reviewerId),
      updatedAt: new Date("2026-07-09T12:07:00.000Z"),
    });

    const pendingApprovalId = randomUUID();
    await db.insert(approvals).values([
      {
        id: pendingApprovalId,
        spaceId,
        type: "create_agent",
        status: "pending",
        payload: { title: "Create Designer" },
        createdAt: new Date("2026-07-09T12:01:00.000Z"),
        updatedAt: new Date("2026-07-09T12:01:00.000Z"),
      },
      {
        id: randomUUID(),
        spaceId,
        type: "create_agent",
        status: "revision_requested",
        payload: { title: "Revision requested" },
        createdAt: new Date("2026-07-09T12:02:00.000Z"),
        updatedAt: new Date("2026-07-09T12:02:00.000Z"),
      },
    ]);

    await db.insert(issueThreadInteractions).values([
      {
        id: randomUUID(),
        spaceId,
        issueId: interactionIssueId,
        kind: "ask_user_questions",
        status: "pending",
        continuationPolicy: "wake_assignee",
        title: "Pick a launch date",
        payload: { version: 1, questions: [] },
        createdAt: new Date("2026-07-09T12:03:00.000Z"),
        updatedAt: new Date("2026-07-09T12:03:00.000Z"),
      },
      {
        id: randomUUID(),
        spaceId,
        issueId: interactionIssueId,
        kind: "ask_user_questions",
        status: "pending",
        continuationPolicy: "wake_assignee",
        addresseeAgentId: reviewerId,
        title: "Ask the reviewer privately",
        payload: { version: 1, questions: [] },
        createdAt: new Date("2026-07-09T12:03:15.000Z"),
        updatedAt: new Date("2026-07-09T12:03:15.000Z"),
      },
      {
        id: randomUUID(),
        spaceId,
        issueId: interactionIssueId,
        kind: "request_confirmation",
        status: "accepted",
        continuationPolicy: "wake_assignee",
        title: "Already accepted",
        payload: { version: 1, prompt: "Already done" },
        createdAt: new Date("2026-07-09T12:03:30.000Z"),
        updatedAt: new Date("2026-07-09T12:03:30.000Z"),
      },
    ]);

    const inviteId = randomUUID();
    await db.insert(invites).values({
      id: inviteId,
      spaceId,
      tokenHash: `hash-${inviteId}`,
      allowedJoinTypes: "agent",
      expiresAt: new Date("2026-07-10T00:00:00.000Z"),
    });
    await db.insert(joinRequests).values({
      id: randomUUID(),
      inviteId,
      spaceId,
      requestType: "agent",
      status: "pending_approval",
      requestIp: "127.0.0.1",
      agentName: "Invited worker",
      adapterType: "codex_local",
      createdAt: new Date("2026-07-09T12:04:30.000Z"),
      updatedAt: new Date("2026-07-09T12:04:30.000Z"),
    });

    await db.insert(issueRecoveryActions).values([
      {
        id: randomUUID(),
        spaceId,
        sourceIssueId: recoverySourceIssueId,
        kind: "missing_disposition",
        status: "escalated",
        ownerType: "operator",
        ownerAgentId: null,
        ownerUserId: null,
        cause: "missing_disposition",
        fingerprint: "human-recovery",
        evidence: {},
        nextAction: "Choose the final disposition.",
        createdAt: new Date("2026-07-09T12:05:00.000Z"),
        updatedAt: new Date("2026-07-09T12:05:00.000Z"),
      },
      {
        id: randomUUID(),
        spaceId,
        sourceIssueId: agentRecoverySourceIssueId,
        kind: "stranded_assigned_issue",
        status: "active",
        ownerType: "agent",
        ownerAgentId: workerId,
        ownerUserId: null,
        cause: "stranded",
        fingerprint: "agent-recovery",
        evidence: {},
        nextAction: "Agent should self-heal.",
        createdAt: new Date("2026-07-09T12:05:30.000Z"),
        updatedAt: new Date("2026-07-09T12:05:30.000Z"),
      },
    ]);

    await insertIssue({
      spaceId,
      identifier: "ATN-8",
      title: "Human productivity review",
      status: "todo",
      priority: "high",
      parentId: productivitySourceIssueId,
      assigneeUserId: "operator-user",
      originKind: "issue_productivity_review",
      originId: productivitySourceIssueId,
      originFingerprint: `productivity-review:${productivitySourceIssueId}`,
      updatedAt: new Date("2026-07-09T12:08:00.000Z"),
    });
    await insertIssue({
      spaceId,
      identifier: "ATN-9",
      title: "Agent productivity review excluded",
      status: "todo",
      priority: "high",
      parentId: agentProductivitySourceIssueId,
      assigneeAgentId: workerId,
      originKind: "issue_productivity_review",
      originId: agentProductivitySourceIssueId,
      originFingerprint: `productivity-review-agent:${agentProductivitySourceIssueId}`,
      updatedAt: new Date("2026-07-09T12:08:30.000Z"),
    });

    const exhaustedRunId = randomUUID();
    const transientRunId = randomUUID();
    await db.insert(heartbeatRuns).values([
      {
        id: exhaustedRunId,
        spaceId,
        agentId: workerId,
        invocationSource: "automation",
        status: "failed",
        error: "adapter failed",
        errorCode: "adapter_failed",
        contextSnapshot: { issueId: reviewUserIssueId },
        scheduledRetryAttempt: 4,
        scheduledRetryReason: "transient_failure",
        createdAt: new Date("2026-07-09T12:09:00.000Z"),
        updatedAt: new Date("2026-07-09T12:09:00.000Z"),
        finishedAt: new Date("2026-07-09T12:09:00.000Z"),
      },
      {
        id: transientRunId,
        spaceId,
        agentId: reviewerId,
        invocationSource: "automation",
        status: "failed",
        error: "will retry",
        errorCode: "provider_quota",
        contextSnapshot: { issueId: interactionIssueId },
        createdAt: new Date("2026-07-09T12:09:30.000Z"),
        updatedAt: new Date("2026-07-09T12:09:30.000Z"),
        finishedAt: new Date("2026-07-09T12:09:30.000Z"),
      },
    ]);
    await db.insert(heartbeatRunEvents).values({
      spaceId,
      runId: exhaustedRunId,
      agentId: workerId,
      seq: 1,
      eventType: "lifecycle",
      message: "Bounded retry exhausted after 4 scheduled attempts; no further automatic retry will be queued",
      payload: { retryReason: "transient_failure", maxAttempts: 4 },
      createdAt: new Date("2026-07-09T12:09:01.000Z"),
    });

    const softPolicy85Id = randomUUID();
    const softPolicy84Id = randomUUID();
    const hardPolicyId = randomUUID();
    await db.insert(budgetPolicies).values([
      {
        id: softPolicy85Id,
        spaceId,
        scopeType: "space",
        scopeId: spaceId,
        metric: "billed_cents",
        windowKind: "calendar_month_utc",
        amount: 100,
      },
      {
        id: softPolicy84Id,
        spaceId,
        scopeType: "space",
        scopeId: spaceId,
        metric: "billed_cents",
        windowKind: "lifetime",
        amount: 100,
      },
      {
        id: hardPolicyId,
        spaceId,
        scopeType: "agent",
        scopeId: workerId,
        metric: "billed_cents",
        windowKind: "calendar_month_utc",
        amount: 100,
      },
    ]);
    await db.insert(budgetIncidents).values([
      {
        spaceId,
        policyId: softPolicy85Id,
        scopeType: "space",
        scopeId: spaceId,
        metric: "billed_cents",
        windowKind: "calendar_month_utc",
        windowStart: new Date("2026-07-01T00:00:00.000Z"),
        windowEnd: new Date("2026-08-01T00:00:00.000Z"),
        thresholdType: "soft",
        amountLimit: 100,
        amountObserved: 85,
        status: "open",
        createdAt: new Date("2026-07-09T12:10:00.000Z"),
        updatedAt: new Date("2026-07-09T12:10:00.000Z"),
      },
      {
        spaceId,
        policyId: softPolicy84Id,
        scopeType: "space",
        scopeId: spaceId,
        metric: "billed_cents",
        windowKind: "lifetime",
        windowStart: new Date("1970-01-01T00:00:00.000Z"),
        windowEnd: new Date("9999-01-01T00:00:00.000Z"),
        thresholdType: "soft",
        amountLimit: 100,
        amountObserved: 84,
        status: "open",
        createdAt: new Date("2026-07-09T12:10:30.000Z"),
        updatedAt: new Date("2026-07-09T12:10:30.000Z"),
      },
      {
        spaceId,
        policyId: hardPolicyId,
        scopeType: "agent",
        scopeId: workerId,
        metric: "billed_cents",
        windowKind: "calendar_month_utc",
        windowStart: new Date("2026-07-01T00:00:00.000Z"),
        windowEnd: new Date("2026-08-01T00:00:00.000Z"),
        thresholdType: "hard",
        amountLimit: 100,
        amountObserved: 100,
        status: "open",
        createdAt: new Date("2026-07-09T12:11:00.000Z"),
        updatedAt: new Date("2026-07-09T12:11:00.000Z"),
      },
    ]);

    const feed = await attentionService(db).list(spaceId, { userId: "operator-user" });

    expect(feed.totalCount).toBe(11);
    expect(feed.countsBySourceKind).toMatchObject({
      approval: 1,
      issue_thread_interaction: 1,
      join_request: 1,
      recovery_action: 1,
      productivity_review: 0,
      blocker_attention: 1,
      review: 2,
      failed_run: 1,
      budget_alert: 2,
      agent_error_alert: 1,
    });
    expect(feed.items.map((item) => item.sourceKind)).toEqual(expect.arrayContaining([
      "approval",
      "issue_thread_interaction",
      "join_request",
      "recovery_action",
      "blocker_attention",
      "review",
      "failed_run",
      "budget_alert",
      "agent_error_alert",
    ]));
    expect(feed.items.some((item) => item.subject.title === "Invited worker")).toBe(true);
    for (const item of feed.items) {
      expect(item.dedupKey).toBeTruthy();
      expect(item.dismissalKey).toBe(`attention:${item.dedupKey}`);
      expect(item.whyNow).toBeTruthy();
      expect(item.entryRule).toBeTruthy();
      expect(item.exitRule).toBeTruthy();
      expect(item.decisionVerbs.length).toBeGreaterThan(0);
      expect(item.rank).toBeGreaterThan(0);
    }
    expect(feed.items.some((item) => item.subject.title === "Revision requested")).toBe(false);
    expect(feed.items.some((item) => item.sourceKind === "productivity_review")).toBe(false);
    expect(feed.items.some((item) => item.subject.title === "Agent productivity review excluded")).toBe(false);
    const legacyReviews = await db.select().from(issues).where(eq(issues.originKind, "issue_productivity_review"));
    expect(legacyReviews).toHaveLength(2);
    expect(legacyReviews).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Human productivity review", status: "todo", assigneeUserId: "operator-user", parentId: productivitySourceIssueId }),
      expect.objectContaining({ title: "Agent productivity review excluded", status: "todo", assigneeAgentId: workerId, parentId: agentProductivitySourceIssueId }),
    ]));
    expect(feed.items.some((item) => item.subject.title === "Agent review excluded")).toBe(false);
    expect(feed.items.some((item) =>
      item.sourceKind === "failed_run" && item.subject.metadata?.errorCode === "provider_quota"
    )).toBe(false);
    expect(feed.items.find((item) => item.sourceKind === "approval")?.detail).toMatchObject({
      kind: "approval",
      approvalType: "create_agent",
      summaryExcerpt: "Create Designer",
    });
    expect(feed.items.find((item) => item.sourceKind === "issue_thread_interaction")?.detail).toMatchObject({
      kind: "questions",
      questionCount: 0,
    });
    expect(feed.items.find((item) => item.sourceKind === "blocker_attention")?.detail).toMatchObject({
      kind: "blocker",
      blockingIssue: null,
      blockedTaskCount: 1,
    });
    expect(feed.items.find((item) => item.sourceKind === "blocker_attention")?.subject.id).toBe(blockerLeafId);
    expect(feed.items.find((item) =>
      item.sourceKind === "review" && item.subject.title === "Stalled review blocker"
    )).toMatchObject({
      whyNow: expect.stringContaining("without a maintained"),
      // A stalled review resolves in-row on the /decisions card (PAP-16080 §4.4).
      inlineResolvable: true,
      subject: expect.objectContaining({
        metadata: expect.objectContaining({
          reviewAttentionState: "stalled",
          reviewPolicy: "human_only",
        }),
      }),
      decisionVerbs: expect.arrayContaining([
        expect.objectContaining({ id: "choose_review_path", label: "Choose review path" }),
      ]),
    });
    expect(feed.items.find((item) => item.sourceKind === "failed_run")?.detail).toMatchObject({
      kind: "failed_run",
      agentName: "Worker",
      failureReasonExcerpt: "adapter failed",
    });
    expect(feed.items.find((item) =>
      item.sourceKind === "budget_alert" && item.detail?.kind === "budget" && item.detail.observedPercent === 100
    )).toBeTruthy();
    expect(feed.items.find((item) => item.sourceKind === "agent_error_alert")?.detail).toMatchObject({
      kind: "agent_error",
      agentName: "Broken Agent",
      failureReasonExcerpt: "adapter config missing",
    });
  });

  it("returns addressed interactions to operator attention after addressee pause or termination", async () => {
    const { spaceId, reviewerId } = await seedSpace("ATF");
    const pausedReviewerId = randomUUID();
    const terminatedReviewerId = randomUUID();
    await db.insert(agents).values([
      {
        id: pausedReviewerId,
        spaceId,
        name: "Paused Reviewer",
        role: "qa",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: terminatedReviewerId,
        spaceId,
        name: "Terminated Reviewer",
        role: "qa",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);
    const issueId = await insertIssue({
      spaceId,
      identifier: "ATF-1",
      title: "Needs a decision",
      status: "in_progress",
    });
    await db.insert(issueThreadInteractions).values([
      {
        id: randomUUID(),
        spaceId,
        issueId,
        kind: "ask_user_questions",
        status: "pending",
        continuationPolicy: "wake_assignee",
        title: "Operator question",
        payload: { version: 1, questions: [] },
      },
      {
        id: randomUUID(),
        spaceId,
        issueId,
        kind: "ask_user_questions",
        status: "pending",
        continuationPolicy: "wake_assignee",
        addresseeAgentId: reviewerId,
        title: "Active reviewer question",
        payload: { version: 1, questions: [] },
      },
      {
        id: randomUUID(),
        spaceId,
        issueId,
        kind: "ask_user_questions",
        status: "pending",
        continuationPolicy: "wake_assignee",
        addresseeAgentId: pausedReviewerId,
        title: "Paused reviewer question",
        payload: { version: 1, questions: [] },
      },
      {
        id: randomUUID(),
        spaceId,
        issueId,
        kind: "ask_user_questions",
        status: "pending",
        continuationPolicy: "wake_assignee",
        addresseeAgentId: terminatedReviewerId,
        title: "Terminated reviewer question",
        payload: { version: 1, questions: [] },
      },
    ]);

    await createAgentLifecycle(db).pauseAgent(pausedReviewerId);
    await createAgentLifecycle(db).terminateAgent(terminatedReviewerId);

    const feed = await attentionService(db).list(spaceId, { userId: "operator-user" });
    const interactionTitles = feed.items
      .filter((item) => item.sourceKind === "issue_thread_interaction")
      .map((item) => item.subject.title);

    expect(interactionTitles).toEqual(expect.arrayContaining([
      "Operator question",
      "Paused reviewer question",
      "Terminated reviewer question",
    ]));
    expect(interactionTitles).not.toContain("Active reviewer question");
  });

  // PAP-17287: a collapsed queue row offers Accept/Reject before anything fetches
  // the interaction, so the audience the resolution routes will enforce has to
  // ship with the feed item.
  it("ships the effective resolver audience with each interaction row", async () => {
    const { spaceId, workerId, reviewerId } = await seedSpace("ARA");
    const issueId = await insertIssue({
      spaceId,
      identifier: "ARA-1",
      title: "Needs a decision",
      status: "in_progress",
    });
    await db.insert(issueThreadInteractions).values([
      {
        id: randomUUID(),
        spaceId,
        issueId,
        kind: "ask_user_questions",
        status: "pending",
        title: "Open question",
        createdByAgentId: workerId,
        payload: { version: 1, questions: [] },
      },
      {
        id: randomUUID(),
        spaceId,
        issueId,
        kind: "ask_user_questions",
        status: "pending",
        title: "Creator-excluded question",
        createdByAgentId: workerId,
        requestedResolverPolicy: "not_creator",
        effectiveResolverPolicy: "not_creator",
        resolverPolicyProvenance: "explicit",
        payload: { version: 1, questions: [] },
      },
      {
        id: randomUUID(),
        spaceId,
        issueId,
        kind: "ask_user_questions",
        status: "pending",
        title: "Capped question",
        createdByAgentId: workerId,
        requestedResolverPolicy: "anyone",
        effectiveResolverPolicy: "human_only",
        effectiveResolverPolicySource: "space_cap",
        payload: { version: 1, questions: [] },
      },
    ]);
    // An addressed card only reaches operator attention once its addressee cannot
    // act, which is exactly when naming the addressee matters most.
    await db.insert(issueThreadInteractions).values({
      id: randomUUID(),
      spaceId,
      issueId,
      kind: "ask_user_questions",
      status: "pending",
      title: "Addressed question",
      createdByAgentId: workerId,
      addresseeAgentId: reviewerId,
      payload: { version: 1, questions: [] },
    });
    await db.insert(issueThreadInteractions).values({
      id: randomUUID(),
      spaceId,
      issueId,
      kind: "ask_user_questions",
      status: "pending",
      title: "User-addressed question",
      createdByAgentId: workerId,
      addresseeUserId: "operator-user",
      requestedResolverPolicy: "human_only",
      effectiveResolverPolicy: "human_only",
      payload: { version: 1, questions: [] },
    });
    await createAgentLifecycle(db).pauseAgent(reviewerId);

    const feed = await attentionService(db).list(spaceId, { userId: "operator-user" });
    const otherUserFeed = await attentionService(db).list(spaceId, { userId: "other-user" });
    const audienceByTitle = new Map(feed.items
      .filter((item) => item.sourceKind === "issue_thread_interaction")
      .map((item) => [item.subject.title, item.resolverAudience]));

    expect(audienceByTitle.get("Open question")).toMatchObject({
      requestedResolverPolicy: "anyone",
      effectiveResolverPolicy: "anyone",
      effectiveResolverPolicySource: "requested",
      addresseeAgentId: null,
      addresseeName: null,
    });
    expect(audienceByTitle.get("Creator-excluded question")).toMatchObject({
      effectiveResolverPolicy: "not_creator",
      createdByAgentId: workerId,
      createdByAgentName: "Worker",
    });
    expect(audienceByTitle.get("Capped question")).toMatchObject({
      requestedResolverPolicy: "anyone",
      effectiveResolverPolicy: "human_only",
      effectiveResolverPolicySource: "space_cap",
    });
    expect(audienceByTitle.get("Addressed question")).toMatchObject({
      addresseeAgentId: reviewerId,
      addresseeName: "Reviewer",
    });
    expect(audienceByTitle.get("User-addressed question")).toMatchObject({
      addresseeUserId: "operator-user",
      effectiveResolverPolicy: "human_only",
    });
    expect(otherUserFeed.items.some((item) => item.subject.title === "User-addressed question")).toBe(false);
    // Non-interaction rows carry no resolver policy at all.
    expect(feed.items.find((item) => item.sourceKind !== "issue_thread_interaction")?.resolverAudience)
      .toBeNull();
  });

  it("reads one compact row per exhausted run despite thousands of historical receipts", async () => {
    const { spaceId, workerId, reviewerId } = await seedSpace("MEM");
    const other = await seedSpace("OTH");
    await db.update(agents).set({ status: "terminated" }).where(eq(agents.id, reviewerId));
    const issueId = await insertIssue({
      spaceId, identifier: "MEM-1", title: "Failed task", status: "in_progress",
    });
    const taskId = await insertIssue({
      spaceId, identifier: "MEM-2", title: "Timed out task", status: "in_progress",
    });
    const [failedId, timedOutId, succeededId, terminatedId, foreignId, noReceiptId] =
      Array.from({ length: 6 }, () => randomUUID());
    const createdAt = new Date("2026-07-09T12:00:00.000Z");
    await db.insert(heartbeatRuns).values([
      { id: failedId, spaceId, agentId: workerId, status: "failed", contextSnapshot: { issueId, prompt: "x".repeat(32_000) } },
      { id: timedOutId, spaceId, agentId: workerId, status: "timed_out", contextSnapshot: { taskId, prompt: "y".repeat(32_000) } },
      { id: succeededId, spaceId, agentId: workerId, status: "succeeded" },
      { id: terminatedId, spaceId, agentId: reviewerId, status: "failed" },
      { id: foreignId, spaceId: other.spaceId, agentId: other.workerId, status: "failed" },
      { id: noReceiptId, spaceId, agentId: workerId, status: "failed" },
    ].map((run) => ({ ...run, createdAt, updatedAt: createdAt, finishedAt: createdAt })));
    for (let batch = 0; batch < 5; batch += 1) {
      await db.insert(heartbeatRunEvents).values(Array.from({ length: 500 }, (_, index) => ({
        spaceId, agentId: workerId, runId: failedId, seq: batch * 500 + index + 1,
        eventType: "lifecycle", message: `Bounded retry exhausted receipt ${batch * 500 + index + 1}`,
      })));
    }
    await db.insert(heartbeatRunEvents).values([
      { spaceId, agentId: workerId, runId: timedOutId, seq: 1, eventType: "lifecycle", message: "Bounded retry exhausted timeout" },
      { spaceId, agentId: workerId, runId: succeededId, seq: 1, eventType: "lifecycle", message: "Bounded retry exhausted success" },
      { spaceId, agentId: reviewerId, runId: terminatedId, seq: 1, eventType: "lifecycle", message: "Bounded retry exhausted terminated" },
      { spaceId: other.spaceId, agentId: other.workerId, runId: foreignId, seq: 1, eventType: "lifecycle", message: "Bounded retry exhausted other space" },
      // A newer event must not replace the latest matching, space-scoped receipt.
      { spaceId: other.spaceId, agentId: other.workerId, runId: failedId, seq: 2501, eventType: "lifecycle", message: "Bounded retry exhausted foreign receipt" },
      { spaceId, agentId: workerId, runId: failedId, seq: 2502, eventType: "stdout", message: "Bounded retry exhausted quoted output" },
      { spaceId, agentId: workerId, runId: failedId, seq: 2503, eventType: "lifecycle", message: "Unrelated lifecycle event" },
    ]);

    // Assert the database result itself: JavaScript feed deduplication used to
    // hide the thousands of full run contexts already loaded into memory.
    const rows = await listAttentionExhaustedRuns(db, spaceId);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === failedId)).toMatchObject({
      exhaustionMessage: "Bounded retry exhausted receipt 2500",
      contextSnapshot: { issueId, taskId: null },
    });
    expect(rows.find((row) => row.id === timedOutId)?.contextSnapshot).toEqual({ issueId: null, taskId });
    expect(Buffer.byteLength(JSON.stringify(rows))).toBeLessThan(4096);

    const feed = await attentionService(db).list(spaceId, {
      includeDismissed: true, all: true, allowUnscopedAll: true,
    });
    const failures = feed.items.filter((item) => item.sourceKind === "failed_run");
    expect(failures.map((item) => item.subject.id).sort()).toEqual([failedId, timedOutId].sort());
    expect(failures.find((item) => item.subject.id === timedOutId)?.relatedIssue?.id).toBe(taskId);
  });

  it("orders exhausted runs and reads receipts through the partial index", async () => {
    const { spaceId, workerId } = await seedSpace("IDX");
    const [olderId, tiedLowId, tiedHighId] = Array.from({ length: 3 }, () => randomUUID());
    const older = new Date("2026-07-09T11:00:00.000Z");
    const tied = new Date("2026-07-09T12:00:00.000Z");
    await db.insert(heartbeatRuns).values([
      { id: olderId, spaceId, agentId: workerId, status: "failed", createdAt: older, updatedAt: older },
      { id: tiedLowId, spaceId, agentId: workerId, status: "timed_out", createdAt: tied, updatedAt: tied },
      { id: tiedHighId, spaceId, agentId: workerId, status: "failed", createdAt: tied, updatedAt: tied },
    ]);
    // Insert order sets event ids: a tie on created_at falls back to the newest receipt.
    const receipts = [
      [tiedHighId, "Bounded retry exhausted first"],
      [olderId, "Bounded retry exhausted older"],
      [tiedLowId, "Bounded retry exhausted tied low"],
      [tiedHighId, "Bounded retry exhausted tied high"],
    ] as const;
    for (const [index, [runId, message]] of receipts.entries()) {
      await db.insert(heartbeatRunEvents).values({
        spaceId, agentId: workerId, runId, seq: index + 1, eventType: "lifecycle", message,
      });
    }

    const rows = await listAttentionExhaustedRuns(db, spaceId);
    expect(rows.map((row) => [row.id, row.exhaustionMessage])).toEqual([
      [tiedHighId, "Bounded retry exhausted tied high"],
      [tiedLowId, "Bounded retry exhausted tied low"],
      [olderId, "Bounded retry exhausted older"],
    ]);

    // The partial index predicate must stay implied by the query predicate;
    // otherwise the scan silently falls back to reading all space events.
    // Check a forced generic plan too: prepared statements reuse it, and only
    // literal predicates (not bound parameters) let it use a partial index.
    const query = listAttentionExhaustedRuns(db, spaceId).toSQL();
    const literal = (value: unknown) => `'${String(value).replaceAll("'", "''")}'`;
    const plans = await db.$client.begin(async (tx) => {
      await tx.unsafe("SET LOCAL enable_seqscan = off");
      const fresh = await tx.unsafe(`EXPLAIN (FORMAT JSON) ${query.sql}`, query.params as never[]);
      await tx.unsafe("SET LOCAL plan_cache_mode = force_generic_plan");
      await tx.unsafe(`PREPARE attention_exhausted_runs AS ${query.sql}`);
      const generic = await tx.unsafe(
        `EXPLAIN (FORMAT JSON) EXECUTE attention_exhausted_runs(${query.params.map(literal).join(", ")})`,
      );
      await tx.unsafe("DEALLOCATE attention_exhausted_runs");
      return { fresh, generic };
    });
    expect(JSON.stringify(plans.fresh)).toContain("heartbeat_run_events_retry_exhausted_idx");
    expect(JSON.stringify(plans.generic)).toContain("heartbeat_run_events_retry_exhausted_idx");
  });

  it("keeps SQL statement text saved by older failed runs out of the attention inbox", async () => {
    const { spaceId, workerId } = await seedSpace("ATQ");
    const issueId = await insertIssue({ spaceId, identifier: "ATQ-1", title: "Failed with a query", status: "in_progress" });
    const failedRunId = randomUUID();
    const failedAt = new Date("2026-07-09T12:00:00.000Z");
    await db.insert(heartbeatRuns).values({
      id: failedRunId, spaceId, agentId: workerId, invocationSource: "automation", status: "failed",
      errorCode: "adapter_failed",
      error: 'Usage write failed: Failed query: update "heartbeat_runs" set "usage_json" = $1\nparams: {"apiKey":"sk-secret"}',
      contextSnapshot: { issueId }, createdAt: failedAt, updatedAt: failedAt, finishedAt: failedAt,
    });
    await db.insert(heartbeatRunEvents).values({
      spaceId, runId: failedRunId, agentId: workerId, seq: 1, eventType: "lifecycle",
      message: "Bounded retry exhausted after 4 scheduled attempts; no further automatic retry will be queued",
      createdAt: new Date("2026-07-09T12:00:01.000Z"),
    });

    const feed = await attentionService(db).list(spaceId, { userId: "operator-user" });
    const item = feed.items.find((entry) => entry.sourceKind === "failed_run" && entry.subject.id === failedRunId);
    expect(item?.detail).toMatchObject({ failureReasonExcerpt: "Usage write failed: Database query failed" });
    expect(item?.subject.metadata?.error).toBe("Usage write failed: Database query failed");
    expect(JSON.stringify(item)).not.toMatch(/heartbeat_runs|sk-secret|params/);
  });

  it("suppresses failed-run attention after a newer run for the same issue", async () => {
    const { spaceId, workerId } = await seedSpace("ATN");
    const issueId = await insertIssue({
      spaceId,
      identifier: "ATN-1",
      title: "Recoverable task",
      status: "in_progress",
    });
    const failedRunId = randomUUID();
    const failedAt = new Date("2026-07-09T12:00:00.000Z");

    await db.insert(heartbeatRuns).values([
      {
        id: failedRunId,
        spaceId,
        agentId: workerId,
        invocationSource: "automation",
        status: "failed",
        error: "adapter failed",
        contextSnapshot: { issueId },
        createdAt: failedAt,
        updatedAt: failedAt,
        finishedAt: failedAt,
      },
      {
        id: randomUUID(),
        spaceId,
        agentId: workerId,
        invocationSource: "automation",
        status: "succeeded",
        contextSnapshot: { issueId },
        createdAt: new Date("2026-07-09T12:01:00.000Z"),
        updatedAt: new Date("2026-07-09T12:01:00.000Z"),
        finishedAt: new Date("2026-07-09T12:01:00.000Z"),
      },
    ]);
    await db.insert(heartbeatRunEvents).values({
      spaceId,
      runId: failedRunId,
      agentId: workerId,
      seq: 1,
      eventType: "lifecycle",
      message: "Bounded retry exhausted after 4 scheduled attempts; no further automatic retry will be queued",
      createdAt: new Date("2026-07-09T12:00:01.000Z"),
    });

    const feed = await attentionService(db).list(spaceId, { userId: "operator-user" });

    expect(feed.items.filter((item) => item.sourceKind === "failed_run")).toEqual([]);
  });

  it("hides a failed run only after a newer run of the same agent on the same issue or task", async () => {
    const { spaceId, workerId, reviewerId } = await seedSpace("ATK");
    const taskIssueId = await insertIssue({ spaceId, identifier: "ATK-1", title: "Task-keyed", status: "in_progress" });
    const issueKeyedId = await insertIssue({ spaceId, identifier: "ATK-2", title: "Issue-keyed", status: "in_progress" });
    const otherIssueId = await insertIssue({ spaceId, identifier: "ATK-3", title: "Other work", status: "in_progress" });
    const failedAt = new Date("2026-07-09T12:00:00.000Z");
    const laterAt = new Date("2026-07-09T12:01:00.000Z");
    const taskKeyedFailureId = randomUUID();
    const issueKeyedFailureId = randomUUID();
    const unkeyedHiddenFailureId = randomUUID();
    const unkeyedKeptFailureId = randomUUID();
    const failureIds = [taskKeyedFailureId, issueKeyedFailureId, unkeyedHiddenFailureId, unkeyedKeptFailureId];
    const sameMillisecondRunId = randomUUID();
    const run = (id: string, agentId: string, status: string, contextSnapshot: Record<string, unknown>, at: Date) => ({
      id, spaceId, agentId, invocationSource: "automation", status, contextSnapshot,
      createdAt: at, updatedAt: at, finishedAt: at, ...(status === "failed" ? { error: "adapter failed" } : {}),
    });

    await db.insert(heartbeatRuns).values([
      run(taskKeyedFailureId, workerId, "failed", { taskId: taskIssueId }, failedAt),
      run(issueKeyedFailureId, workerId, "failed", { issueId: issueKeyedId }, failedAt),
      run(unkeyedHiddenFailureId, workerId, "failed", {}, failedAt),
      run(unkeyedKeptFailureId, reviewerId, "failed", {}, failedAt),
      run(randomUUID(), workerId, "succeeded", { taskId: taskIssueId }, laterAt),
      run(randomUUID(), workerId, "succeeded", { wakeReason: "timer" }, laterAt),
      run(randomUUID(), reviewerId, "succeeded", { issueId: issueKeyedId }, laterAt),
      run(randomUUID(), reviewerId, "succeeded", { issueId: otherIssueId }, laterAt),
      run(randomUUID(), workerId, "succeeded", { issueId: otherIssueId }, laterAt),
      run(randomUUID(), workerId, "succeeded", { issueId: otherIssueId, taskId: issueKeyedId }, laterAt),
      run(randomUUID(), workerId, "succeeded", { issueId: "", taskId: issueKeyedId }, laterAt),
      run(sameMillisecondRunId, workerId, "succeeded", { issueId: issueKeyedId }, failedAt),
      run(randomUUID(), workerId, "succeeded", { issueId: issueKeyedId }, new Date("2026-07-09T11:59:00.000Z")),
    ]);
    await db.execute(sql`update heartbeat_runs set created_at = created_at + interval '400 microseconds'
      where id in (${sql.join(failureIds.map((id) => sql`${id}::uuid`), sql`, `)})`);
    await db.execute(sql`update heartbeat_runs set created_at = created_at + interval '600 microseconds'
      where id = ${sameMillisecondRunId}::uuid`);
    await db.insert(heartbeatRunEvents).values(
      failureIds.map((runId) => ({
        spaceId,
        runId,
        agentId: runId === unkeyedKeptFailureId ? reviewerId : workerId,
        seq: 1,
        eventType: "lifecycle",
        message: "Bounded retry exhausted after 4 scheduled attempts; no further automatic retry will be queued",
        createdAt: new Date("2026-07-09T12:00:01.000Z"),
      })),
    );

    const feed = await attentionService(db).list(spaceId, { userId: "operator-user" });

    expect(feed.items.filter((item) => item.sourceKind === "failed_run").map((item) => item.subject.id).sort())
      .toEqual([issueKeyedFailureId, unkeyedKeptFailureId].sort());
  });

  it("keeps newer-run response size bounded despite unrelated retained history", async () => {
    const { spaceId, workerId } = await seedSpace("ATW");
    const issueId = await insertIssue({ spaceId, identifier: "ATW-1", title: "Exhausted task", status: "in_progress" });
    const otherIssueId = await insertIssue({ spaceId, identifier: "ATW-2", title: "Other task", status: "done" });
    const failedId = randomUUID(), failedAt = new Date("2026-07-09T12:00:00.000Z");
    await db.insert(heartbeatRuns).values({
      id: failedId, spaceId, agentId: workerId, status: "failed", contextSnapshot: { issueId },
      createdAt: failedAt, updatedAt: failedAt, finishedAt: failedAt,
    });
    await db.insert(heartbeatRunEvents).values({
      spaceId, agentId: workerId, runId: failedId, seq: 1, eventType: "lifecycle",
      message: "Bounded retry exhausted after scheduled attempts",
    });
    for (let batch = 0; batch < 4; batch += 1) {
      await db.insert(heartbeatRuns).values(Array.from({ length: 500 }, (_, index) => ({
        id: randomUUID(), spaceId, agentId: workerId, status: "succeeded",
        contextSnapshot: { issueId: otherIssueId, prompt: "x".repeat(8_000) },
        createdAt: new Date(failedAt.getTime() + batch * 500 + index + 1),
        updatedAt: failedAt, finishedAt: failedAt,
      })));
    }
    const events: Array<Record<string, unknown>> = [], now = Date.now();
    const capture = createFullDatabaseResponseCapture({ start: now - 100, end: now + 59_000 }, event => events.push(event));
    installDatabaseResponseCapture(db, { heartbeatRuns }, capture);
    try {
      const feed = await attentionService(db).list(spaceId, { userId: "operator-user" });
      expect(feed.items.filter(item => item.sourceKind === "failed_run").map(item => item.subject.id)).toEqual([failedId]);
    } finally { capture.flush(); }
    const reads = events.filter(event => event.event === "outpost.test_db_response_capture.entry.v1"
      && event.table === "heartbeat_runs" && (event.operation === "select" || event.operation === "execute"));
    expect(reads.reduce((sum, event) => sum + Number(event.calls), 0)).toBeGreaterThan(0);
    expect(reads.reduce((sum, event) => sum + Number(event.rows), 0)).toBeLessThan(64);
    expect(reads.reduce((sum, event) => sum + Number(event.responseValueBytes), 0)).toBeLessThan(4096);
    expect(reads.filter(event => event.operation === "execute")
      .reduce((sum, event) => sum + Number(event.calls), 0)).toBeGreaterThan(0);
    const [remaining] = await db.select({ count: sql<number>`count(*)::int` }).from(heartbeatRuns)
      .where(eq(heartbeatRuns.spaceId, spaceId));
    expect(remaining?.count).toBe(2001);
  });

  it("reads keyless history once per agent despite thousands of failures", async () => {
    const { spaceId, workerId, reviewerId } = await seedSpace("ATB");
    const failedAt = new Date("2026-07-09T12:00:00.000Z");
    const laterAt = new Date("2026-07-09T12:01:00.000Z");
    const hiddenIds = Array.from({ length: 16_390 }, () => randomUUID());
    const keptIds = Array.from({ length: 10 }, () => randomUUID());
    const failure = (id: string, agentId: string) => ({
      id, spaceId, agentId, invocationSource: "automation", status: "failed", error: "adapter failed",
      contextSnapshot: {}, createdAt: failedAt, updatedAt: failedAt, finishedAt: failedAt,
    });
    const failures = hiddenIds.map((id) => failure(id, workerId));
    keptIds.forEach((id, index) => failures.splice(index * 1_700, 0, failure(id, reviewerId)));
    for (let start = 0; start < failures.length; start += 1_000) {
      const chunk = failures.slice(start, start + 1_000);
      await db.insert(heartbeatRuns).values(chunk);
      await db.insert(heartbeatRunEvents).values(chunk.map((run) => ({
        spaceId, runId: run.id, agentId: run.agentId, seq: 1, eventType: "lifecycle",
        message: "Bounded retry exhausted after 4 scheduled attempts; no further automatic retry will be queued",
        createdAt: new Date("2026-07-09T12:00:01.000Z"),
      })));
    }
    await db.insert(heartbeatRuns).values({
      id: randomUUID(), spaceId, agentId: workerId, invocationSource: "automation", status: "succeeded",
      contextSnapshot: { wakeReason: "timer" }, createdAt: laterAt, updatedAt: laterAt, finishedAt: laterAt,
    });

    // Bulk-loaded fixtures need planner statistics before exercising production queries.
    await db.execute(sql`ANALYZE heartbeat_runs, heartbeat_run_events`);

    const events: Array<Record<string, unknown>> = [], now = Date.now();
    const capture = createFullDatabaseResponseCapture({ start: now - 100, end: now + 59_000 }, event => events.push(event));
    installDatabaseResponseCapture(db, { heartbeatRuns }, capture);
    try {
      const feed = await attentionService(db).list(spaceId, {
        includeDismissed: true, all: true, allowUnscopedAll: true,
      });
      expect(feed.items.filter((item) => item.sourceKind === "failed_run").map((item) => item.subject.id).sort())
        .toEqual([...keptIds].sort());
    } finally { capture.flush(); }
    const reads = events.filter(event => event.event === "outpost.test_db_response_capture.entry.v1"
      && event.table === "heartbeat_runs" && (event.operation === "select" || event.operation === "execute"));
    expect(reads.reduce((sum, event) => sum + Number(event.calls), 0)).toBeGreaterThan(0);
    expect(reads.reduce((sum, event) => sum + Number(event.calls), 0)).toBeLessThan(4);
  }, 180_000);

  it("checks more failed runs for a newer run than one statement can bind", async () => {
    const { spaceId, workerId, reviewerId } = await seedSpace("ATQ");
    const issueId = await insertIssue({ spaceId, identifier: "ATQ-1", title: "Keyed retained failures", status: "in_progress" });
    const failedAt = new Date("2026-07-09T12:00:00.000Z");
    const laterAt = new Date("2026-07-09T12:01:00.000Z");
    const hiddenIds = Array.from({ length: 16_390 }, () => randomUUID());
    const keptIds = Array.from({ length: 10 }, () => randomUUID());
    const failure = (id: string, agentId: string) => ({
      id, spaceId, agentId, invocationSource: "automation", status: "failed", error: "adapter failed",
      contextSnapshot: { issueId }, createdAt: failedAt, updatedAt: failedAt, finishedAt: failedAt,
    });
    const failures = hiddenIds.map((id) => failure(id, workerId));
    keptIds.forEach((id, index) => failures.splice(index * 1_700, 0, failure(id, reviewerId)));
    for (let start = 0; start < failures.length; start += 1_000) {
      const chunk = failures.slice(start, start + 1_000);
      await db.insert(heartbeatRuns).values(chunk);
      await db.insert(heartbeatRunEvents).values(chunk.map((run) => ({
        spaceId, runId: run.id, agentId: run.agentId, seq: 1, eventType: "lifecycle",
        message: "Bounded retry exhausted after 4 scheduled attempts; no further automatic retry will be queued",
        createdAt: new Date("2026-07-09T12:00:01.000Z"),
      })));
    }
    await db.insert(heartbeatRuns).values({
      id: randomUUID(), spaceId, agentId: workerId, invocationSource: "automation", status: "succeeded",
      contextSnapshot: { issueId }, createdAt: laterAt, updatedAt: laterAt, finishedAt: laterAt,
    });

    // Do not race autovacuum to collect statistics for the 16,400 new rows.
    await db.execute(sql`ANALYZE heartbeat_runs, heartbeat_run_events`);

    const feed = await attentionService(db).list(spaceId, {
      includeDismissed: true, all: true, allowUnscopedAll: true,
    });
    expect(feed.items.filter(item => item.sourceKind === "failed_run").map(item => item.subject.id).sort())
      .toEqual([...keptIds].sort());
  }, 180_000);

  it("enriches interaction details with project, workspace, plan metadata, and images", async () => {
    const { spaceId, workerId } = await seedSpace("ATE");
    const projectId = randomUUID();
    const workspaceId = randomUUID();
    const issueId = randomUUID();
    const planDocumentId = randomUUID();
    const planRevisionId = randomUUID();
    const imageAssetIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];

    await db.insert(projects).values({
      id: projectId,
      spaceId,
      name: "Attention Project",
      status: "in_progress",
      color: "#0f766e",
      icon: "rocket",
    });
    await db.insert(projectWorkspaces).values({
      id: workspaceId,
      spaceId,
      projectId,
      name: "Preview workspace",
      sourceType: "local_path",
      isPrimary: true,
    });
    await insertIssue({
      id: issueId,
      spaceId,
      identifier: "ATE-1",
      title: "Approve launch plan",
      status: "in_progress",
      assigneeAgentId: workerId,
      projectId,
      projectWorkspaceId: workspaceId,
      updatedAt: new Date("2026-07-09T12:00:00.000Z"),
    });
    await db.insert(documents).values({
      id: planDocumentId,
      spaceId,
      title: "Launch Plan",
      format: "markdown",
      latestBody: "# Summary\n\nThis plan explains the launch checklist, rollout owner, QA gates, and risk controls for the homepage release.",
      latestRevisionId: planRevisionId,
      latestRevisionNumber: 2,
    });
    await db.insert(issueDocuments).values({
      spaceId,
      issueId,
      documentId: planDocumentId,
      key: "plan",
    });
    await db.insert(assets).values([
      { id: imageAssetIds[0], spaceId, provider: "local_disk", objectKey: "img-1", contentType: "image/png", byteSize: 10, sha256: "a".repeat(64), originalFilename: "one.png" },
      { id: imageAssetIds[1], spaceId, provider: "local_disk", objectKey: "img-2", contentType: "image/jpeg", byteSize: 10, sha256: "b".repeat(64), originalFilename: "two.jpg" },
      { id: imageAssetIds[2], spaceId, provider: "local_disk", objectKey: "img-3", contentType: "image/gif", byteSize: 10, sha256: "c".repeat(64), originalFilename: "three.gif" },
      { id: imageAssetIds[3], spaceId, provider: "local_disk", objectKey: "img-4", contentType: "image/png", byteSize: 10, sha256: "d".repeat(64), originalFilename: "four.png" },
    ]);
    await db.insert(issueAttachments).values(imageAssetIds.map((assetId, index) => ({
      spaceId,
      issueId,
      assetId,
      createdAt: new Date(`2026-07-09T12:0${index}:30.000Z`),
      updatedAt: new Date(`2026-07-09T12:0${index}:30.000Z`),
    })));

    const planInteractionId = randomUUID();
    const questionsInteractionId = randomUUID();
    const tasksInteractionId = randomUUID();
    const checkboxInteractionId = randomUUID();
    const verdictInteractionId = randomUUID();
    await db.insert(issueThreadInteractions).values([
      {
        id: planInteractionId,
        spaceId,
        issueId,
        kind: "request_confirmation",
        status: "pending",
        continuationPolicy: "wake_assignee",
        title: "Approve the plan",
        payload: {
          version: 1,
          prompt: "Approve plan?",
          acceptLabel: "Approve plan",
          rejectLabel: "Request changes",
          target: { type: "issue_document", issueId, key: "plan", revisionId: planRevisionId },
        },
        createdAt: new Date("2026-07-09T12:01:00.000Z"),
        updatedAt: new Date("2026-07-09T12:01:00.000Z"),
      },
      {
        id: questionsInteractionId,
        spaceId,
        issueId,
        kind: "ask_user_questions",
        status: "pending",
        continuationPolicy: "wake_assignee",
        title: "Questions",
        payload: {
          version: 1,
          questions: [
            { id: "q1", prompt: "Which auth provider should we use?", selectionMode: "single", options: [] },
            { id: "q2", prompt: "Should we add a fallback?", selectionMode: "single", options: [] },
          ],
        },
        createdAt: new Date("2026-07-09T12:02:00.000Z"),
        updatedAt: new Date("2026-07-09T12:02:00.000Z"),
      },
      {
        id: tasksInteractionId,
        spaceId,
        issueId,
        kind: "suggest_tasks",
        status: "pending",
        continuationPolicy: "wake_assignee",
        title: "Tasks",
        payload: { version: 1, tasks: [{ clientKey: "t1", title: "Build API" }, { clientKey: "t2", title: "Wire UI" }] },
        createdAt: new Date("2026-07-09T12:03:00.000Z"),
        updatedAt: new Date("2026-07-09T12:03:00.000Z"),
      },
      {
        id: checkboxInteractionId,
        spaceId,
        issueId,
        kind: "request_checkbox_confirmation",
        status: "pending",
        continuationPolicy: "wake_assignee",
        title: "Checkbox",
        payload: { version: 1, prompt: "Select rollout regions", options: [{ id: "us", label: "US" }, { id: "eu", label: "EU" }] },
        createdAt: new Date("2026-07-09T12:04:00.000Z"),
        updatedAt: new Date("2026-07-09T12:04:00.000Z"),
      },
      {
        id: verdictInteractionId,
        spaceId,
        issueId,
        kind: "request_item_verdicts",
        status: "pending",
        continuationPolicy: "wake_assignee",
        title: "Verdicts",
        payload: { version: 1, prompt: "Approve these screenshots", items: [{ id: "one", label: "One" }, { id: "two", label: "Two" }] },
        createdAt: new Date("2026-07-09T12:05:00.000Z"),
        updatedAt: new Date("2026-07-09T12:05:00.000Z"),
      },
    ]);

    const feed = await attentionService(db).list(spaceId, { userId: "operator-user" });
    const interactionItems = feed.items.filter((item) => item.sourceKind === "issue_thread_interaction");
    const detailsByKind = new Map(interactionItems.map((item) => [item.detail?.kind, item]));
    const summaryEvents: Array<Record<string, unknown>> = [], captureNow = Date.now();
    const summaryCapture = createFullDatabaseResponseCapture({ start: captureNow - 100, end: captureNow + 59_000 }, event => summaryEvents.push(event));
    installDatabaseResponseCapture(db, { documents, assets, issueAttachments }, summaryCapture);
    try {
      const summary = await attentionService(db).summary(spaceId, { userId: "operator-user" });
      expect(summary.countsBySourceKind).toEqual(feed.countsBySourceKind);
      expect(summary.totalCount).toBe(feed.totalCount);
      const index = await attentionService(db).taskIndex(spaceId, { userId: "operator-user" });
      expect(index.taskIds).toEqual([...new Set(feed.items.flatMap(item => item.relatedIssue ? [item.relatedIssue.id] : item.subject.kind === "issue" ? [item.subject.id] : []))]);
      expect(index.totalCount).toBe(feed.totalCount);

    } finally { summaryCapture.flush(); }
    const cardReads = summaryEvents.filter(event => event.event === "outpost.test_db_response_capture.entry.v1"
      && ["documents", "assets", "issue_attachments"].includes(String(event.table)));
    expect(cardReads).toEqual([]);


    const planItem = detailsByKind.get("plan_approval");
    expect(planItem?.subject.title).toBe("Plan approval - Approve launch plan");
    expect(planItem?.subject.metadata).toMatchObject({ isPlanTarget: true, targetDocumentKey: "plan" });
    expect(planItem?.decisionVerbs).toEqual([
      expect.objectContaining({ id: "accept", label: "Approve plan" }),
      expect.objectContaining({ id: "reject", label: "Request changes" }),
    ]);
    expect(planItem?.project).toMatchObject({
      id: projectId,
      name: "Attention Project",
      color: "#0f766e",
      icon: "rocket",
    });
    expect(planItem?.project?.urlKey).toEqual(expect.any(String));
    expect(planItem?.workspace).toEqual({ id: workspaceId, name: "Preview workspace" });
    expect(planItem?.detail).toMatchObject({
      kind: "plan_approval",
      issueTitle: "Approve launch plan",
      planTitle: "Launch Plan",
      summaryExcerpt: expect.stringContaining("launch checklist"),
      images: imageAssetIds.slice(0, 3).map((assetId) => ({ assetId, alt: expect.any(String) })),
    });
    expect(detailsByKind.get("questions")?.detail).toMatchObject({
      kind: "questions",
      questionCount: 2,
      firstQuestionText: "Which auth provider should we use?",
    });
    expect(detailsByKind.get("suggested_tasks")?.detail).toMatchObject({
      kind: "suggested_tasks",
      taskCount: 2,
      firstTaskTitle: "Build API",
    });
    expect(detailsByKind.get("checkbox_confirmation")?.detail).toMatchObject({
      kind: "checkbox_confirmation",
      optionCount: 2,
      promptExcerpt: "Select rollout regions",
    });
    expect(detailsByKind.get("item_verdicts")?.detail).toMatchObject({
      kind: "item_verdicts",
      itemCount: 2,
      promptExcerpt: "Approve these screenshots",
    });
  });

  it("shows only the newest pending confirmation per issue and kind", async () => {
    const { spaceId, workerId, reviewerId } = await seedSpace("ATC");
    const issueId = await insertIssue({
      spaceId,
      identifier: "ATC-1",
      title: "Repeated sign-offs",
      status: "in_review",
      assigneeAgentId: workerId,
    });
    const olderConfirmationId = randomUUID();
    const newerConfirmationId = randomUUID();
    const checkboxId = randomUUID();
    await db.insert(issueThreadInteractions).values([
      {
        id: olderConfirmationId,
        spaceId,
        issueId,
        kind: "request_confirmation",
        status: "pending",
        continuationPolicy: "wake_assignee",
        createdByAgentId: workerId,
        title: "Approve V1",
        payload: { version: 1, prompt: "Approve V1?" },
        createdAt: new Date("2026-07-09T12:00:00.000Z"),
        updatedAt: new Date("2026-07-09T12:10:00.000Z"),
      },
      {
        id: newerConfirmationId,
        spaceId,
        issueId,
        kind: "request_confirmation",
        status: "pending",
        continuationPolicy: "wake_assignee",
        createdByAgentId: reviewerId,
        title: "Approve V2",
        payload: { version: 1, prompt: "Approve V2?" },
        createdAt: new Date("2026-07-09T12:05:00.000Z"),
        updatedAt: new Date("2026-07-09T12:05:00.000Z"),
      },
      {
        id: checkboxId,
        spaceId,
        issueId,
        kind: "request_checkbox_confirmation",
        status: "pending",
        continuationPolicy: "wake_assignee",
        createdByAgentId: workerId,
        title: "Select rollout",
        payload: { version: 1, prompt: "Select rollout", options: [{ id: "one", label: "One" }] },
        createdAt: new Date("2026-07-09T12:01:00.000Z"),
        updatedAt: new Date("2026-07-09T12:01:00.000Z"),
      },
    ]);

    const feed = await attentionService(db).list(spaceId, { userId: "operator-user" });
    const interactionIds = feed.items
      .filter((item) => item.sourceKind === "issue_thread_interaction")
      .map((item) => item.subject.id);

    expect(interactionIds).toContain(newerConfirmationId);
    expect(interactionIds).toContain(checkboxId);
    expect(interactionIds).not.toContain(olderConfirmationId);
  });

  it.each([
    ["approved from chat", "accept", "ATR"],
    ["rejected from chat", "reject", "ATJ"],
    ["expired", "expire", "ATX"],
  ] as const)("does not resurface an older confirmation once the newest one is %s", async (_label, outcome, prefix) => {
    // Same-agent re-asks are expired at creation; a second agent (for example
    // the chat agent) asking on the same task leaves the older card pending.
    const { spaceId, workerId, reviewerId } = await seedSpace(prefix);
    const issueId = await insertIssue({
      spaceId,
      identifier: `${prefix}-1`,
      title: "Re-asked sign-off",
      status: "in_review",
      assigneeAgentId: workerId,
    });
    const olderConfirmationId = randomUUID();
    const newerConfirmationId = randomUUID();
    await db.insert(issueThreadInteractions).values([
      {
        id: olderConfirmationId,
        spaceId,
        issueId,
        kind: "request_confirmation",
        status: "pending",
        continuationPolicy: "none",
        createdByAgentId: workerId,
        title: "Approve the plan",
        payload: { version: 1, prompt: "Approve the plan?" },
        createdAt: new Date("2026-11-05T12:00:00.000Z"),
        updatedAt: new Date("2026-11-05T12:00:00.000Z"),
      },
      {
        id: newerConfirmationId,
        spaceId,
        issueId,
        kind: "request_confirmation",
        status: "pending",
        continuationPolicy: "none",
        createdByAgentId: reviewerId,
        title: "Approve the plan (again)",
        payload: { version: 1, prompt: "Approve the plan?" },
        createdAt: new Date("2026-11-05T12:05:00.000Z"),
        updatedAt: new Date("2026-11-05T12:05:00.000Z"),
      },
    ]);

    const pendingIds = async () => (await attentionService(db).list(spaceId, { userId: "operator-user" })).items
      .filter((item) => item.sourceKind === "issue_thread_interaction")
      .map((item) => item.subject.id);
    expect(await pendingIds()).toEqual([newerConfirmationId]);

    if (outcome === "accept") {
      // The chat card resolves the same canonical record through the same service.
      await issueThreadInteractionService(db).acceptInteraction(
        { id: issueId, spaceId, projectId: null, goalId: null, status: "in_review" },
        newerConfirmationId,
        {},
        { userId: "operator-user" },
      );
    } else if (outcome === "reject") {
      await issueThreadInteractionService(db).rejectInteraction(
        { id: issueId, spaceId, status: "in_review" },
        newerConfirmationId,
        { reason: "Not this plan" },
        { userId: "operator-user" },
      );
    } else {
      await db.update(issueThreadInteractions).set({
        status: "expired",
        result: { version: 1, outcome: "stale_target" },
        resolvedAt: new Date("2026-11-05T12:10:00.000Z"),
        updatedAt: new Date("2026-11-05T12:10:00.000Z"),
      }).where(eq(issueThreadInteractions.id, newerConfirmationId));
    }

    expect(await pendingIds()).toEqual([]);
  });

  it("keeps a pending tool-action approval visible after a newer tool action is settled", async () => {
    const { spaceId, workerId } = await seedSpace("ATT");
    const issueId = await insertIssue({ spaceId, identifier: "ATT-1", title: "Two tool calls", status: "in_progress", assigneeAgentId: workerId });
    const olderId = randomUUID();
    const base = { spaceId, issueId, kind: "request_confirmation", continuationPolicy: "none", createdByAgentId: workerId, title: "Approve tool action" };
    await db.insert(issueThreadInteractions).values([
      { ...base, id: olderId, status: "pending", payload: { version: 1, prompt: "Run A?", toolAction: { actionRequestId: randomUUID() } },
        createdAt: new Date("2026-11-05T12:00:00.000Z"), updatedAt: new Date("2026-11-05T12:00:00.000Z") },
      { ...base, id: randomUUID(), status: "accepted", payload: { version: 1, prompt: "Run B?", toolAction: { actionRequestId: randomUUID() } },
        createdAt: new Date("2026-11-05T12:05:00.000Z"), updatedAt: new Date("2026-11-05T12:06:00.000Z"), resolvedAt: new Date("2026-11-05T12:06:00.000Z") },
    ] as typeof issueThreadInteractions.$inferInsert[]);
    const feed = await attentionService(db).list(spaceId, { userId: "operator-user" });
    expect(feed.items.filter((item) => item.sourceKind === "issue_thread_interaction").map((item) => item.subject.id)).toEqual([olderId]);
  });

  it("shows a genuine re-ask created after the newest confirmation was settled", async () => {
    const { spaceId, workerId, reviewerId } = await seedSpace("ATN");
    const issueId = await insertIssue({ spaceId, identifier: "ATN-1", title: "Follow-up sign-off", status: "in_review", assigneeAgentId: workerId });
    const reAskId = randomUUID();
    const base = { spaceId, issueId, kind: "request_confirmation", continuationPolicy: "none", payload: { version: 1, prompt: "Approve?" } };
    await db.insert(issueThreadInteractions).values([
      { ...base, id: randomUUID(), status: "accepted", createdByAgentId: reviewerId, title: "First sign-off",
        createdAt: new Date("2026-11-05T12:00:00.000Z"), updatedAt: new Date("2026-11-05T12:01:00.000Z"), resolvedAt: new Date("2026-11-05T12:01:00.000Z") },
      { ...base, id: reAskId, status: "pending", createdByAgentId: workerId, title: "Second sign-off",
        createdAt: new Date("2026-11-05T12:05:00.000Z"), updatedAt: new Date("2026-11-05T12:05:00.000Z") },
    ] as typeof issueThreadInteractions.$inferInsert[]);
    const feed = await attentionService(db).list(spaceId, { userId: "operator-user" });
    expect(feed.items.filter((item) => item.sourceKind === "issue_thread_interaction").map((item) => item.subject.id)).toEqual([reAskId]);
  });

  it.each([
    ["secret proposal", "ATS", { secretProposal: { proposalId: "11111111-1111-4111-8111-111111111111" } }],
    ["app connection", "ATK", { connectionAuthorization: { connectionId: "22222222-2222-4222-8222-222222222222" } }],
  ] as const)("does not let a settled %s hide an older ordinary confirmation", async (_label, prefix, controlled) => {
    const { spaceId, workerId, reviewerId } = await seedSpace(prefix);
    const issueId = await insertIssue({ spaceId, identifier: `${prefix}-1`, title: "Controlled card then sign-off", status: "in_review", assigneeAgentId: workerId });
    const ordinaryId = randomUUID();
    const base = { spaceId, issueId, kind: "request_confirmation", continuationPolicy: "none" };
    await db.insert(issueThreadInteractions).values([
      { ...base, id: ordinaryId, status: "pending", createdByAgentId: workerId, title: "Approve the plan", payload: { version: 1, prompt: "Approve the plan?" },
        createdAt: new Date("2026-11-05T12:00:00.000Z"), updatedAt: new Date("2026-11-05T12:00:00.000Z") },
      { ...base, id: randomUUID(), status: "accepted", createdByAgentId: reviewerId, title: "Controlled action",
        payload: { version: 1, prompt: "Allow this?", ...controlled },
        createdAt: new Date("2026-11-05T12:05:00.000Z"), updatedAt: new Date("2026-11-05T12:06:00.000Z"), resolvedAt: new Date("2026-11-05T12:06:00.000Z") },
    ] as typeof issueThreadInteractions.$inferInsert[]);
    const service = attentionService(db);
    const feed = await service.list(spaceId, { userId: "operator-user" });
    expect(feed.items.filter((item) => item.sourceKind === "issue_thread_interaction").map((item) => item.subject.id)).toEqual([ordinaryId]);
    expect((await service.taskIndex(spaceId, { userId: "operator-user" })).taskIds).toContain(issueId);
  });

  it("keeps a pending tool-action approval in the summary and task index after a newer ordinary confirmation is settled", async () => {
    const { spaceId, workerId } = await seedSpace("ATU");
    const issueId = await insertIssue({ spaceId, identifier: "ATU-1", title: "Tool call then sign-off", status: "in_progress", assigneeAgentId: workerId });
    const toolApprovalId = randomUUID();
    const base = { spaceId, issueId, kind: "request_confirmation", continuationPolicy: "none", createdByAgentId: workerId };
    await db.insert(issueThreadInteractions).values([
      { ...base, id: toolApprovalId, status: "pending", title: "Approve tool action",
        payload: { version: 1, prompt: "Run A?", toolAction: { actionRequestId: randomUUID() } },
        createdAt: new Date("2026-11-05T12:00:00.000Z"), updatedAt: new Date("2026-11-05T12:00:00.000Z") },
      { ...base, id: randomUUID(), status: "accepted", title: "Approve the plan", payload: { version: 1, prompt: "Approve the plan?" },
        createdAt: new Date("2026-11-05T12:05:00.000Z"), updatedAt: new Date("2026-11-05T12:06:00.000Z"), resolvedAt: new Date("2026-11-05T12:06:00.000Z") },
    ] as typeof issueThreadInteractions.$inferInsert[]);
    const service = attentionService(db);
    const feed = await service.list(spaceId, { userId: "operator-user" });
    expect(feed.items.filter((item) => item.sourceKind === "issue_thread_interaction").map((item) => item.subject.id)).toEqual([toolApprovalId]);
    const [summary, index] = await Promise.all([service.summary(spaceId, { userId: "operator-user" }), service.taskIndex(spaceId, { userId: "operator-user" })]);
    expect(index.taskIds).toContain(issueId);
    expect(summary.totalCount).toBe(feed.totalCount);
  });

  it("does not let another recipient's settled confirmation hide this recipient's pending one", async () => {
    const { spaceId, workerId } = await seedSpace("ATV");
    const issueId = await insertIssue({ spaceId, identifier: "ATV-1", title: "Two reviewers", status: "in_review", assigneeAgentId: workerId });
    const mineId = randomUUID();
    const base = { spaceId, issueId, kind: "request_confirmation", continuationPolicy: "none", createdByAgentId: workerId, payload: { version: 1, prompt: "Approve?" } };
    await db.insert(issueThreadInteractions).values([
      { ...base, id: mineId, status: "pending", title: "Operator user sign-off", addresseeUserId: "operator-user",
        createdAt: new Date("2026-11-05T12:00:00.000Z"), updatedAt: new Date("2026-11-05T12:00:00.000Z") },
      { ...base, id: randomUUID(), status: "accepted", title: "Other user sign-off", addresseeUserId: "other-user",
        createdAt: new Date("2026-11-05T12:05:00.000Z"), updatedAt: new Date("2026-11-05T12:06:00.000Z"), resolvedAt: new Date("2026-11-05T12:06:00.000Z") },
    ] as typeof issueThreadInteractions.$inferInsert[]);
    const feed = await attentionService(db).list(spaceId, { userId: "operator-user" });
    expect(feed.items.filter((item) => item.sourceKind === "issue_thread_interaction").map((item) => item.subject.id)).toEqual([mineId]);
  });

  it("retains every independently bound quality approval alongside the newest ordinary confirmation", async () => {
    const { spaceId, workerId } = await seedSpace("ATQ");
    const issueId = await insertIssue({ spaceId, identifier: "ATQ-1", title: "Review copy and visual", status: "in_review", assigneeAgentId: workerId });
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    await db.insert(issueThreadInteractions).values(ids.map((id, index) => ({
      id, spaceId, issueId, kind: "request_confirmation" as const, status: "pending" as const, continuationPolicy: "wake_assignee" as const, createdByAgentId: workerId,
      payload: { version: 1 as const, prompt: "Approve output?", ...(index < 2 ? { qualityReview: { key: index === 0 ? "copy" : "visual", requirementHash: "a".repeat(64) } } : {}) },
      createdAt: new Date(Date.UTC(2026, 6, 9, 12, index)),
    })));
    const feed = await attentionService(db).list(spaceId, { userId: "operator-user" });
    const interactions = feed.items.filter(item => item.sourceKind === "issue_thread_interaction");
    expect(interactions.map(item => item.subject.id).sort()).toEqual([ids[0], ids[1], ids[3]].sort());
    const summary = await attentionService(db).summary(spaceId, { userId: "operator-user" });
    expect(summary.countsBySourceKind).toEqual(feed.countsBySourceKind);

    // Resolving one output removes only that decision, leaving the other output
    // and the ordinary confirmation independently actionable.
    await db.update(issueThreadInteractions).set({ status: "accepted", resolvedAt: new Date() }).where(eq(issueThreadInteractions.id, ids[0]));
    const remaining = await attentionService(db).list(spaceId, { userId: "operator-user" });
    expect(remaining.items.filter(item => item.sourceKind === "issue_thread_interaction").map(item => item.subject.id).sort()).toEqual([ids[1], ids[3]].sort());
  });

  it("uses inbox_dismissals with attention-prefixed dedup keys and resurfaces newer activity", async () => {
    const { spaceId } = await seedSpace("ATD");
    const approvalId = randomUUID();
    await db.insert(approvals).values({
      id: approvalId,
      spaceId,
      type: "create_agent",
      status: "pending",
      payload: { title: "Create Writer" },
      createdAt: new Date("2026-07-09T12:00:00.000Z"),
      updatedAt: new Date("2026-07-09T12:00:00.000Z"),
    });
    await db.insert(inboxDismissals).values({
      spaceId,
      userId: "operator-user",
      itemKey: `attention:approval:${approvalId}`,
      dismissedAt: new Date("2026-07-09T13:00:00.000Z"),
    });

    await expect(attentionService(db).list(spaceId, { userId: "operator-user" }))
      .resolves.toMatchObject({ totalCount: 1 }); // agent_error_alert from seed
    const includeDismissedFeed = await attentionService(db).list(spaceId, { userId: "operator-user", includeDismissed: true });
    expect(includeDismissedFeed.totalCount).toBe(2);
    expect(includeDismissedFeed.items.find((item) => item.dedupKey === `approval:${approvalId}`)?.dismissal)
      .toMatchObject({ kind: "dismiss", isActive: true, snoozedUntil: null });

    await db
      .update(approvals)
      .set({ updatedAt: new Date("2026-07-09T14:00:00.000Z") })
      .where(eq(approvals.id, approvalId));

    const feed = await attentionService(db).list(spaceId, { userId: "operator-user" });
    expect(feed.items.some((item) => item.dedupKey === `approval:${approvalId}`)).toBe(true);
  });

  it("delivers a structured human unblock descriptor once per blocked transition", async () => {
    const { spaceId } = await seedSpace("ATU");
    const transitionAt = new Date("2026-07-23T18:30:00.000Z");
    const issueId = await insertIssue({
      spaceId,
      identifier: "ATU-1",
      title: "Needs operator action",
      status: "blocked",
      unblockDescriptor: { owner: "operator", action: "Approve the exception" },
      blockedTransitionAt: transitionAt,
    });

    const feed = await attentionService(db).list(spaceId, { userId: "operator-user" });
    const items = feed.items.filter((item) => item.dedupKey === `blocked-owner:${issueId}:${transitionAt.toISOString()}`);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ sourceKind: "blocker_attention", whyNow: "Approve the exception" });
  });

  it("keeps legacy blocker attention visible for pre-rollout blocked issues", async () => {
    const { spaceId } = await seedSpace("ATP");
    const issueId = await insertIssue({
      spaceId,
      identifier: "ATP-1",
      title: "Blocked before rollout",
      status: "blocked",
      blockedTransitionAt: new Date(ROUTABLE_BLOCKED_ROLLOUT_AT.getTime() - 1),
    });

    const feed = await attentionService(db).list(spaceId, { userId: "operator-user" });

    expect(feed.items.some((item) => item.dedupKey === `blocker:${issueId}`)).toBe(true);
  });

  // Regression: both blocker_attention call sites fell back to the blocked
  // task's own identity when no `blocks` relation was loaded, so every such row
  // claimed the task was blocked by itself ("PAP-23 — Blocked by PAP-23").
  it("reports no blocking task rather than a self-reference when the blocker is unknown", async () => {
    const { spaceId } = await seedSpace("ATV");
    const issueId = await insertIssue({
      spaceId,
      identifier: "ATV-1",
      title: "Blocked with no relation",
      status: "blocked",
      blockedTransitionAt: new Date(ROUTABLE_BLOCKED_ROLLOUT_AT.getTime() - 1),
    });

    const feed = await attentionService(db).list(spaceId, { userId: "operator-user" });
    const row = feed.items.find((item) => item.dedupKey === `blocker:${issueId}`);

    expect(row).toBeTruthy();
    expect(row?.detail).toMatchObject({ kind: "blocker", blockingIssue: null });
    expect(row?.dismissalKey).toBe(`attention:blocker:${issueId}`);
  });

  it("suppresses a blocked dependency row while its blocker is actively progressing", async () => {
    const { spaceId } = await seedSpace("ATW");
    const blockedId = await insertIssue({
      spaceId,
      identifier: "ATW-1",
      title: "Blocked parent",
      status: "blocked",
      blockedTransitionAt: new Date(ROUTABLE_BLOCKED_ROLLOUT_AT.getTime() - 1),
    });
    const blockerId = await insertIssue({
      spaceId,
      identifier: "ATW-2",
      title: "The actual blocker",
      status: "in_progress",
    });
    await db.insert(issueRelations).values({
      spaceId,
      issueId: blockerId,
      relatedIssueId: blockedId,
      type: "blocks",
    });

    const feed = await attentionService(db).list(spaceId, { userId: "operator-user" });
    expect(feed.items.some((item) => item.sourceKind === "blocker_attention")).toBe(false);
  });

  it("suppresses a mixed blocker tree when any blocker is live", async () => {
    const { spaceId } = await seedSpace("ATL");
    const blockedId = await insertIssue({
      spaceId,
      identifier: "ATL-1",
      title: "Blocked rollout",
      status: "blocked",
    });
    const blockerIds = await Promise.all([
      insertIssue({ spaceId, identifier: "ATL-2", title: "Live phase one", status: "in_progress" }),
      insertIssue({ spaceId, identifier: "ATL-3", title: "Live phase two", status: "in_progress" }),
      insertIssue({ spaceId, identifier: "ATL-4", title: "Live phase three", status: "in_progress" }),
      insertIssue({ spaceId, identifier: "ATL-5", title: "Stopped phase", status: "todo" }),
    ]);
    await db.insert(issueRelations).values(blockerIds.map((issueId) => ({
      spaceId,
      issueId,
      relatedIssueId: blockedId,
      type: "blocks" as const,
    })));

    const feed = await attentionService(db).list(spaceId, { userId: "operator-user" });

    expect(feed.items.filter((item) => item.sourceKind === "blocker_attention")).toEqual([]);
  });

  it("emits one terminal-blocker row with a cycle-safe transitive blocked-work count", async () => {
    const { spaceId } = await seedSpace("ATC");
    const terminalId = await insertIssue({
      spaceId,
      identifier: "ATC-1",
      title: "Choose migration owner",
      status: "todo",
    });
    const blockedId = await insertIssue({
      spaceId,
      identifier: "ATC-2",
      title: "Blocked migration",
      status: "blocked",
    });
    await insertIssue({
      spaceId,
      identifier: "ATC-3",
      title: "Open migration child",
      status: "todo",
      parentId: blockedId,
    });
    const transitiveId = await insertIssue({
      spaceId,
      identifier: "ATC-4",
      title: "Transitively blocked follow-up",
      status: "todo",
    });
    await insertIssue({
      spaceId,
      identifier: "ATC-5",
      title: "Closed child",
      status: "done",
      parentId: blockedId,
    });
    await db.insert(issueRelations).values([
      { spaceId, issueId: terminalId, relatedIssueId: blockedId, type: "blocks" },
      { spaceId, issueId: blockedId, relatedIssueId: transitiveId, type: "blocks" },
      // Corrupt legacy cycles must not inflate or hang the count.
      { spaceId, issueId: transitiveId, relatedIssueId: blockedId, type: "blocks" },
    ]);

    const feed = await attentionService(db).list(spaceId, { userId: "operator-user" });
    const rows = feed.items.filter((item) => item.sourceKind === "blocker_attention");

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      subject: { id: terminalId, identifier: "ATC-1", title: "Choose migration owner" },
      relatedIssue: { id: blockedId },
      whyNow: "Blocks 3 tasks and needs human attention.",
      detail: { kind: "blocker", blockingIssue: null, blockedTaskCount: 3 },
    });
    expect(rows[0]?.subject.id).not.toBe(blockedId);
  });

  it("orders terminal blockers by blocked-work weight descending", async () => {
    const { spaceId } = await seedSpace("ATR");
    const heavyTerminalId = await insertIssue({
      spaceId,
      identifier: "ATR-1",
      title: "Heavy blocker",
      status: "todo",
      updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    });
    const lightTerminalId = await insertIssue({
      spaceId,
      identifier: "ATR-2",
      title: "Light blocker",
      status: "todo",
      updatedAt: new Date("2026-07-03T00:00:00.000Z"),
    });
    const heavyBlockedId = await insertIssue({
      spaceId,
      identifier: "ATR-3",
      title: "Heavy blocked root",
      status: "blocked",
    });
    const lightBlockedId = await insertIssue({
      spaceId,
      identifier: "ATR-4",
      title: "Light blocked root",
      status: "blocked",
    });
    await insertIssue({ spaceId, identifier: "ATR-5", title: "Heavy child one", status: "todo", parentId: heavyBlockedId });
    await insertIssue({ spaceId, identifier: "ATR-6", title: "Heavy child two", status: "todo", parentId: heavyBlockedId });
    await db.insert(issueRelations).values([
      { spaceId, issueId: heavyTerminalId, relatedIssueId: heavyBlockedId, type: "blocks" },
      { spaceId, issueId: lightTerminalId, relatedIssueId: lightBlockedId, type: "blocks" },
    ]);

    const feed = await attentionService(db).list(spaceId, { userId: "operator-user" });
    const rows = feed.items.filter((item) => item.sourceKind === "blocker_attention");

    expect(rows.map((item) => item.subject.id)).toEqual([heavyTerminalId, lightTerminalId]);
    expect(rows.map((item) => item.detail?.kind === "blocker" ? item.detail.blockedTaskCount : null)).toEqual([3, 1]);
  });

  it("does not name the blocked task as its own blocker on a human-owned unblock row", async () => {
    const { spaceId } = await seedSpace("ATX");
    const transitionAt = new Date("2026-07-23T18:30:00.000Z");
    const issueId = await insertIssue({
      spaceId,
      identifier: "ATX-1",
      title: "Needs operator action",
      status: "blocked",
      unblockDescriptor: { owner: "operator", action: "Approve the exception" },
      blockedTransitionAt: transitionAt,
    });

    const feed = await attentionService(db).list(spaceId, { userId: "operator-user" });
    const row = feed.items.find(
      (item) => item.dedupKey === `blocked-owner:${issueId}:${transitionAt.toISOString()}`,
    );

    expect(row?.detail).toMatchObject({ kind: "blocker", blockingIssue: null });
  });

  it("does not route pre-rollout human unblock descriptors", async () => {
    const { spaceId } = await seedSpace("ATQ");
    const transitionAt = new Date(ROUTABLE_BLOCKED_ROLLOUT_AT.getTime() - 1);
    const issueId = await insertIssue({
      spaceId,
      identifier: "ATQ-1",
      title: "Human-owned before rollout",
      status: "blocked",
      unblockDescriptor: { owner: "operator", action: "Review the issue" },
      blockedTransitionAt: transitionAt,
    });

    const feed = await attentionService(db).list(spaceId, { userId: "operator-user" });

    expect(feed.items.some((item) => item.dedupKey === `blocked-owner:${issueId}:${transitionAt.toISOString()}`)).toBe(false);
  });

  it("returns one pending approval row when the approval is linked to multiple tasks", async () => {
    const { spaceId } = await seedSpace("ATM");
    const approvalId = randomUUID();
    const firstIssueId = "00000000-0000-4000-8000-000000000001";
    const secondIssueId = "00000000-0000-4000-8000-000000000002";
    await insertIssue({ spaceId, id: firstIssueId, identifier: "ATM-1", title: "First task", status: "in_progress" });
    await insertIssue({ spaceId, id: secondIssueId, identifier: "ATM-2", title: "Second task", status: "in_progress" });
    await db.insert(approvals).values({
      id: approvalId,
      spaceId,
      type: "request_operator_approval",
      status: "pending",
      payload: { title: "Approve rollout" },
    });
    await db.insert(issueApprovals).values([
      { spaceId, issueId: secondIssueId, approvalId },
      { spaceId, issueId: firstIssueId, approvalId },
    ]);

    const feed = await attentionService(db).list(spaceId, { userId: "operator-user" });
    const approvalItems = feed.items.filter((item) => item.dedupKey === `approval:${approvalId}`);

    expect(approvalItems).toHaveLength(1);
    expect(approvalItems[0]?.subject.metadata?.issueId).toBe(firstIssueId);
  });

  it("hides snoozed attention rows until snoozedUntil passes, then returns them unconditionally", async () => {
    const { spaceId } = await seedSpace("ATS");
    const approvalId = randomUUID();
    await db.insert(approvals).values({
      id: approvalId,
      spaceId,
      type: "create_agent",
      status: "pending",
      payload: { title: "Create Researcher" },
      createdAt: new Date("2026-07-09T12:00:00.000Z"),
      updatedAt: new Date("2026-07-09T12:00:00.000Z"),
    });
    await db.insert(inboxDismissals).values({
      spaceId,
      userId: "operator-user",
      itemKey: `attention:approval:${approvalId}`,
      kind: "snooze",
      dismissedAt: new Date("2099-01-01T00:00:00.000Z"),
      snoozedUntil: new Date("2099-01-02T00:00:00.000Z"),
    });

    await expect(attentionService(db).list(spaceId, { userId: "operator-user" }))
      .resolves.toMatchObject({ totalCount: 1 }); // agent_error_alert from seed
    await expect(attentionService(db).summary(spaceId, { userId: "operator-user" })).resolves.toMatchObject({ totalCount: 1 });
    const hiddenFeed = await attentionService(db).list(spaceId, { userId: "operator-user", includeDismissed: true });
    expect(hiddenFeed.items.find((item) => item.dedupKey === `approval:${approvalId}`)?.dismissal)
      .toMatchObject({ kind: "snooze", isActive: true, snoozedUntil: "2099-01-02T00:00:00.000Z" });

    await db
      .update(inboxDismissals)
      .set({ snoozedUntil: new Date("2020-01-01T00:00:00.000Z") })
      .where(eq(inboxDismissals.itemKey, `attention:approval:${approvalId}`));

    const visibleFeed = await attentionService(db).list(spaceId, { userId: "operator-user" });
    const visibleApproval = visibleFeed.items.find((item) => item.dedupKey === `approval:${approvalId}`);
    expect(visibleApproval?.dismissal).toMatchObject({ kind: "snooze", isActive: false });
    expect(visibleApproval).toBeTruthy();
    const summary = await attentionService(db).summary(spaceId, { userId: "operator-user" });
    expect(summary.totalCount).toBe(visibleFeed.totalCount);

  });

  it("enriches, filters, paginates, snoozes, and ranks the decide-now feed", async () => {
    const { spaceId, workerId, errorAgentId } = await seedSpace("ATP");
    const now = Date.now();
    const originIssueId = await insertIssue({
      spaceId,
      identifier: "ATP-1",
      title: "Decision origin",
      status: "in_progress",
      assigneeAgentId: workerId,
      updatedAt: new Date(now - 10 * 60_000),
    });
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId,
      spaceId,
      agentId: workerId,
      status: "succeeded",
      contextSnapshot: { issueId: originIssueId },
    });

    const expiringSoonId = randomUUID();
    const expiringLaterId = randomUUID();
    const wheneverId = randomUUID();
    const snoozedId = randomUUID();
    const decisionValues = [
      { id: expiringSoonId, ruleKey: "release.soon", title: "Expires sooner", updatedAt: new Date(now - 60_000), expiresAt: new Date(now + 60 * 60_000) },
      { id: expiringLaterId, ruleKey: "release.later", title: "Expires later", updatedAt: new Date(now - 2 * 60_000), expiresAt: new Date(now + 2 * 60 * 60_000) },
      { id: wheneverId, ruleKey: "release.whenever", title: "Can wait", updatedAt: new Date(now), expiresAt: new Date(now + 30 * 60_000) },
      { id: snoozedId, ruleKey: "release.snoozed", title: "Snoozed", updatedAt: new Date(now - 3 * 60_000), expiresAt: new Date(now + 15 * 60_000) },
    ];
    await db.insert(decisions).values(decisionValues.map((value) => ({
      ...value,
      spaceId,
      originAgentId: workerId,
      originIssueId,
      originRunId: runId,
      body: value.title,
      options: [],
      status: "open",
      signedSpec: "test",
      targetSnapshots: {},
      createdAt: value.updatedAt,
    })));

    const queueId = randomUUID();
    await db.insert(decisionQueues).values({
      id: queueId,
      spaceId,
      key: "urgent-releases",
      title: "Urgent releases",
      createdByType: "user",
      createdByUserId: "operator-user",
    });
    await db.insert(decisionQueueItems).values([expiringSoonId, expiringLaterId].map((sourceId) => ({
      spaceId,
      queueId,
      sourceKind: "decision",
      sourceId,
      addedByType: "user",
      addedByUserId: "operator-user",
    })));
    await db.insert(decisionTriage).values([
      expiringSoonId,
      expiringLaterId,
      snoozedId,
    ].map((sourceId) => ({
      spaceId,
      sourceKind: "decision",
      sourceId,
      decideBy: "today",
      setByType: "agent",
      setByAgentId: workerId,
      snoozedUntil: sourceId === snoozedId ? new Date(now + 60 * 60_000) : null,
    })));
    await db.insert(decisionTriage).values({
      spaceId,
      sourceKind: "decision",
      sourceId: wheneverId,
      decideBy: "whenever",
      setByType: "agent",
      setByAgentId: workerId,
    });

    const approvalId = randomUUID();
    await db.insert(approvals).values({
      id: approvalId,
      spaceId,
      type: "create_agent",
      status: "pending",
      payload: { title: "Newer medium-severity approval" },
      createdAt: new Date(now + 5 * 60_000),
      updatedAt: new Date(now + 5 * 60_000),
    });
    await db.update(agents).set({ updatedAt: new Date(now - 5 * 60_000) }).where(eq(agents.id, errorAgentId));

    const feed = await attentionService(db).list(spaceId, {
      userId: "operator-user",
      sort: "decide",
      limit: 20,
    });
    // Desk badge = distinct items surfaced today OR with a due decide-by
    // Everything here was seeded ~now, so every visible row
    // counts; the whole page fits under limit:20 so items == rankedItems.
    const startOfUtcDay = Date.UTC(
      new Date(now).getUTCFullYear(),
      new Date(now).getUTCMonth(),
      new Date(now).getUTCDate(),
    );
    const expectedBadge = feed.items.filter(
      (item) => new Date(item.createdAt).getTime() >= startOfUtcDay || item.decideBy === "today",
    ).length;
    expect(expectedBadge).toBeGreaterThanOrEqual(2);
    expect(feed.deskBadgeCount).toBe(expectedBadge);
    expect(feed.items.some((item) => item.subject.id === snoozedId)).toBe(false);
    expect(feed.items.slice(0, 3).map((item) => item.subject.id)).toEqual([
      expiringSoonId,
      expiringLaterId,
      wheneverId,
    ]);
    const erroredAgentIndex = feed.items.findIndex((item) => item.subject.id === errorAgentId);
    const approvalIndex = feed.items.findIndex((item) => item.subject.id === approvalId);
    expect(erroredAgentIndex).toBeGreaterThan(-1);
    expect(erroredAgentIndex).toBeLessThan(approvalIndex);

    const enriched = feed.items.find((item) => item.subject.id === expiringSoonId);
    expect(enriched).toMatchObject({
      expiresAt: decisionValues[0]!.expiresAt.toISOString(),
      ruleKey: "release.soon",
      originAgentName: "Worker",
      queues: [{ key: "urgent-releases", title: "Urgent releases" }],
      decideBy: "today",
      decideByAttribution: {
        type: "agent",
        agentId: workerId,
        agentName: "Worker",
      },
      snoozedUntil: null,
    });

    const firstPage = await attentionService(db).list(spaceId, {
      userId: "operator-user",
      queue: "urgent-releases",
      sort: "decide",
      limit: 1,
    });
    expect(firstPage).toMatchObject({ totalCount: 2, deskBadgeCount: 2 });
    expect(firstPage.items.map((item) => item.subject.id)).toEqual([expiringSoonId]);
    expect(firstPage.nextCursor).toBeTruthy();
    const secondPage = await attentionService(db).list(spaceId, {
      userId: "operator-user",
      queue: "urgent-releases",
      sort: "decide",
      limit: 1,
      cursor: firstPage.nextCursor!,
    });
    expect(secondPage.items.map((item) => item.subject.id)).toEqual([expiringLaterId]);
    expect(secondPage.nextCursor).toBeNull();

    const completeSnapshot = await attentionService(db).list(spaceId, {
      userId: "operator-user",
      queue: "urgent-releases",
      sort: "decide",
      all: true,
    });
    expect(completeSnapshot.items.map((item) => item.subject.id)).toEqual([expiringSoonId, expiringLaterId]);
    expect(completeSnapshot.nextCursor).toBeNull();

    const dateFiltered = await attentionService(db).list(spaceId, {
      userId: "operator-user",
      queue: "urgent-releases",
      activitySince: new Date(now - 90_000).toISOString(),
      activityUntil: new Date(now).toISOString(),
    });
    expect(dateFiltered.items.map((item) => item.subject.id)).toEqual([expiringSoonId]);

    const withSnoozed = await attentionService(db).list(spaceId, {
      userId: "operator-user",
      includeDismissed: true,
      limit: 20,
    });
    expect(withSnoozed.items.find((item) => item.subject.id === snoozedId)?.snoozedUntil)
      .toBe(new Date(now + 60 * 60_000).toISOString());
  });

  it("returns a complete queue snapshot beyond the normal page limit", async () => {
    const { spaceId } = await seedSpace("ATS");
    const queueId = randomUUID();
    await db.insert(decisionQueues).values({
      id: queueId,
      spaceId,
      key: "bulk-review",
      title: "Bulk review",
      createdByType: "user",
      createdByUserId: "operator-user",
    });

    const approvalRows = Array.from({ length: 101 }, (_, index) => ({
      id: randomUUID(),
      spaceId,
      type: "create_agent",
      status: "pending",
      payload: { title: `Review ${index + 1}` },
      createdAt: new Date(Date.UTC(2026, 7, 2, 12, 0, index)),
      updatedAt: new Date(Date.UTC(2026, 7, 2, 12, 0, index)),
    }));
    await db.insert(approvals).values(approvalRows);
    await db.insert(decisionQueueItems).values(approvalRows.map((approval) => ({
      spaceId,
      queueId,
      sourceKind: "approval",
      sourceId: approval.id,
      addedByType: "user",
      addedByUserId: "operator-user",
    })));

    const firstPage = await attentionService(db).list(spaceId, {
      userId: "operator-user",
      queue: "bulk-review",
    });
    expect(firstPage.items).toHaveLength(50);
    expect(firstPage.nextCursor).toBeTruthy();

    const completeSnapshot = await attentionService(db).list(spaceId, {
      userId: "operator-user",
      queue: "bulk-review",
      all: true,
    });
    expect(completeSnapshot.items).toHaveLength(101);
    expect(new Set(completeSnapshot.items.map((item) => item.id)).size).toBe(101);
    expect(completeSnapshot.nextCursor).toBeNull();

    const internalSnapshot = await attentionService(db).list(spaceId, {
      userId: "operator-user",
      all: true,
      allowUnscopedAll: true,
    });
    const internalSnapshotIds = new Set(internalSnapshot.items.map((item) => item.subject.id));
    expect(approvalRows.every((approval) => internalSnapshotIds.has(approval.id))).toBe(true);
    expect(internalSnapshot.items.length).toBeGreaterThan(100);
    expect(internalSnapshot.nextCursor).toBeNull();
    const summary = await attentionService(db).summary(spaceId, { userId: "operator-user" });
    expect(summary).toEqual({
      spaceId, generatedAt: expect.any(String), totalCount: internalSnapshot.totalCount,
      deskBadgeCount: internalSnapshot.deskBadgeCount, countsBySourceKind: internalSnapshot.countsBySourceKind,
    });
    expect(JSON.stringify(summary).length).toBeLessThan(JSON.stringify(internalSnapshot).length / 10);


    await expect(attentionService(db).list(spaceId, { userId: "operator-user", all: true }))
      .rejects.toThrow("all requires a queue filter");
    await expect(attentionService(db).list(spaceId, {
      userId: "operator-user",
      queue: "bulk-review",
      all: true,
      limit: 25,
    })).rejects.toThrow("all cannot be combined with cursor or limit");
  });

  it("does not apply the open-decision safety limit to complete snapshots", async () => {
    const { spaceId, workerId } = await seedSpace("ATC");
    const originIssueId = await insertIssue({
      spaceId,
      identifier: "ATC-1",
      title: "Decision origin",
      status: "in_progress",
      assigneeAgentId: workerId,
    });
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId,
      spaceId,
      agentId: workerId,
      status: "succeeded",
      contextSnapshot: { issueId: originIssueId },
    });
    await db.insert(decisions).values(["First decision", "Second decision"].map((title) => ({
      id: randomUUID(),
      spaceId,
      originAgentId: workerId,
      originIssueId,
      originRunId: runId,
      title,
      body: title,
      options: [],
      status: "open" as const,
      expiresAt: new Date("2026-08-10T00:00:00.000Z"),
      signedSpec: "test",
      targetSnapshots: {},
    })));

    const svc = attentionService(db, { openDecisionLimit: 1 });
    const limited = await svc.list(spaceId, { userId: "operator-user" });
    expect(limited.items.filter((item) => item.sourceKind === "decision")).toHaveLength(1);

    const complete = await svc.list(spaceId, {
      userId: "operator-user",
      all: true,
      allowUnscopedAll: true,
    });
    expect(complete.items.filter((item) => item.sourceKind === "decision")).toHaveLength(2);
    const summary = await svc.summary(spaceId, { userId: "operator-user" });
    expect(summary.totalCount).toBe(complete.totalCount);
    expect(summary.countsBySourceKind).toEqual(complete.countsBySourceKind);

    expect(complete.nextCursor).toBeNull();
  });

  it("keeps this-week deadlines in the current UTC week", async () => {
    const { spaceId, workerId } = await seedSpace("ATW");
    const now = Date.parse("2026-08-02T12:00:00.000Z"); // Sunday in an ISO Monday-Sunday week.
    const originIssueId = await insertIssue({
      spaceId,
      identifier: "ATW-1",
      title: "Decision origin",
      status: "in_progress",
      assigneeAgentId: workerId,
      updatedAt: new Date(now),
    });
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId,
      spaceId,
      agentId: workerId,
      status: "succeeded",
      contextSnapshot: { issueId: originIssueId },
    });

    const thisWeekId = randomUUID();
    const nextWeekId = randomUUID();
    await db.insert(decisions).values([
      { id: thisWeekId, title: "This week", expiresAt: new Date("2026-08-09T12:00:00.000Z") },
      { id: nextWeekId, title: "Next week", expiresAt: new Date("2026-08-03T12:00:00.000Z") },
    ].map((value) => ({
      ...value,
      spaceId,
      originAgentId: workerId,
      originIssueId,
      originRunId: runId,
      body: value.title,
      options: [],
      status: "open" as const,
      signedSpec: "test",
      targetSnapshots: {},
      createdAt: new Date(now),
      updatedAt: new Date(now),
    })));
    await db.insert(decisionTriage).values([
      {
        spaceId,
        sourceKind: "decision",
        sourceId: thisWeekId,
        decideBy: "this_week",
        setByType: "user",
        setByUserId: "operator-user",
      },
      {
        spaceId,
        sourceKind: "decision",
        sourceId: nextWeekId,
        decideBy: "date",
        decideByDate: "2026-08-03",
        setByType: "user",
        setByUserId: "operator-user",
      },
    ]);

    const feed = await attentionService(db, { now: () => now }).list(spaceId, {
      userId: "operator-user",
      sort: "decide",
      limit: 20,
    });
    const decisionItems = feed.items.filter((item) => item.sourceKind === "decision");

    expect(decisionItems.map((item) => item.subject.id)).toEqual([thisWeekId, nextWeekId]);
    expect(decisionItems[0]).toMatchObject({
      decideBy: "this_week",
      expiresAt: "2026-08-09T12:00:00.000Z",
    });
    expect(decisionItems[1]).toMatchObject({
      decideBy: "2026-08-03",
      expiresAt: "2026-08-03T12:00:00.000Z",
    });
  });

  it("serves the route for operator users and rejects agent callers", async () => {
    const { spaceId } = await seedSpace("ATR");

    function app(actor: Record<string, unknown>) {
      const testApp = express();
      testApp.use(express.json());
      testApp.use((req, _res, next) => {
        (req as any).actor = actor;
        next();
      });
      testApp.use("/api", attentionRoutes(db));
      testApp.use(errorHandler);
      return testApp;
    }

    const operator = {
      type: "operator",
      source: "local_implicit",
      userId: "operator-user",
      spaceIds: [spaceId],
      isInstanceAdmin: false,
    };
    const agent = {
      type: "agent",
      source: "agent_key",
      spaceId,
      agentId: randomUUID(),
      runId: null,
    };

    await request(app(operator)).get(`/api/spaces/${spaceId}/attention`).expect(200);
    const completeFeed = await request(app(operator))
      .get(`/api/spaces/${spaceId}/attention?includeDismissed=true&all=true`)
      .expect(200);
    expect(completeFeed.body.nextCursor).toBeNull();
    const summary = await request(app(operator)).get(`/api/spaces/${spaceId}/attention/summary`).expect(200);
    expect(summary.body).not.toHaveProperty("items");
    expect(summary.body.totalCount).toBe(completeFeed.body.totalCount);
    const taskIndex = await request(app(operator)).get(`/api/spaces/${spaceId}/attention/tasks`).expect(200);
    expect(taskIndex.body).not.toHaveProperty("items");
    expect(taskIndex.body.taskIds).toEqual([]);
    await request(app(agent)).get(`/api/spaces/${spaceId}/attention/tasks`).expect(403);
    await request(app({ ...operator, source: "session", spaceIds: [] })).get(`/api/spaces/${spaceId}/attention/tasks`).expect(403);

    await request(app(agent)).get(`/api/spaces/${spaceId}/attention/summary`).expect(403);
    await request(app({ ...operator, source: "session", spaceIds: [] })).get(`/api/spaces/${spaceId}/attention/summary`).expect(403);

    await request(app(operator))
      .get(`/api/spaces/${spaceId}/attention?activitySince=yesterday`)
      .expect(400, { error: "activitySince must be an ISO timestamp" });
    await request(app(operator))
      .get(`/api/spaces/${spaceId}/attention?sort=oldest`)
      .expect(400, { error: "sort must be 'activity' or 'decide'" });
    await request(app(agent)).get(`/api/spaces/${spaceId}/attention`).expect(403);
  });

  it("omits private issue review items for a non-member operator user", async () => {
    const { spaceId } = await seedSpace("ATP");
    const privateIssueId = randomUUID();
    await insertIssue({
      id: privateIssueId,
      spaceId,
      identifier: "ATP-1",
      title: "Confidential review",
      status: "in_review",
      assigneeUserId: "private-owner",
      executionState: pendingUserExecutionState("private-owner"),
      visibility: "private",
      privacyRootIssueId: privateIssueId,
      responsibleUserId: "private-owner",
    });

    const actor = {
      type: "operator" as const,
      source: "session" as const,
      userId: "non-member",
      spaceIds: [spaceId],
      isInstanceAdmin: false,
    };
    const feed = await attentionService(db).list(spaceId, { userId: actor.userId, actor });

    expect(feed.items.map((item) => item.subject.title)).not.toContain("Confidential review");
    expect(JSON.stringify(feed)).not.toContain(privateIssueId);
    const summary = await attentionService(db).summary(spaceId, { userId: actor.userId, actor });
    expect(summary.totalCount).toBe(feed.totalCount);
    expect(summary.countsBySourceKind).toEqual(feed.countsBySourceKind);

  });

  it("computes the aging shelf uniformly across approval, interaction, and review sources", async () => {
    const { spaceId, workerId } = await seedSpace("AGE");
    const now = Date.parse("2026-08-02T12:00:00.000Z");
    const idleAt = new Date("2026-06-30T12:00:00.000Z");
    const interactionIssueId = await insertIssue({
      spaceId,
      identifier: "AGE-1",
      title: "Old questions",
      status: "in_progress",
      assigneeAgentId: workerId,
      createdAt: idleAt,
      updatedAt: idleAt,
    });
    const reviewIssueId = await insertIssue({
      spaceId,
      identifier: "AGE-2",
      title: "Old review",
      status: "in_review",
      assigneeUserId: "operator-user",
      createdAt: idleAt,
      updatedAt: idleAt,
    });
    const approvalId = randomUUID();
    const queueApprovalId = randomUUID();
    const interactionId = randomUUID();
    const queueIdleAt = new Date("2026-07-18T12:00:00.000Z");
    await db.insert(approvals).values([
      {
        id: approvalId,
        spaceId,
        type: "request_operator_approval",
        requestedByAgentId: workerId,
        status: "pending",
        payload: { title: "Old approval" },
        createdAt: idleAt,
        updatedAt: idleAt,
      },
      {
        id: queueApprovalId,
        spaceId,
        type: "request_operator_approval",
        requestedByAgentId: workerId,
        status: "pending",
        payload: { title: "Queue-retained approval" },
        createdAt: queueIdleAt,
        updatedAt: queueIdleAt,
      },
    ]);
    await db.insert(issueThreadInteractions).values({
      id: interactionId,
      spaceId,
      issueId: interactionIssueId,
      kind: "ask_user_questions",
      status: "pending",
      createdByAgentId: workerId,
      payload: { version: 1, questions: [] },
      createdAt: idleAt,
      updatedAt: idleAt,
    });
    const [queue] = await db.insert(decisionQueues).values({
      spaceId,
      key: "fast-aging",
      title: "Fast aging",
      retentionDays: 10,
      createdByType: "system",
    }).returning();
    await db.insert(decisionQueueItems).values({
      spaceId,
      queueId: queue!.id,
      sourceKind: "approval",
      sourceId: queueApprovalId,
      addedByType: "system",
    });

    const feed = await attentionService(db, { now: () => now }).list(spaceId, {
      userId: "operator-user",
      limit: 100,
    });
    const byKey = new Map(feed.items.map((item) => [`${item.sourceKind}:${item.subject.id}`, item]));
    for (const key of [
      `approval:${approvalId}`,
      `issue_thread_interaction:${interactionId}`,
      `review:${reviewIssueId}`,
    ]) {
      expect(byKey.get(key)).toMatchObject({ shelf: true, retentionDays: 30, archivedAt: null });
    }
    expect(byKey.get(`approval:${queueApprovalId}`)).toMatchObject({ shelf: true, retentionDays: 10 });
  });
});
