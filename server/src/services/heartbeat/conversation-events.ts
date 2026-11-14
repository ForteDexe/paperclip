import { getTableColumns, sql } from "drizzle-orm";
import { heartbeatRunEvents } from "@outpost/db";

function planWriteCondition(runId: string) {
  return sql`(${heartbeatRunEvents.eventType} = 'item.completed'
      and ${heartbeatRunEvents.payload} #>> '{orpEvent,sourceKind}' = 'runner'
      and ${heartbeatRunEvents.payload} #>> '{orpEvent,schema}' = 'outpost.orp.event.v1'
      and ${heartbeatRunEvents.payload} #>> '{orpEvent,payload,item,type}' = 'tool_result'
      and coalesce(${heartbeatRunEvents.payload} #>> '{orpEvent,payload,item,isError}', ${heartbeatRunEvents.payload} #>> '{orpEvent,payload,item,is_error}', 'false') = 'false'
      and ${heartbeatRunEvents.payload} #>> '{orpEvent,payload,item,result,disposition}' in ('applied', 'duplicate')
      and ${heartbeatRunEvents.payload} #>> '{orpEvent,payload,item,result,document,key}' = 'plan'
      and length(coalesce(${heartbeatRunEvents.payload} #>> '{orpEvent,payload,item,tool_use_id}', ${heartbeatRunEvents.payload} #>> '{orpEvent,payload,item,id}')) between 1 and 512
      and (
        coalesce(${heartbeatRunEvents.payload} #>> '{orpEvent,payload,item,tool_use_id}', ${heartbeatRunEvents.payload} #>> '{orpEvent,payload,item,id}'),
        coalesce(${heartbeatRunEvents.payload} #>> '{orpEvent,turnId}', ''),
        coalesce(${heartbeatRunEvents.payload} #>> '{orpEvent,normalizedSessionId}', ''),
        coalesce(${heartbeatRunEvents.payload} #>> '{orpEvent,sourceInstanceId}', '')
      ) in (
        select e.payload #>> '{orpEvent,payload,item,id}',
          coalesce(e.payload #>> '{orpEvent,turnId}', ''),
          coalesce(e.payload #>> '{orpEvent,normalizedSessionId}', ''),
          coalesce(e.payload #>> '{orpEvent,sourceInstanceId}', '')
        from heartbeat_run_events e
        where e.run_id = ${runId}
          and e.event_type = 'item.started'
          and e.payload #>> '{orpEvent,sourceKind}' = 'runner'
          and e.payload #>> '{orpEvent,schema}' = 'outpost.orp.event.v1'
          and e.payload #>> '{orpEvent,payload,item,type}' = 'tool_use'
          and e.payload #>> '{orpEvent,payload,item,name}' = 'write_document'
          and e.payload #>> '{orpEvent,payload,item,input,key}' = 'plan'
      ))`;
}

/**
 * Context readings of a run that compacted its context. The compaction divider
 * reads its "before → after" sizes from the readings around the compaction.
 * Runs that never compacted keep their usage out of the conversation view.
 */
function compactionUsageCondition(runId: string) {
  return sql`(${heartbeatRunEvents.eventType} = 'item.completed'
      and (${heartbeatRunEvents.payload} -> 'orpEvent' -> 'payload' ->> 'kind') = 'usage'
      and ${heartbeatRunEvents.payload} -> 'orpEvent' -> 'payload' -> 'usage' ? 'context'
      and exists (
        select 1 from heartbeat_run_events c
        where c.run_id = ${runId} and c.event_type = 'context.compacted'
      ))`;
}

/**
 * Canonical ORP conversation data, excluding ordinary historical tool activity.
 * Successful document writes retain a body-free boundary for saved Plan cards.
 * Keep request lifecycles so a cold open cannot hide a question or approval.
 * Keep MCP startup failures so a settled run still explains missing tools.
 * Keep context compactions, with their run's context readings, for the divider.
 * Item identity may occur on started/completed rather than each text delta.
 */
