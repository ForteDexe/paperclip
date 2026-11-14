import { createHash } from "node:crypto";
import type { Db, agents, agentTaskSessions, heartbeatRuns } from "@outpost/db";
import { FAST_RESPONSE_AGENT_GUIDANCE, fastResponseHistoryBody, isValidIanaTimeZone } from "@outpost/shared";
import type { OutpostTurnContext } from "@outpost/adapter-utils/server-utils";
import { parseObject } from "../../adapters/utils.js";
import { isConversation } from "../agent-conversations.js";
import { chatCompletionInstruction } from "../chat-completion-delivery.js";
import { getConversationConfirmationContext } from "../conversation-confirmation-context.js";
import { buildExecutionContinuation } from "../execution-continuation.js";
import { getIssueContinuationSummaryDocument } from "../issue-continuation-summary.js";
import type { issueService } from "../issues.js";
import { createRunSecretRedactionRegistry } from "../run-secret-redaction.js";
import { redactQuarantinedBodyForHigherTrust, sanitizeQuarantinedCommentForHigherTrust } from "../source-trust.js";
import { getTaskPlanContext } from "../task-plan-context.js";
import { caseExecutionMarkdown, getCaseExecutionContext } from "../case-context.js";
import type { TrustPresetResolution } from "../trust-preset-resolver.js";
import { liveVoiceExecutionGuidance } from "../voice/voice-execution-guidance.js";
import { buildOutpostWakePayload, ConfigurationIncompleteFailure, readHeartbeatWakeComments, OUTPOST_WAKE_PAYLOAD_KEY, type createHeartbeatRunPreparation } from "./run-preparation.js";
import { buildOutpostTaskMarkdown } from "./task-markdown.js";
import { deriveCommentId, extractWakeCommentIds } from "../../modules/run-dispatch/index.js";
import { workspacePreferenceService } from "../workspace-preferences.js";

type RunPreparation = ReturnType<typeof createHeartbeatRunPreparation>;
type IssueContext = NonNullable<Awaited<ReturnType<RunPreparation["getIssueExecutionContext"]>>>;

