import { notifyStatusCardIssueChange } from "./status-card-notifications.js";
import { notifyAttentionRetentionWork } from "./retention-work-notifications.js";
import { DELIVERY_QUEUES, notifyDeliveryWork } from "./delivery-work-notifications.js";
import { notifyExternalConversationSettlement } from "./external-conversation-settlement-notifications.js";
import { chatConversations, issues, type Db } from "@outpost/db";
import { and, eq, sql } from "drizzle-orm";

/** Read-only projection; External chat threads do not acquire Agent Chat identities. */
export function externalConversationStateSql() {
  return sql<"active" | "waiting" | null>`(
    select case when c.state = 'waiting' and "issues"."status" = 'in_review'
      and "issues"."execution_run_id" is null
      and "issues"."monitor_next_check_at" is null
      and coalesce("issues"."execution_state"->>'status', '') not in ('pending', 'changes_requested')
      and coalesce("issues"."execution_state"->'monitor'->>'status', '') not in ('scheduled', 'triggered')
      and not exists (select 1 from issue_thread_interactions i
        where i.space_id = c.space_id and i.issue_id = c.issue_id and i.status = 'pending')
      and not exists (select 1 from issue_approvals ia join approvals a on a.id = ia.approval_id and a.space_id = ia.space_id
        where ia.space_id = c.space_id and ia.issue_id = c.issue_id and a.status in ('pending', 'revision_requested'))
      and not exists (select 1 from chat_publications p
        where p.space_id = c.space_id and p.conversation_id = c.id
          and p.state in ('pending', 'streaming', 'retry', 'delivery_unknown', 'failed', 'awaiting_consent'))
      and not exists (select 1 from heartbeat_runs r where r.space_id = c.space_id
        and coalesce(r.context_snapshot->>'issueId', r.context_snapshot->>'taskId', r.native_issue_id::text) = c.issue_id::text
        and r.status in ('queued', 'running', 'scheduled_retry'))
      and not exists (select 1 from agent_wakeup_requests w where w.space_id = c.space_id
        and coalesce(w.payload->>'issueId', w.payload->>'taskId', w.payload->'_outpostWakeContext'->>'issueId') = c.issue_id::text
        and w.status in ('queued', 'claimed', 'deferred_issue_execution')
        and not exists (select 1 from heartbeat_runs owner where owner.id = w.run_id
          and owner.space_id = w.space_id and owner.status = 'succeeded'))
      and not exists (select 1 from agent_task_sessions session where session.space_id = c.space_id
        and session.task_key = c.issue_id::text and session.goal_status is not null and session.goal_status <> 'complete')
      and not exists (select 1 from issue_relations edge join issues blocker on blocker.id = edge.issue_id and blocker.space_id = edge.space_id
        where edge.space_id = c.space_id and edge.related_issue_id = c.issue_id and edge.type = 'blocks' and blocker.status <> 'done')
      then 'waiting' else 'active' end
    from chat_conversations c join chat_endpoints e on e.id = c.endpoint_id and e.space_id = c.space_id
    where c.space_id = "issues"."space_id" and c.issue_id = "issues"."id"
      and (e.provider = 'slack' or (e.provider = 'speko' and e.id::text = "issues"."origin_id")) and e.assigned_agent_id = "issues"."assignee_agent_id"
      and e.status in ('active', 'verifying') and c.state in ('active', 'waiting')
    order by c.created_at desc, c.id desc limit 1
  )`;
}

export function nonIdleSlackIssueCondition() {
  return sql`${externalConversationStateSql()} is distinct from 'waiting'`;
}

/** Called inside message admission while its transaction owns the issue lock. */
export async function resumeExternalConversation(tx: Db, spaceId: string, issueId: string) {
  await notifyAttentionRetentionWork(tx, { spaceId });
  await notifyDeliveryWork(tx, DELIVERY_QUEUES.agentTimers);
  await notifyExternalConversationSettlement(tx, { spaceId, issueId });
  // Only the verified idle convention may leave In Review automatically.
  // A real decision or delivery problem keeps the existing review semantics.
  await notifyStatusCardIssueChange(tx, spaceId);
  await tx.update(issues).set({ status: "todo", updatedAt: new Date() })
    .where(and(eq(issues.spaceId, spaceId), eq(issues.id, issueId),
      sql`${externalConversationStateSql()} = 'waiting'`));
  await tx.update(chatConversations).set({ state: "active", updatedAt: new Date() })
    .where(and(eq(chatConversations.spaceId, spaceId), eq(chatConversations.issueId, issueId),
      eq(chatConversations.state, "waiting"), sql`exists (select 1 from chat_endpoints e
        where e.id = ${chatConversations.endpointId} and e.space_id = ${chatConversations.spaceId} and e.provider in ('slack', 'speko'))`));
}

/** Compatibility name for existing Slack callers. */
export const resumeSlackConversation = resumeExternalConversation;
