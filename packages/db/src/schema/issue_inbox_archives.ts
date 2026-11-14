import { sql } from "drizzle-orm";
import { check, pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { spaces } from "./spaces.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { issues } from "./issues.js";

export const issueInboxArchives = pgTable(
  "issue_inbox_archives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull().references(() => spaces.id),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    archivedByActorType: text("archived_by_actor_type").$type<"user" | "agent">().notNull().default("user"),
    // Agent-attributed writes must set both IDs; SET NULL preserves rows if referenced records are deleted.
    archivedByAgentId: uuid("archived_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    archivedByRunId: uuid("archived_by_run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
    archivedAt: timestamp("archived_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    spaceIssueIdx: index("issue_inbox_archives_space_issue_idx").on(table.spaceId, table.issueId),
    spaceUserIdx: index("issue_inbox_archives_space_user_idx").on(table.spaceId, table.userId),
    spaceIssueUserUnique: uniqueIndex("issue_inbox_archives_space_issue_user_idx").on(
      table.spaceId,
      table.issueId,
      table.userId,
    ),
    archivedByActorTypeCheck: check(
      "issue_inbox_archives_archived_by_actor_type_check",
      sql`${table.archivedByActorType} in ('user', 'agent')`,
    ),
  }),
);
