import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { spaces } from "./spaces.js";
import { issues } from "./issues.js";

export const issueRelations = pgTable(
  "issue_relations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull().references(() => spaces.id),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    relatedIssueId: uuid("related_issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    type: text("type").$type<"blocks">().notNull(),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    spaceIssueIdx: index("issue_relations_space_issue_idx").on(table.spaceId, table.issueId),
    spaceRelatedIssueIdx: index("issue_relations_space_related_issue_idx").on(table.spaceId, table.relatedIssueId),
    spaceTypeIdx: index("issue_relations_space_type_idx").on(table.spaceId, table.type),
    spaceEdgeUq: uniqueIndex("issue_relations_space_edge_uq").on(
      table.spaceId,
      table.issueId,
      table.relatedIssueId,
      table.type,
    ),
  }),
);
