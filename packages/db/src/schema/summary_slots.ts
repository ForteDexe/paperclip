import { index, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { SummarySlotKey, SummarySlotScopeKind, SummarySlotStatus } from "@outpost/shared";
import { agents } from "./agents.js";
import { spaces } from "./spaces.js";
import { documents } from "./documents.js";
import { issues } from "./issues.js";

export const summarySlots = pgTable(
  "summary_slots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
    scopeKind: text("scope_kind").$type<SummarySlotScopeKind>().notNull(),
    scopeId: uuid("scope_id"),
    slotKey: text("slot_key").$type<SummarySlotKey>().notNull(),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    status: text("status").$type<SummarySlotStatus>().notNull().default("idle"),
    failureReason: text("failure_reason"),
    generatingIssueId: uuid("generating_issue_id").references(() => issues.id, { onDelete: "set null" }),
    lastGeneratedAt: timestamp("last_generated_at", { withTimezone: true }),
    lastGeneratedByAgentId: uuid("last_generated_by_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    lastModel: text("last_model"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    spaceScopeSlotUq: unique("summary_slots_space_scope_slot_uq")
      .on(table.spaceId, table.scopeKind, table.scopeId, table.slotKey)
      .nullsNotDistinct(),
    documentUq: uniqueIndex("summary_slots_document_uq").on(table.documentId),
    spaceScopeIdx: index("summary_slots_space_scope_idx").on(table.spaceId, table.scopeKind, table.scopeId),
    spaceGeneratingIssueIdx: index("summary_slots_space_generating_issue_idx").on(
      table.spaceId,
      table.generatingIssueId,
    ),
    spaceUpdatedIdx: index("summary_slots_space_updated_idx").on(table.spaceId, table.updatedAt),
  }),
);
