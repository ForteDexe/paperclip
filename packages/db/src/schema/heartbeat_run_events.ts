import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  index,
  bigserial,
  bigint,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { spaces } from "./spaces.js";
import { agents } from "./agents.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { runEventPayload } from "../run-event-payload.js";

export const heartbeatRunEvents = pgTable(
  "heartbeat_run_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    spaceId: uuid("space_id").notNull().references(() => spaces.id),
    runId: uuid("run_id").notNull().references(() => heartbeatRuns.id),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    seq: bigint("seq", { mode: "number" }).notNull(),
    eventType: text("event_type").notNull(),
    stream: text("stream"),
    level: text("level"),
    color: text("color"),
    message: text("message"),
    payload: runEventPayload("payload"),
    sourceInstanceId: text("source_instance_id"),
    sourceEventId: text("source_event_id"),
    sourceSeq: bigint("source_seq", { mode: "number" }),
    sourcePayloadSha256: text("source_payload_sha256"),
    protocolSchemaVersion: integer("protocol_schema_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    runSeqUq: uniqueIndex("heartbeat_run_events_run_seq_uq").on(table.runId, table.seq),
    runSourceEventUq: uniqueIndex("heartbeat_run_events_run_source_event_uq")
      .on(table.runId, table.sourceEventId)
      .where(sql`${table.sourceEventId} is not null`),
    runSourceSeqUq: uniqueIndex("heartbeat_run_events_run_source_seq_uq")
      .on(table.runId, table.sourceInstanceId, table.sourceSeq)
      .where(sql`${table.sourceInstanceId} is not null and ${table.sourceSeq} is not null`),
    spaceRunIdx: index("heartbeat_run_events_space_run_idx").on(table.spaceId, table.runId),
    spaceCreatedIdx: index("heartbeat_run_events_space_created_idx").on(table.spaceId, table.createdAt),
    // Context-window readings: the few usage items per run, newest first.
    usageItemRunIdx: index("heartbeat_run_events_usage_item_run_idx")
      .on(table.runId, table.createdAt)
      .where(sql`${table.eventType} = 'item.completed' and (${table.payload} -> 'orpEvent' -> 'payload' ->> 'kind') = 'usage'`),
    // Compactions counted per agent session across runs.
    compactionSessionIdx: index("heartbeat_run_events_compaction_session_idx")
      .on(table.spaceId, sql`(${table.payload} -> 'orpEvent' ->> 'normalizedSessionId')`)
      .where(sql`${table.eventType} = 'context.compacted'`),
    // Retry-exhaustion receipts for the attention feed: a few rows per space.
    // The predicate must stay textually equal to the query in
    // server/src/services/attention-exhausted-runs.ts so the planner can use it.
    retryExhaustedIdx: index("heartbeat_run_events_retry_exhausted_idx")
      .on(table.spaceId, table.runId, table.id.desc())
      .where(sql`${table.eventType} = 'lifecycle' and ${table.message} like 'Bounded retry exhausted%'`)
      .concurrently(),
  }),
);
