import { and, eq, inArray, sql } from "drizzle-orm";
import { chatConversations, chatEndpoints, heartbeatRuns, issues, statusDecisions, type Db } from "@outpost/db";
import { readInheritedGitHubReviewWaits } from "../chat-channels/github/review-wait.js";
import { authorizeChatConversationsForBoundRuns } from "./chat-attachment-reuse.js";
import { EXTERNAL_CHAT_QUESTION_RESPONSE_KEY } from "./external-chat-question-response.js";

const authorizationContextKeys = [
  "source", "issueId", "wakeReason", "interactionKind", "interactionStatus", "externalChatContinuation",
  "interactionId", "sourceRunId", "sourceCommentId", "wakeCommentId", "wakeCommentIds",
  "outpostHarnessCheckedOut", "outpostExternalChatExecutionBound",
  EXTERNAL_CHAT_QUESTION_RESPONSE_KEY,
] as const;

const authorizationContext = sql<Record<string, unknown> | null>`
  case when ${heartbeatRuns.contextSnapshot} is null then null else (
    select coalesce(jsonb_object_agg(field.key, field.value), '{}'::jsonb)
    from jsonb_each(case when jsonb_typeof(${heartbeatRuns.contextSnapshot}) = 'object'
      then ${heartbeatRuns.contextSnapshot} else '{}'::jsonb end) as field(key, value)
    where field.key in (${sql.join(authorizationContextKeys.map(key => sql`${key}`), sql`, `)})
  ) end
`;

export async function listExternalReviewWaits(db: Db, spaceId: string, issueIds: string[]) {
  if (!issueIds.length) return [];
  const candidates = await db.selectDistinctOn([issues.id], {
    id: statusDecisions.id,
    spaceId: issues.spaceId,
    issueId: issues.id,
    status: chatConversations.state,
    createdAt: statusDecisions.createdAt,
    runId: heartbeatRuns.id,
    agentId: heartbeatRuns.agentId,
    contextSnapshot: authorizationContext,
    responsibleUserId: heartbeatRuns.responsibleUserId,
    activeIdentityContextId: heartbeatRuns.activeIdentityContextId,
  }).from(issues)
    .innerJoin(statusDecisions, and(
      eq(statusDecisions.id, issues.lastStatusDecisionId),
      eq(statusDecisions.spaceId, issues.spaceId),
      eq(statusDecisions.issueId, issues.id),
      eq(statusDecisions.applicationState, "applied"),
      eq(statusDecisions.toStatus, "in_review"),
      eq(statusDecisions.reasonCode, "external_chat_response_waiting"),
    ))
    .innerJoin(heartbeatRuns, and(
      eq(heartbeatRuns.id, statusDecisions.runId),
      eq(heartbeatRuns.spaceId, issues.spaceId),
      eq(heartbeatRuns.nativeIssueId, issues.id),
      eq(heartbeatRuns.agentId, issues.assigneeAgentId),
      eq(heartbeatRuns.status, "succeeded"),
    ))
    .innerJoin(chatConversations, and(
      eq(chatConversations.spaceId, issues.spaceId),
      eq(chatConversations.issueId, issues.id),
      inArray(chatConversations.state, ["active", "waiting"]),
    ))
    .innerJoin(chatEndpoints, and(
      eq(chatEndpoints.id, chatConversations.endpointId),
      eq(chatEndpoints.spaceId, issues.spaceId),
      eq(chatEndpoints.assignedAgentId, issues.assigneeAgentId),
      eq(chatEndpoints.status, "active"),
    ))
    .where(and(eq(issues.spaceId, spaceId), inArray(issues.id, issueIds), eq(issues.status, "in_review")));
  // One review read and one publication read for every wait of the page, not
  // two reads per wait. Each wait gets the same inherited result as before.
  const inheritedWaits = await readInheritedGitHubReviewWaits(db, candidates.map(candidate => ({
    id: candidate.runId, spaceId, agentId: candidate.agentId, responsibleUserId: candidate.responsibleUserId,
    activeIdentityContextId: candidate.activeIdentityContextId, nativeIssueId: candidate.issueId,
    issueId: candidate.issueId, contextSnapshot: candidate.contextSnapshot,
  })));
  const authorizable = candidates.flatMap(({ runId, agentId, contextSnapshot, responsibleUserId: _user, activeIdentityContextId: _context, ...wait }, index) => {
    const inheritedWait = inheritedWaits[index];
    if (inheritedWait?.kind === "revoked") return [];
    return [{ wait, binding: { spaceId, issueId: wait.issueId, runId, agentId },
      contextSnapshot: inheritedWait?.context ?? contextSnapshot }];
  });
  // One authorization read for every wait of the page, not one per wait: the
  // per-wait reads each held a pool connection at the same moment.
  const authorized = await authorizeChatConversationsForBoundRuns(db, spaceId, authorizable);
  return authorizable.filter((_candidate, index) => authorized[index] !== null).map(({ wait }) => wait);
}

export type ExternalReviewWait = Awaited<ReturnType<typeof listExternalReviewWaits>>[number];
export type ExternalReviewWaitReader = (issueIds: string[]) => Promise<ExternalReviewWait[]>;

/** Share one space's wait reads between callers that serve one request.
 * Each issue's wait is independent of the other requested issues, so an issue
 * is read at most once. Do not keep a reader beyond its request. */
export function createExternalReviewWaitReader(db: Db, spaceId: string,
  list: typeof listExternalReviewWaits = listExternalReviewWaits): ExternalReviewWaitReader {
  const byIssueId = new Map<string, Promise<ExternalReviewWait | null>>();
  return async (issueIds) => {
    const requested = [...new Set(issueIds)];
    const missing = requested.filter(issueId => !byIssueId.has(issueId));
    if (missing.length) {
      const read = list(db, spaceId, missing)
        .then(waits => new Map(waits.map(wait => [wait.issueId, wait])));
      for (const issueId of missing) {
        byIssueId.set(issueId, read.then(waits => waits.get(issueId) ?? null));
      }
    }
    const waits = await Promise.all(requested.map(issueId => byIssueId.get(issueId)!));
    return waits.filter((wait): wait is ExternalReviewWait => wait !== null);
  };
}
