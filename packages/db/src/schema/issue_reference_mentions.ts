import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { spaces } from "./spaces.js";
import { issues } from "./issues.js";

export const issueReferenceMentions = pgTable(
  "issue_reference_mentions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull().references(() => spaces.id),
    sourceIssueId: uuid("source_issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    targetIssueId: uuid("target_issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    sourceKind: text("source_kind").$type<"title" | "description" | "comment" | "document">().notNull(),
    sourceRecordId: uuid("source_record_id"),
    documentKey: text("document_key"),
    matchedText: text("matched_text"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    spaceSourceIssueIdx: index("issue_reference_mentions_space_source_issue_idx").on(
      table.spaceId,
      table.sourceIssueId,
    ),
    spaceTargetIssueIdx: index("issue_reference_mentions_space_target_issue_idx").on(
      table.spaceId,
      table.targetIssueId,
    ),
    spaceIssuePairIdx: index("issue_reference_mentions_space_issue_pair_idx").on(
      table.spaceId,
      table.sourceIssueId,
      table.targetIssueId,
    ),
    spaceSourceMentionWithRecordUq: uniqueIndex("issue_reference_mentions_space_source_mention_record_uq").on(
      table.spaceId,
      table.sourceIssueId,
      table.targetIssueId,
      table.sourceKind,
      table.sourceRecordId,
    ).where(sql`${table.sourceRecordId} is not null`),
    spaceSourceMentionWithoutRecordUq: uniqueIndex("issue_reference_mentions_space_source_mention_null_record_uq").on(
      table.spaceId,
      table.sourceIssueId,
      table.targetIssueId,
      table.sourceKind,
    ).where(sql`${table.sourceRecordId} is null`),
  }),
);
