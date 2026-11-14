import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@outpost/db";
import { activityLog, agents, heartbeatRuns, issues } from "@outpost/db";
import { isUuidLike } from "@outpost/shared";

type IssueRow = typeof issues.$inferSelect;
type HeartbeatRunRow = typeof heartbeatRuns.$inferSelect;
type CreationSourceRun = Pick<HeartbeatRunRow, "id" | "spaceId" | "agentId" | "scopeKind" | "nativeIssueId" | "issueId"> & {
  contextSnapshot: { issueId: unknown; taskId: unknown; taskKey: unknown; outpostIssue: { id: unknown } } | null;
};

/** The task that created another task, and the run that did so when one did. */
export interface IssueCreationSourceRecord {
  run: CreationSourceRun | null;
  sourceIssue: IssueRow;
}

const CREATION_ACTIVITY_ACTIONS = ["issue.created", "issue.child_created"];

/** The route supplies a fresh UUID; a different returned issue is reused. */
export function childCreatedByRequest(proposedIssueId: string, returnedIssueId: string) {
  return proposedIssueId === returnedIssueId;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * The issue a heartbeat run is bound to: native run identity first, then the
 * run's issue scope, then the persisted legacy task context. Returns a UUID or
 * an issue identifier such as `PAP-168`; the caller resolves identifiers.
 */
export function runBoundIssueReference(run: Pick<HeartbeatRunRow, "nativeIssueId" | "issueId" | "contextSnapshot">): string | null {
  const context = run.contextSnapshot && typeof run.contextSnapshot === "object"
    ? (run.contextSnapshot as Record<string, unknown>)
    : null;
  const outpostIssue = context?.outpostIssue && typeof context.outpostIssue === "object"
    ? (context.outpostIssue as Record<string, unknown>)
    : null;
  return (
    run.nativeIssueId ??
    run.issueId ??
    readNonEmptyString(context?.issueId) ??
    readNonEmptyString(context?.taskId) ??
    readNonEmptyString(outpostIssue?.id) ??
    readNonEmptyString(context?.taskKey)
  );
}

/** Loads the run's bound issue within the run's space, or null. */
export async function loadRunBoundIssue(
  db: Db,
  run: Pick<HeartbeatRunRow, "spaceId" | "nativeIssueId" | "issueId" | "contextSnapshot">,
): Promise<IssueRow | null> {
  const reference = runBoundIssueReference(run);
  if (!reference) return null;
  const condition = isUuidLike(reference)
    ? eq(issues.id, reference)
    : eq(issues.identifier, reference);
  const [issue] = await db
    .select()
    .from(issues)
    .where(and(condition, eq(issues.spaceId, run.spaceId)))
    .limit(1);
  return issue ?? null;
}

/**
 * Resolves the task from which an issue was created. The recorded
 * `origin_issue_id` wins; otherwise the task the origin run (or, for historical
 * rows, the run on the creation activity) was executing. Space-scoped; a run
 * or source task from another space never resolves. Does not check viewer
 * access.
 */
export async function resolveIssueCreationSource(
  db: Db,
  issue: Pick<IssueRow, "id" | "spaceId" | "originRunId"> & { originIssueId?: string | null },
): Promise<IssueCreationSourceRecord | null> {
  const run = await loadIssueCreationRun(db, issue);
  if (issue.originIssueId && issue.originIssueId !== issue.id) {
    const [sourceIssue] = await db
      .select()
      .from(issues)
      .where(and(eq(issues.id, issue.originIssueId), eq(issues.spaceId, issue.spaceId)))
      .limit(1);
    if (sourceIssue) return { run, sourceIssue };
  }
  if (!run) return null;
  const sourceIssue = await loadRunBoundIssue(db, run);
  if (!sourceIssue || sourceIssue.id === issue.id) return null;
  return { run, sourceIssue };
}

async function loadIssueCreationRun(
  db: Db,
  issue: Pick<IssueRow, "id" | "spaceId" | "originRunId">,
): Promise<CreationSourceRun | null> {
  let runId = issue.originRunId;
  if (!runId) {
    const [creation] = await db
      .select({ runId: activityLog.runId })
      .from(activityLog)
      .where(and(
        eq(activityLog.spaceId, issue.spaceId),
        eq(activityLog.entityType, "issue"),
        eq(activityLog.entityId, issue.id),
        inArray(activityLog.action, CREATION_ACTIVITY_ACTIONS),
        isNotNull(activityLog.runId),
      ))
      .orderBy(asc(activityLog.createdAt))
      .limit(1);
    runId = creation?.runId ?? null;
  }
  if (!runId || !isUuidLike(runId)) return null;
  const [run] = await db
    .select({
      id: heartbeatRuns.id,
      spaceId: heartbeatRuns.spaceId,
      agentId: heartbeatRuns.agentId,
      scopeKind: heartbeatRuns.scopeKind,
      nativeIssueId: heartbeatRuns.nativeIssueId,
      issueId: heartbeatRuns.issueId,
      contextSnapshot: sql<CreationSourceRun["contextSnapshot"]>`case
        when coalesce(${heartbeatRuns.nativeIssueId}, ${heartbeatRuns.issueId}) is not null then null
        else jsonb_build_object(
          'issueId', ${heartbeatRuns.contextSnapshot}->'issueId',
          'taskId', ${heartbeatRuns.contextSnapshot}->'taskId',
          'taskKey', ${heartbeatRuns.contextSnapshot}->'taskKey',
          'outpostIssue', jsonb_build_object('id', ${heartbeatRuns.contextSnapshot}->'outpostIssue'->'id')
        ) end`,
    })
    .from(heartbeatRuns)
    .where(and(eq(heartbeatRuns.id, runId), eq(heartbeatRuns.spaceId, issue.spaceId)))
    .limit(1);
  return run ?? null;
}

/** Space-scoped agent summary for a creation source. */
export async function loadCreationSourceAgent(
  db: Db,
  spaceId: string,
  agentId: string,
): Promise<{ id: string; name: string } | null> {
  const [agent] = await db
    .select({ id: agents.id, name: agents.name })
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.spaceId, spaceId)))
    .limit(1);
  return agent ?? null;
}
