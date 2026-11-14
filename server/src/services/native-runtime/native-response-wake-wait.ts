import { and, eq, isNull, sql } from "drizzle-orm";
import {
  heartbeatRuns,
  issueComments,
  issues,
  nativeRunFinalizations,
  statusDecisions,
  type Db,
} from "@outpost/db";
import { NATIVE_RESPONSE_WAKE_WAITING_REASON } from "./status-arbiter.js";

type Binding = {
  spaceId: string;
  issueId: string;
  runId: string;
  agentId: string;
};

export async function hasCommittedNativeResponseWakeWait(
  db: Db,
  binding: Binding,
): Promise<boolean> {
  const [wait] = await db
    .select({ runStartedAt: heartbeatRuns.startedAt })
    .from(nativeRunFinalizations)
    .innerJoin(
      statusDecisions,
      and(
        eq(statusDecisions.id, nativeRunFinalizations.decisionId),
        eq(statusDecisions.spaceId, binding.spaceId),
        eq(statusDecisions.issueId, binding.issueId),
        eq(statusDecisions.runId, binding.runId),
        eq(statusDecisions.applicationState, "applied"),
        eq(statusDecisions.reasonCode, NATIVE_RESPONSE_WAKE_WAITING_REASON),
      ),
    )
    .innerJoin(
      heartbeatRuns,
      and(
        eq(heartbeatRuns.id, binding.runId),
        eq(heartbeatRuns.spaceId, binding.spaceId),
        eq(heartbeatRuns.agentId, binding.agentId),
        eq(heartbeatRuns.nativeIssueId, binding.issueId),
        eq(heartbeatRuns.runtimeMode, "native"),
        eq(heartbeatRuns.status, "succeeded"),
      ),
    )
    .innerJoin(
      issues,
      and(
        eq(issues.id, binding.issueId),
        eq(issues.spaceId, binding.spaceId),
        eq(issues.assigneeAgentId, binding.agentId),
        eq(issues.status, "in_progress"),
        eq(issues.lastStatusDecisionId, statusDecisions.id),
        isNull(issues.assigneeUserId),
        isNull(issues.hiddenAt),
      ),
    )
    .where(
      and(
        eq(nativeRunFinalizations.spaceId, binding.spaceId),
        eq(nativeRunFinalizations.issueId, binding.issueId),
        eq(nativeRunFinalizations.runId, binding.runId),
        eq(nativeRunFinalizations.phase, "committed"),
      ),
    )
    .limit(1);
  if (!wait?.runStartedAt) return false;
  const [unanswered] = await db
    .select({ id: issueComments.id })
    .from(issueComments)
    .where(
      and(
        eq(issueComments.spaceId, binding.spaceId),
        eq(issueComments.issueId, binding.issueId),
        eq(issueComments.authorType, "user"),
        isNull(issueComments.createdByRunId),
        isNull(issueComments.deletedAt),
        sql`${issueComments.createdAt} > ${wait.runStartedAt.toISOString()}::timestamptz`,
      ),
    )
    .limit(1);
  return !unanswered;
}
