import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { spaces } from "./spaces.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { issues } from "./issues.js";

export const issueWatchdogs = pgTable(
  "issue_watchdogs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    watchdogAgentId: uuid("watchdog_agent_id").notNull().references(() => agents.id),
    instructions: text("instructions"),
    status: text("status").notNull().default("active"),
    watchdogIssueId: uuid("watchdog_issue_id").references(() => issues.id, { onDelete: "set null" }),
    lastObservedFingerprint: text("last_observed_fingerprint"),
    lastReviewedFingerprint: text("last_reviewed_fingerprint"),
    lastObservedStopSnapshot: jsonb("last_observed_stop_snapshot"),
    lastReviewedStopSnapshot: jsonb("last_reviewed_stop_snapshot"),
    lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true }),
    lastCompletedAt: timestamp("last_completed_at", { withTimezone: true }),
    triggerCount: integer("trigger_count").notNull().default(0),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdByUserId: text("created_by_user_id"),
    createdByRunId: uuid("created_by_run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
    updatedByAgentId: uuid("updated_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    updatedByUserId: text("updated_by_user_id"),
    updatedByRunId: uuid("updated_by_run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    spaceIssueIdx: uniqueIndex("issue_watchdogs_space_issue_uq").on(table.spaceId, table.issueId),
    spaceStatusIdx: index("issue_watchdogs_space_status_idx").on(table.spaceId, table.status),
    spaceAgentIdx: index("issue_watchdogs_space_agent_idx").on(table.spaceId, table.watchdogAgentId),
    spaceWatchdogIssueIdx: uniqueIndex("issue_watchdogs_space_watchdog_issue_uq")
      .on(table.spaceId, table.watchdogIssueId)
      .where(sql`${table.watchdogIssueId} is not null`),
  }),
);
