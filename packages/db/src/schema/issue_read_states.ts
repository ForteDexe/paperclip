import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { spaces } from "./spaces.js";
import { issues } from "./issues.js";

export const issueReadStates = pgTable(
  "issue_read_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull().references(() => spaces.id),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    spaceIssueIdx: index("issue_read_states_space_issue_idx").on(table.spaceId, table.issueId),
    spaceUserIdx: index("issue_read_states_space_user_idx").on(table.spaceId, table.userId),
    spaceIssueUserUnique: uniqueIndex("issue_read_states_space_issue_user_idx").on(
      table.spaceId,
      table.issueId,
      table.userId,
    ),
  }),
);
