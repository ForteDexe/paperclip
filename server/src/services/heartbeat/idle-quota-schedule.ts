import { finishedIdleRun, finishedIdleWake } from "../idle-work-proof.js";
import { agents, agentWakeupRequests, spaces, heartbeatRuns, issues, type Db } from "@outpost/db";
import { PROVIDER_QUOTA_MONITOR_SERVICE_NAME, issueExecutionMonitorPolicySchema, issueExecutionPolicySchema } from "@outpost/shared";
import { eq, sql } from "drizzle-orm";
import type { DeadlineReconciliationSnapshot } from "../deadline-reconciliation.js";
import { idleDeadlineRowLimit, isFutureIdleDeadline, type IdleDeadlineSnapshot, type IdleIssueWait } from "../idle-deadline-types.js";
import { parseIssueExecutionState } from "../issue-execution-policy.js";

export interface IdleQuotaSchedule extends IdleDeadlineSnapshot { issueWaits: IdleIssueWait[] }

export async function readIdleQuotaSchedule(tx: Pick<Db, "select">, now: number,
  owner: () => DeadlineReconciliationSnapshot): Promise<IdleQuotaSchedule> {
  const before = owner();
  const state: unknown[] = [before];
  const blocked = (): IdleQuotaSchedule => ({ blocked: true, state, deadlines: [], issueWaits: [] });
  if (!before.reconciled) return blocked();
  const rows = await tx.select({ issue: {
    id: issues.id, spaceId: issues.spaceId, assigneeAgentId: issues.assigneeAgentId, assigneeUserId: issues.assigneeUserId,
    status: issues.status, monitorNextCheckAt: issues.monitorNextCheckAt, monitorWakeRequestedAt: issues.monitorWakeRequestedAt,
    monitorAttemptCount: issues.monitorAttemptCount, executionRunId: issues.executionRunId, checkoutRunId: issues.checkoutRunId,
    hiddenAt: issues.hiddenAt, conversationAgentId: issues.conversationAgentId, executionState: issues.executionState,
    executionPolicy: sql<Record<string, unknown>>`jsonb_build_object('monitor', ${issues.executionPolicy}->'monitor', 'stages', coalesce(${issues.executionPolicy}->'stages', '[]'::jsonb))`,
    revision: sql<string>`${issues}.xmin::text`,
  }, source: { id: heartbeatRuns.id, spaceId: heartbeatRuns.spaceId, agentId: heartbeatRuns.agentId,
    contextSnapshot: sql<Record<string, unknown>>`jsonb_build_object('issueId', ${heartbeatRuns.contextSnapshot}->'issueId')`,
    status: heartbeatRuns.status, finishedAt: heartbeatRuns.finishedAt, runtimeMode: heartbeatRuns.runtimeMode,
    costAccountingPending: heartbeatRuns.costAccountingPending, revision: sql<string>`${heartbeatRuns}.xmin::text`,
  }, target: { id: agents.id, spaceId: agents.spaceId, status: agents.status, revision: sql<string>`${agents}.xmin::text` },
    space: { id: spaces.id, status: spaces.status, revision: sql<string>`${spaces}.xmin::text` } }).from(issues)
    .leftJoin(heartbeatRuns, andSource())
    .leftJoin(agents, eq(agents.id, heartbeatRuns.agentId))
    .leftJoin(spaces, eq(spaces.id, issues.spaceId))
    .where(sql`${issues.executionPolicy}#>>'{monitor,serviceName}' = ${PROVIDER_QUOTA_MONITOR_SERVICE_NAME}`)
    .orderBy(issues.id).limit(idleDeadlineRowLimit + 1);
  state.push(rows);
  if (rows.length > idleDeadlineRowLimit) return blocked();
  const deadlines: number[] = [], issueWaits: IdleIssueWait[] = [];
  const terminal: { issueId: string; spaceId: string; sourceId: string }[] = [];
  for (const { issue, source, target, space } of rows) {
    const policy = issueExecutionMonitorPolicySchema.safeParse(issue.executionPolicy?.monitor);
    const execution = parseIssueExecutionState(issue.executionState);
    const participant = execution?.status === "pending" ? execution.currentParticipant : null;
    const parsedPolicy = issueExecutionPolicySchema.safeParse(issue.executionPolicy);
    if (!parsedPolicy.success || (issue.executionState !== null && !execution)) return blocked();
    if (["done", "cancelled"].includes(issue.status)) {
      if (!policy.success || issue.monitorWakeRequestedAt || issue.executionRunId || issue.checkoutRunId || issue.conversationAgentId
        || (execution && (execution.status !== "idle" || execution.currentStageId !== null
          || execution.currentStageType !== null || execution.currentStageIndex !== null || execution.currentParticipant !== null))
        || !Number.isSafeInteger(issue.monitorAttemptCount) || issue.monitorAttemptCount < 0
        || (issue.monitorNextCheckAt !== null && (!Number.isFinite(issue.monitorNextCheckAt.getTime())
          || issue.monitorNextCheckAt.getTime() !== Date.parse(policy.data.nextCheckAt)))
        || !source || policy.data.externalRef !== source.id || source.spaceId !== issue.spaceId
        || source.contextSnapshot?.issueId !== issue.id || source.runtimeMode === "native"
        || !["failed", "timed_out", "interrupted", "cancelled"].includes(source.status) || !source.finishedAt || source.costAccountingPending)
        return blocked();
      terminal.push({ issueId: issue.id, spaceId: issue.spaceId, sourceId: source.id });
      continue;
    }
    if (issue.status === "in_progress" && execution && execution.status !== "idle") return blocked();
    if (issue.status === "in_review") {
      const stage = parsedPolicy.data.stages.find(stage => stage.id === execution?.currentStageId);
      if (!execution || execution.status !== "pending" || execution.currentStageType !== "review"
        || !stage || stage.type !== "review" || participant?.type !== "agent"
        || !stage.participants.some(candidate => candidate.type === "agent" && candidate.agentId === participant.agentId)) return blocked();
    }
    const targetId = issue.status === "in_review" ? participant?.type === "agent" ? participant.agentId : null : issue.assigneeAgentId;
    const at = issue.monitorNextCheckAt?.getTime() ?? NaN;
    if (!policy.success || !isFutureIdleDeadline(at, now) || Date.parse(policy.data.nextCheckAt) !== at
      || issue.monitorWakeRequestedAt || !["in_progress", "in_review"].includes(issue.status) || issue.assigneeUserId
      || issue.hiddenAt || issue.executionRunId || issue.checkoutRunId || issue.conversationAgentId
      || !Number.isSafeInteger(issue.monitorAttemptCount) || issue.monitorAttemptCount < 0
      || (policy.data.timeoutAt && Date.parse(policy.data.timeoutAt) <= at)
      || (policy.data.maxAttempts !== null && issue.monitorAttemptCount >= policy.data.maxAttempts)
      || !source || source.spaceId !== issue.spaceId || source.agentId !== targetId
      || policy.data.externalRef !== source.id || source.contextSnapshot?.issueId !== issue.id || source.runtimeMode === "native"
      || !["failed", "timed_out", "interrupted", "cancelled"].includes(source.status) || !source.finishedAt
      || source.costAccountingPending || !target || target.id !== source.agentId || target.spaceId !== issue.spaceId
      || !["idle", "active", "error"].includes(target.status) || !space || space.status !== "active") return blocked();
    deadlines.push(at); issueWaits.push({ kind: "provider_quota", issueId: issue.id, sourceRunId: source.id, targetAgentId: source.agentId, reviewer: issue.status === "in_review" });
  }
  if (terminal.length) {
    const uuidArray = (values: string[]) => sql`${`{${values.join(",")}}`}::uuid[]`;
    const bindings = sql`unnest(${uuidArray(terminal.map(row => row.issueId))},
      ${uuidArray(terminal.map(row => row.spaceId))}, ${uuidArray(terminal.map(row => row.sourceId))})
      AS terminal_scope(issue_id, space_id, source_id)`;
    const pendingRuns = await tx.select({ id: heartbeatRuns.id }).from(heartbeatRuns).where(sql`
      (${sql.raw(finishedIdleRun("heartbeat_runs"))}) IS NOT TRUE AND EXISTS (
        SELECT 1 FROM ${bindings} WHERE terminal_scope.space_id = ${heartbeatRuns.spaceId}
          AND (terminal_scope.issue_id = ${heartbeatRuns.issueId} OR terminal_scope.issue_id = ${heartbeatRuns.nativeIssueId}
            OR terminal_scope.source_id = ${heartbeatRuns.id}
            OR terminal_scope.issue_id::text = ${heartbeatRuns.contextSnapshot}->>'issueId'
            OR terminal_scope.issue_id::text = ${heartbeatRuns.contextSnapshot}->>'taskId')
      )`).limit(1);
    const pendingWakes = await tx.select({ id: agentWakeupRequests.id }).from(agentWakeupRequests).where(sql`
      (${sql.raw(finishedIdleWake("agent_wakeup_requests"))}) IS NOT TRUE AND EXISTS (
        SELECT 1 FROM ${bindings} WHERE terminal_scope.space_id = ${agentWakeupRequests.spaceId}
          AND (terminal_scope.issue_id::text = ${agentWakeupRequests.payload}->>'issueId'
            OR terminal_scope.issue_id::text = ${agentWakeupRequests.payload}->>'taskId'
            OR terminal_scope.issue_id::text = ${agentWakeupRequests.payload}->'_outpostWakeContext'->>'issueId'
            OR terminal_scope.issue_id::text = ${agentWakeupRequests.payload}->'_outpostWakeContext'->>'taskId'
            OR ${agentWakeupRequests.runId} IN (SELECT r.id FROM heartbeat_runs r
              WHERE r.space_id = ${agentWakeupRequests.spaceId}
                AND (r.issue_id = terminal_scope.issue_id OR r.native_issue_id = terminal_scope.issue_id
                  OR r.id = terminal_scope.source_id OR r.context_snapshot->>'issueId' = terminal_scope.issue_id::text
                  OR r.context_snapshot->>'taskId' = terminal_scope.issue_id::text)))
      )`).limit(1);
    state.push({ pendingRuns, pendingWakes });
    if (pendingRuns.length || pendingWakes.length) return blocked();
  }
  const after = owner();
  if (!after.reconciled || before.revision !== after.revision) return blocked();
  return { blocked: false, state, deadlines, issueWaits };
}
function andSource() {
  const externalRef = sql`${issues.executionPolicy}#>>'{monitor,externalRef}'`;
  return sql`${heartbeatRuns.id} = CASE
    WHEN ${externalRef} ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN (${externalRef})::uuid ELSE NULL END
    AND ${heartbeatRuns.spaceId} = ${issues.spaceId}`;
}
