import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { spaces } from "./spaces.js";
import { agents } from "./agents.js";
import { heartbeatRuns } from "./heartbeat_runs.js";

export const activityLog = pgTable(
  "activity_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull().references(() => spaces.id),
    actorType: text("actor_type").notNull().default("system"),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    agentId: uuid("agent_id").references(() => agents.id),
    runId: uuid("run_id").references(() => heartbeatRuns.id),
    responsibleUserId: text("responsible_user_id"),
    details: jsonb("details").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    spaceCreatedIdx: index("activity_log_space_created_idx").on(table.spaceId, table.createdAt),
    spaceAgentCreatedIdx: index("activity_log_space_agent_created_idx").on(
      table.spaceId,
      table.agentId,
      table.createdAt,
    ),
    spaceResponsibleUserCreatedIdx: index("activity_log_space_responsible_user_created_idx").on(
      table.spaceId,
      table.responsibleUserId,
      table.createdAt,
    ),
    runIdIdx: index("activity_log_run_id_idx").on(table.runId),
    entityIdx: index("activity_log_entity_type_id_idx").on(table.entityType, table.entityId),
    spaceEntityCreatedIdx: index("activity_log_space_entity_created_idx").on(
      table.spaceId,
      table.entityType,
      table.entityId,
      table.createdAt,
    ),
    spaceUserIssueActorIdx: index("activity_log_space_user_issue_actor_idx")
      .on(table.spaceId, table.actorId, table.entityId)
      .where(sql`${table.actorType} = 'user' AND ${table.entityType} = 'issue'`),
  }),
);