export interface HeartbeatTaskContextInput {
  run: Pick<typeof heartbeatRuns.$inferSelect, "id">;
  agent: Pick<typeof agents.$inferSelect, "id" | "spaceId" | "adapterType">;
  task: {
    issueRef: Pick<IssueContext,
      "id" | "identifier" | "title" | "status" | "priority" | "workMode" |
      "conversationAgentId" | "description" | "projectId"> | null;
    issueContext: IssueContext | null;
    context: Record<string, unknown>;
    taskSession: Pick<typeof agentTaskSessions.$inferSelect, "lastRunId"> | null;
  };
  policy: {
    recovering?: boolean;
    trustPreset: Pick<TrustPresetResolution, "kind">;
    experimentalInstanceSettings: { enableSimplifiedEnglishInteractions?: boolean; enableCases?: boolean };
  };
  services: {
    issuesSvc: Pick<ReturnType<typeof issueService>, "getAncestors">;
    getPinnedSkillTestContext: RunPreparation["getPinnedSkillTestContext"];
  };
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/** Rebuilds task prompt fields on the run's context; acquires no execution resources. */
export async function prepareHeartbeatTaskContext(db: Db, input: HeartbeatTaskContextInput) {
  const { run, agent } = input;
  const { issueRef, issueContext, context, taskSession } = input.task;
  const { trustPreset, experimentalInstanceSettings } = input.policy;
  const { issuesSvc, getPinnedSkillTestContext } = input.services;
  const admittedScope = parseObject(context.outpostAgentJwtScope);
  if (!input.policy.recovering || (admittedScope.kind !== "standard" && admittedScope.kind !== "skill_test")) {
    const savedIssue = parseObject(context.outpostIssue);
    const skillTest = input.policy.recovering
      ? savedIssue.workMode === "skill_test" || Boolean(context.outpostSkillTest)
      : issueRef?.workMode === "skill_test";
    context.outpostAgentJwtScope = skillTest && issueRef
      ? { kind: "skill_test", issueId: issueRef.id }
      : { kind: "standard" };
  }
  const isSkillTest = parseObject(context.outpostAgentJwtScope).kind === "skill_test";
  const wakeCommentId = deriveCommentId(context, null);
  const commentIds = [...new Set([...extractWakeCommentIds(context), ...(wakeCommentId ? [wakeCommentId] : [])])];
  const [summary, ancestors, pinnedSkillTestRead, wakeComments] = await Promise.allSettled([
    issueRef && !isConversation(issueContext) ? getIssueContinuationSummaryDocument(db, issueRef.id) : Promise.resolve(null),
    issueRef ? issuesSvc.getAncestors(issueRef.id) : Promise.resolve([]),
    isSkillTest && issueRef ? getPinnedSkillTestContext(agent.spaceId, issueRef.id) : Promise.resolve(null),
    readHeartbeatWakeComments(db, agent.spaceId, readNonEmptyString(context.issueId), commentIds),
  ]);
  if (summary.status === "rejected") throw summary.reason;
  if (ancestors.status === "rejected") throw ancestors.reason;
  if (pinnedSkillTestRead.status === "rejected") throw pinnedSkillTestRead.reason;
  if (wakeComments.status === "rejected") throw wakeComments.reason;
  const wakeCommentRows = wakeComments.value;
  const selectedWakeComment = issueRef && wakeCommentId ? wakeCommentRows.find(comment => comment.id === wakeCommentId && comment.issueId === issueRef.id) ?? null : null;
  const wakeCommentContext = selectedWakeComment ? {
    id: selectedWakeComment.id,
    body: selectedWakeComment.deletedAt ? "" : selectedWakeComment.body,
    authorType: selectedWakeComment.authorType,
    authorAgentId: selectedWakeComment.authorAgentId,
    authorUserId: selectedWakeComment.authorUserId,
    presentation: selectedWakeComment.deletedAt ? null : selectedWakeComment.presentation,
    metadata: selectedWakeComment.deletedAt ? null : selectedWakeComment.metadata,
    deletedAt: selectedWakeComment.deletedAt,
    deletedByType: selectedWakeComment.deletedByType,
    deletedByAgentId: selectedWakeComment.deletedByAgentId,
    deletedByUserId: selectedWakeComment.deletedByUserId,
    deletedByRunId: selectedWakeComment.deletedByRunId,
    sourceTrust: selectedWakeComment.sourceTrust,
  } : null;
  const continuationSummary = summary.value;
  const issueAncestors = ancestors.value;
  const pinnedSkillTestContext = pinnedSkillTestRead.value;
  const exposeLowTrustRaw = trustPreset.kind === "low_trust_review";
  const safeContinuationSummary =
    continuationSummary && !exposeLowTrustRaw
      ? redactQuarantinedBodyForHigherTrust(continuationSummary)
      : continuationSummary;
  const safeWakeCommentContext =
    wakeCommentContext && !exposeLowTrustRaw
      ? sanitizeQuarantinedCommentForHigherTrust(wakeCommentContext)
      : wakeCommentContext;
  if (continuationSummary) {
    context.outpostContinuationSummary = {
      key: safeContinuationSummary!.key,
      title: safeContinuationSummary!.title,
      body: safeContinuationSummary!.body,
      sourceTrust: safeContinuationSummary!.sourceTrust ?? null,
      updatedAt: safeContinuationSummary!.updatedAt.toISOString(),
    };
  } else {
    delete context.outpostContinuationSummary;
  }
  if (isSkillTest && !pinnedSkillTestContext) {
    throw new ConfigurationIncompleteFailure("The skill test's saved version is unavailable.", {
      configurationIncomplete: { reason: "skill_unavailable", actionUrl: "/skills" },
    });
  }
  if (pinnedSkillTestContext) {
    context.outpostSkillTest = {
      ...pinnedSkillTestContext,
      directive:
        "Use this pinned file inventory as the exact skill revision under test, regardless of synced runtime skills.",
    };
  } else {
    delete context.outpostSkillTest;
  }
  const executionContinuation =
    issueRef && !isConversation(issueContext) && issueContext?.assigneeAgentId === agent.id
      ? await buildExecutionContinuation({
          db,
          spaceId: agent.spaceId,
          issueId: issueRef.id,
          agentId: agent.id,
          runId: run.id,
          context,
          previousContextRunId: taskSession?.lastRunId,
          summary: safeContinuationSummary?.body ?? null,
          exposeLowTrustRaw,
        })
      : null;
  context.executionContinuation = executionContinuation;
  const outpostWakePayload = await buildOutpostWakePayload({
    db,
    spaceId: agent.spaceId,
    agentId: agent.id,
    runId: run.id,
    contextSnapshot: context,
    wakeCommentRows,
    continuationSummary,
    issueSummary: issueRef
      ? {
          id: issueRef.id,
          identifier: issueRef.identifier,
          title: issueRef.title,
          description: issueContext?.description ?? null,
          status: issueRef.status,
          priority: issueRef.priority,
          workMode: issueRef.workMode,
          projectId: issueRef.projectId,
          executionPolicy: issueContext?.executionPolicy ?? null,
          originKind: issueContext?.originKind ?? null,
        }
      : null,
    exposeLowTrustRaw,
    simplifiedEnglishInteractions:
      experimentalInstanceSettings.enableSimplifiedEnglishInteractions ===
      true,
  });
  if (outpostWakePayload) {
    context[OUTPOST_WAKE_PAYLOAD_KEY] = outpostWakePayload;
  } else {
    delete context[OUTPOST_WAKE_PAYLOAD_KEY];
  }
  const safeWakeComments = (outpostWakePayload?.comments ?? []).flatMap(
    (comment) =>
      typeof comment.id === "string" && typeof comment.body === "string"
        ? [
            {
              id: comment.id,
              body: fastResponseHistoryBody({ body: comment.body, origin: typeof comment.origin === "string" ? comment.origin : null }),
              attachments: Array.isArray(comment.attachments)
                ? comment.attachments.flatMap((attachment) => {
                    const descriptor = parseObject(attachment);
                    const id = readNonEmptyString(descriptor.id);
                    const filename = readNonEmptyString(
                      descriptor.filename,
                    );
                    const contentType = readNonEmptyString(
                      descriptor.contentType,
                    );
                    const contentPath = readNonEmptyString(
                      descriptor.contentPath,
                    );
                    const byteSize = descriptor.byteSize;
                    return id &&
                      filename &&
                      contentType &&
                      contentPath &&
                      typeof byteSize === "number"
                      ? [
                          {
                            id,
                            filename,
                            contentType,
                            byteSize,
                            contentPath,
                          },
                        ]
                      : [];
                  })
                : [],
            },
          ]
        : [],
  );
  // Always replace caller-supplied context with the immutable, space-scoped
  // conversation snapshot. It belongs only to the endpoint's assigned agent.
  const liveVoiceGuidance = issueContext?.chatAssignedAgentId === agent.id && issueContext.chatProvider === "speko"
    ? await liveVoiceExecutionGuidance(db, { spaceId: agent.spaceId, issueId: issueContext.id, agentId: agent.id })
    : null;
  context.outpostTaskCommunicationGuidance =
    issueContext?.chatAssignedAgentId === agent.id
      ? issueContext.chatCommunicationGuidance
      : null;
  // Use the standing chat owner's saved preferences, never worker text.
  // Recovery retains the admitted choices instead of silently changing its prompt.
  const conversationOwnerPreference = isConversation(issueContext) && issueContext?.conversationUserId
    && !input.policy.recovering
    ? await workspacePreferenceService(db).get(issueContext.conversationUserId)
    : null;
  const coordinatorWorkspace = agent.adapterType === "outpost_runner" && isConversation(issueContext)
    && issueContext?.conversationUserId
    ? input.policy.recovering
      ? context.outpostCoordinatorWorkspaceEnabled === true
      : conversationOwnerPreference?.coordinatorWorkspaceEnabled === true
    : false;
  context.outpostCoordinatorWorkspaceEnabled = Boolean(coordinatorWorkspace);
  const savedPersonTimeZone = input.policy.recovering
    ? readNonEmptyString(context.outpostConversationTimeZone)
    : conversationOwnerPreference?.timeZone ?? null;
  const personTimeZone = isConversation(issueContext) && issueContext?.conversationUserId
    && savedPersonTimeZone && isValidIanaTimeZone(savedPersonTimeZone)
    ? savedPersonTimeZone
    : null;
  if (personTimeZone) context.outpostConversationTimeZone = personTimeZone;
  else delete context.outpostConversationTimeZone;
  const taskMarkdownInput = {
    coordinatorWorkspace: Boolean(coordinatorWorkspace),
    personTimeZone,
    casesEnabled: experimentalInstanceSettings.enableCases === true,
    conversationConfirmations: issueRef && isConversation(issueContext)
      ? await getConversationConfirmationContext({ db, spaceId: agent.spaceId, issueId: issueRef.id, agentId: agent.id })
      : null,
    issue: issueRef
      ? {
          id: issueRef.id,
          identifier: issueRef.identifier,
          title: issueRef.title,
          titleNeedsGeneration: issueContext?.titleNeedsGeneration,
          workMode: issueRef.workMode,
          conversationAgentId: issueContext?.conversationAgentId,
          executionPolicy: issueContext?.executionPolicy,
          description: issueRef.description,
        }
      : null,
    ancestors: issueAncestors,
    wakeComment: safeWakeCommentContext,
    wakeComments: safeWakeComments,
    attachmentOmissions: outpostWakePayload?.attachmentOmissions,
    externalChatProvider: outpostWakePayload?.externalChatProvider,
    slackCommand: issueContext?.chatAssignedAgentId === agent.id
      ? issueContext.chatSlackCommand
      : null,
    nativeRunner: agent.adapterType === "outpost_runner",
    interaction: {
      kind: readNonEmptyString(context.interactionKind),
      status: readNonEmptyString(context.interactionStatus),
    },
    planReview: outpostWakePayload?.planReviewContext?.interaction
      ? {
          status: outpostWakePayload.planReviewContext.interaction.status,
          reason: outpostWakePayload.planReviewContext.interaction.result?.reason,
        }
      : null,
    acceptedPlanContinuation:
      readNonEmptyString(context.workspaceRefreshReason) ===
        "accepted_plan_confirmation" &&
      Object.keys(parseObject(context.acceptedPlanWakeRouting)).length ===
        0,
    acceptedPlan: (() => {
      const accepted = parseObject(
        parseObject(context.planReviewInteraction).acceptedTargetRevision,
      );
      const revisionId = readNonEmptyString(accepted.revisionId);
      if (!revisionId) return null;
      return {
        documentId: readNonEmptyString(accepted.documentId),
        revisionId,
        revisionNumber:
          typeof accepted.revisionNumber === "number"
            ? accepted.revisionNumber
            : null,
      };
    })(),
  };
  const taskPlan = issueRef && !isConversation(issueContext)
    ? await getTaskPlanContext({
        db,
        spaceId: agent.spaceId,
        issueId: issueRef.id,
        approvedRevisionId: taskMarkdownInput.acceptedPlan?.revisionId,
        exposeLowTrustRaw,
      })
    : null;
  // Unlike the frozen initial communication preferences, live-call context
  // must also reach resumed turns. Rebuild it from server records each wake.
  const liveVoiceTaskPrefix = liveVoiceGuidance ? `${liveVoiceGuidance}\n\n` : "";
  context.outpostCasesEnabled = experimentalInstanceSettings.enableCases === true;
  const workflowCase = issueRef && experimentalInstanceSettings.enableCases
    ? await getCaseExecutionContext(db, { spaceId: agent.spaceId, issueId: issueRef.id, agentId: agent.id, runId: run.id, exposeLowTrustRaw })
    : null;
  if (workflowCase) context.outpostCase = workflowCase;
  else delete context.outpostCase;
  const assignmentPrefix = liveVoiceTaskPrefix + caseExecutionMarkdown(workflowCase);
  let taskMarkdown = assignmentPrefix + buildOutpostTaskMarkdown({ ...taskMarkdownInput, taskPlan }) + chatCompletionInstruction(context);
  let taskMarkdownAssignment = assignmentPrefix + buildOutpostTaskMarkdown({
    ...taskMarkdownInput,
    taskPlan,
    includeWakeComments: false,
  }) + chatCompletionInstruction(context);
  const taskMarkdownCompact = assignmentPrefix + buildOutpostTaskMarkdown({
    ...taskMarkdownInput,
    taskPlan,
    includeDescription: false,
  }) + chatCompletionInstruction(context);
  const taskMarkdownAssignmentCompact = assignmentPrefix + buildOutpostTaskMarkdown({
    ...taskMarkdownInput,
    taskPlan,
    includeDescription: false,
    includeWakeComments: false,
  }) + chatCompletionInstruction(context);
  if (issueRef) {
    context.outpostIssue = {
      id: issueRef.id,
      identifier: issueRef.identifier,
      title: issueRef.title,
      description: isConversation(issueContext) ? null : issueRef.description,
      workMode: issueRef.workMode,
    };
  } else {
    delete context.outpostIssue;
  }
  if (wakeCommentContext) {
    context.outpostWakeComment = safeWakeCommentContext;
  } else {
    delete context.outpostWakeComment;
  }
  if (taskMarkdown) {
    context.outpostTaskMarkdown = taskMarkdown;
  } else {
    delete context.outpostTaskMarkdown;
  }
  if (taskMarkdownAssignment) {
    context.outpostTaskMarkdownAssignment = taskMarkdownAssignment;
  } else {
    delete context.outpostTaskMarkdownAssignment;
  }
  if (taskMarkdownCompact && taskMarkdownCompact !== taskMarkdown) {
    context.outpostTaskMarkdownCompact = taskMarkdownCompact;
  } else {
    delete context.outpostTaskMarkdownCompact;
  }
  if (taskMarkdownAssignmentCompact && taskMarkdownAssignmentCompact !== taskMarkdownAssignment) {
    context.outpostTaskMarkdownAssignmentCompact = taskMarkdownAssignmentCompact;
  } else {
    delete context.outpostTaskMarkdownAssignmentCompact;
  }
  context.outpostTaskCommunicationGuidance = [context.outpostTaskCommunicationGuidance, FAST_RESPONSE_AGENT_GUIDANCE].filter(Boolean).join("\n\n");
  if (issueRef) {
    const redactedWakeContext = await createRunSecretRedactionRegistry(
      db,
    ).redactForIssue(agent.spaceId, issueRef.id, {
      outpostIssue: context.outpostIssue,
      outpostCase: context.outpostCase,
      outpostWakeComment: context.outpostWakeComment,
      outpostTaskCommunicationGuidance: context.outpostTaskCommunicationGuidance,
      outpostTaskMarkdown: context.outpostTaskMarkdown,
      outpostTaskMarkdownCompact: context.outpostTaskMarkdownCompact,
      outpostTaskMarkdownAssignment: context.outpostTaskMarkdownAssignment,
      outpostTaskMarkdownAssignmentCompact: context.outpostTaskMarkdownAssignmentCompact,
    });
    context.outpostIssue = redactedWakeContext.outpostIssue;
    if (redactedWakeContext.outpostCase) context.outpostCase = redactedWakeContext.outpostCase;
    context.outpostTaskCommunicationGuidance = redactedWakeContext.outpostTaskCommunicationGuidance;
    if (redactedWakeContext.outpostWakeComment) {
      context.outpostWakeComment =
        redactedWakeContext.outpostWakeComment;
    }
    if (redactedWakeContext.outpostTaskMarkdown) {
      context.outpostTaskMarkdown =
        redactedWakeContext.outpostTaskMarkdown;
    }
    if (redactedWakeContext.outpostTaskMarkdownCompact) {
      context.outpostTaskMarkdownCompact =
        redactedWakeContext.outpostTaskMarkdownCompact;
    }
    if (redactedWakeContext.outpostTaskMarkdownAssignment) {
      context.outpostTaskMarkdownAssignment =
        redactedWakeContext.outpostTaskMarkdownAssignment;
    }
    if (redactedWakeContext.outpostTaskMarkdownAssignmentCompact) {
      context.outpostTaskMarkdownAssignmentCompact =
        redactedWakeContext.outpostTaskMarkdownAssignmentCompact;
    }
  }
  if (issueRef) {
    const digest = (value: string | null | undefined) =>
      value?.trim()
        ? createHash("sha256")
            .update(value.trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ""))
            .digest("hex")
        : null;
    const redactedIssue = parseObject(context.outpostIssue);
    context.outpostTurnContext = {
      version: 1,
      assignment: {
        owner: "task_markdown",
        description: {
          id: issueRef.id,
          revision: digest(readNonEmptyString(redactedIssue.description)),
        },
      },
      events: {
        owner: "wake_prompt",
        comments: safeWakeComments.map((comment) => ({
          id: comment.id,
          revision: digest(comment.body),
        })),
      },
    } satisfies OutpostTurnContext;
  } else {
    delete context.outpostTurnContext;
  }
  const pinnedSkillTest = pinnedSkillTestContext
    ? { key: pinnedSkillTestContext.skillKey, versionId: pinnedSkillTestContext.skillVersionId } : null;
  return { continuationSummary, executionContinuation, outpostWakePayload, safeWakeComments, safeWakeCommentContext, pinnedSkillTest };
}