export function conversationEventCondition(runId: string) {
  return sql`(
    ${heartbeatRunEvents.eventType} like 'runtime_request.%'
    or (
      ${planWriteCondition(runId)}
    )
    or ${heartbeatRunEvents.eventType} in ('run.result.accepted', 'run.terminal', 'turn.completed', 'turn.failed', 'turn.cancelled', 'turn.interrupted')
    or (
      ${heartbeatRunEvents.eventType} = 'provider.notice.recorded'
      and ${heartbeatRunEvents.payload} #>> '{orpEvent,payload,category}' = 'mcp_server_startup_failed'
    )
    or ${heartbeatRunEvents.eventType} = 'context.compacted'
    or (
      ${compactionUsageCondition(runId)}
    )
    or (
      ${heartbeatRunEvents.eventType} in ('item.started', 'item.delta', 'item.completed')
      and (lower(replace(coalesce(${heartbeatRunEvents.payload} #>> '{orpEvent,payload,kind}', ${heartbeatRunEvents.payload} #>> '{orpEvent,payload,item,kind}', ${heartbeatRunEvents.payload} #>> '{orpEvent,payload,item,type}', ''), '_', '')) in ('agentmessage', 'assistantmessage')
      or coalesce(
        ${heartbeatRunEvents.payload} #>> '{orpEvent,itemId}',
        ${heartbeatRunEvents.payload} #>> '{orpEvent,payload,itemId}',
        ${heartbeatRunEvents.payload} #>> '{orpEvent,payload,item,id}',
        ${heartbeatRunEvents.payload} #>> '{orpEvent,payload,id}'
      ) in (
        select coalesce(e.payload #>> '{orpEvent,itemId}', e.payload #>> '{orpEvent,payload,itemId}', e.payload #>> '{orpEvent,payload,item,id}', e.payload #>> '{orpEvent,payload,id}')
        from heartbeat_run_events e
        where e.run_id = ${runId}
          and e.event_type in ('item.started', 'item.delta', 'item.completed')
          and lower(replace(coalesce(e.payload #>> '{orpEvent,payload,kind}', e.payload #>> '{orpEvent,payload,item,kind}', e.payload #>> '{orpEvent,payload,item,type}', ''), '_', '')) in ('agentmessage', 'assistantmessage')
      ))
    )
  )`;
}

/** Project Plan receipts inside PostgreSQL, before large tool bodies cross the wire. */
export function conversationEventColumns(runId: string) {
  const planReceipt = planWriteCondition(runId);
  const envelope = sql`${heartbeatRunEvents.payload} -> 'orpEvent'`;
  const item = sql`${heartbeatRunEvents.payload} #> '{orpEvent,payload,item}'`;
  const itemId = sql`coalesce(${item} ->> 'tool_use_id', ${item} ->> 'id')`;
  return {
    ...getTableColumns(heartbeatRunEvents),
    message: sql<string | null>`case when ${planReceipt} then null else ${heartbeatRunEvents.message} end`,
    payload: sql<Record<string, unknown> | null>`case when ${planReceipt} then
      jsonb_build_object('orpEvent', jsonb_strip_nulls(jsonb_build_object(
        'schema', ${envelope} -> 'schema',
        'sourceEventId', ${envelope} -> 'sourceEventId',
        'sourceSeq', ${envelope} -> 'sourceSeq',
        'sourceInstanceId', ${envelope} -> 'sourceInstanceId',
        'sourceKind', ${envelope} -> 'sourceKind',
        'runId', ${envelope} -> 'runId',
        'turnId', ${envelope} -> 'turnId',
        'itemId', ${envelope} -> 'itemId',
        'normalizedSessionId', ${envelope} -> 'normalizedSessionId',
        'eventType', ${envelope} -> 'eventType',
        'schemaVersion', ${envelope} -> 'schemaVersion',
        'priority', ${envelope} -> 'priority',
        'emittedAt', ${envelope} -> 'emittedAt',
        'payload', jsonb_build_object('kind', 'tool_result', 'item', jsonb_build_object(
          'id', ${itemId}, 'tool_use_id', ${itemId}, 'type', 'tool_result',
          'name', 'write_document', 'input', jsonb_build_object('key', 'plan'),
          'result', jsonb_build_object('disposition', ${item} #> '{result,disposition}',
            'document', jsonb_build_object('key', 'plan'))
        ))
      ))) else ${heartbeatRunEvents.payload} end`.mapWith(heartbeatRunEvents.payload),
  };
}
