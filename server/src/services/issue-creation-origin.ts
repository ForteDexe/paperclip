import { sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { activityLog, heartbeatRuns, issues } from "@outpost/db";
import { isUuidLike } from "@outpost/shared";
import { unprocessable } from "../errors.js";

// The canonical text of a UUID. Only this form can equal `issues.id::text`.
const CANONICAL_UUID_PATTERN = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

/** Creation provenance is independent of the task's current parent or project. */
export function createdFromIssueCondition(spaceId: string, sourceIssueId: string) {
  if (!isUuidLike(sourceIssueId)) {
    throw unprocessable("createdFromIssueId must be a UUID");
  }
  const source = alias(issues, "creation_source_issue");
  const created = alias(issues, "creation_candidate_issue");
  // The source issue's runs, through heartbeat_runs_space_origin_issue_idx.
  const originatingRuns = sql`
    SELECT ${heartbeatRuns.id} FROM ${heartbeatRuns}
    INNER JOIN ${issues} AS ${source} ON ${source.id} = ${sourceIssueId}
      AND ${source.spaceId} = ${spaceId}
    WHERE ${heartbeatRuns.spaceId} = ${spaceId}
      AND coalesce(
        ${heartbeatRuns.nativeIssueId}::text,
        nullif(${heartbeatRuns.contextSnapshot}->>'issueId', ''),
        nullif(${heartbeatRuns.contextSnapshot}->>'taskId', ''),
        nullif(${heartbeatRuns.contextSnapshot}->>'taskKey', '')
      ) IN (${source.id}::text, ${source.identifier})
  `;
  // A recorded origin task wins; run and activity fallbacks apply only to rows
  // without one, so the list agrees with the detail's createdFrom.
  //
  // Each branch starts from an index (origin task, source runs, run activity)
  // so the list reads only the created tasks. An OR over the list's own rows
  // would test every task of the space, with the list's other per-row
  // conditions, before it could exclude one.
  return sql<boolean>`
    ${issues.id} <> ${sourceIssueId}
    AND ${issues.id} IN (
      SELECT ${created.id} FROM ${issues} AS ${created}
      WHERE ${created.spaceId} = ${spaceId}
        AND ${created.originIssueId} = ${sourceIssueId}
      UNION ALL
      SELECT ${created.id} FROM ${issues} AS ${created}
      WHERE ${created.spaceId} = ${spaceId}
        -- The predicate of issues_space_legacy_origin_run_idx.
        AND ${created.originIssueId} is null and ${created.originRunId} is not null
        AND ${created.originRunId} IN (SELECT source_run.id::text FROM (${originatingRuns}) AS source_run)
      UNION ALL
      SELECT ${created.id} FROM ${activityLog}
      INNER JOIN ${issues} AS ${created}
        ON ${created.id} = CASE WHEN ${activityLog.entityId} ~ ${CANONICAL_UUID_PATTERN}
          THEN ${activityLog.entityId}::uuid END
        AND ${created.id}::text = ${activityLog.entityId}
      WHERE ${activityLog.spaceId} = ${spaceId}
        AND ${activityLog.entityType} = 'issue'
        AND ${activityLog.action} IN ('issue.created', 'issue.child_created')
        AND ${activityLog.runId} IN (SELECT source_run.id FROM (${originatingRuns}) AS source_run)
        AND ${created.spaceId} = ${spaceId}
        AND ${created.originIssueId} IS NULL
        AND ${created.originRunId} IS NULL
    )
  `;
}
