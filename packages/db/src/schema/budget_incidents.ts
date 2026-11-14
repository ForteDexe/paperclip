import { sql } from "drizzle-orm";
import { numeric, index, integer, pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { approvals } from "./approvals.js";
import { budgetPolicies } from "./budget_policies.js";
import { spaces } from "./spaces.js";

export const budgetIncidents = pgTable(
  "budget_incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull().references(() => spaces.id),
    policyId: uuid("policy_id").notNull().references(() => budgetPolicies.id),
    scopeType: text("scope_type").notNull(),
    scopeId: uuid("scope_id").notNull(),
    metric: text("metric").notNull(),
    windowKind: text("window_kind").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
    thresholdType: text("threshold_type").notNull(),
    amountLimit: integer("amount_limit").notNull(),
    amountObserved: numeric("amount_observed", { precision: 24, scale: 7, mode: "number" }).notNull(),
    status: text("status").notNull().default("open"),
    approvalId: uuid("approval_id").references(() => approvals.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    spaceStatusIdx: index("budget_incidents_space_status_idx").on(table.spaceId, table.status),
    spaceScopeIdx: index("budget_incidents_space_scope_idx").on(
      table.spaceId,
      table.scopeType,
      table.scopeId,
      table.status,
    ),
    policyWindowIdx: uniqueIndex("budget_incidents_policy_window_threshold_idx").on(
      table.policyId,
      table.windowStart,
      table.thresholdType,
    ).where(sql`${table.status} = 'open'`),
  }),
);
