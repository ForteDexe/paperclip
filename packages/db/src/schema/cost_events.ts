import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, integer, index, numeric, uniqueIndex, check, jsonb } from "drizzle-orm/pg-core";
import { spaces } from "./spaces.js";
import { agents } from "./agents.js";
import { issues } from "./issues.js";
import { projects } from "./projects.js";
import { goals } from "./goals.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { aiSubscriptions } from "./ai_subscriptions.js";

export const costEvents = pgTable(
  "cost_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull().references(() => spaces.id),
    agentId: uuid("agent_id").references(() => agents.id),
    usageKind: text("usage_kind").notNull().default("agent"),
    responsibleUserId: text("responsible_user_id"),
    issueId: uuid("issue_id").references(() => issues.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id),
    goalId: uuid("goal_id").references(() => goals.id),
    heartbeatRunId: uuid("heartbeat_run_id").references(() => heartbeatRuns.id),
    subscriptionId: uuid("subscription_id").references(() => aiSubscriptions.id),
    billingCode: text("billing_code"),
    idempotencyKey: text("idempotency_key"),
    receiptHash: text("receipt_hash"),
    providerRequestId: text("provider_request_id"),
    reportedCostCents: numeric("reported_cost_cents", { precision: 24, scale: 7 }),
    reportedUsageJson: jsonb("reported_usage_json").$type<Record<string, unknown>>(),
    pricingProvenance: jsonb("pricing_provenance").$type<Record<string, unknown>>(),
    provider: text("provider").notNull(),
    biller: text("biller").notNull().default("unknown"),
    billingType: text("billing_type").notNull().default("unknown"),
    costStatus: text("cost_status").notNull().default("reported"),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costCents: numeric("cost_cents", { precision: 24, scale: 7, mode: "number" }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    usageKindCheck: check("cost_events_usage_kind_check", sql`${table.usageKind} in ('decision', 'fast_response', 'prompt_injection') or (${table.usageKind} = 'agent' and ${table.agentId} is not null)`),
    receiptUniqueIdx: uniqueIndex("cost_events_space_receipt_idx").on(table.spaceId, table.idempotencyKey),
    providerRequestIdx: index("cost_events_provider_request_idx").on(table.spaceId, table.biller, table.providerRequestId),
    nonnegativeAmounts: check("cost_events_nonnegative_amounts", sql`${table.costCents} >= 0 and ${table.inputTokens} >= 0 and ${table.cachedInputTokens} >= 0 and ${table.outputTokens} >= 0`),
    spaceProjectOccurredIdx: index("cost_events_space_project_occurred_idx").on(table.spaceId, table.projectId, table.occurredAt),
    unpricedIdx: index("cost_events_unpriced_idx").on(table.spaceId, table.occurredAt, table.id).where(sql`${table.costStatus} = 'unpriced' and ${table.billingType} <> 'subscription_included'`),
    dataQualityIdx: index("cost_events_data_quality_idx").on(table.spaceId, table.occurredAt.desc(), table.id)
      .where(sql`${table.billingType} = 'unknown' or (${table.costStatus} = 'unpriced' and ${table.billingType} <> 'subscription_included')`),
    spaceOccurredIdx: index("cost_events_space_occurred_idx").on(table.spaceId, table.occurredAt),
    spaceSubscriptionOccurredIdx: index("cost_events_space_subscription_occurred_idx").on(table.spaceId, table.subscriptionId, table.occurredAt),
    spaceAgentOccurredIdx: index("cost_events_space_agent_occurred_idx").on(
      table.spaceId,
      table.agentId,
      table.occurredAt,
    ),
    spaceProviderOccurredIdx: index("cost_events_space_provider_occurred_idx").on(
      table.spaceId,
      table.provider,
      table.occurredAt,
    ),
    spaceBillerOccurredIdx: index("cost_events_space_biller_occurred_idx").on(
      table.spaceId,
      table.biller,
      table.occurredAt,
    ),
    spaceHeartbeatRunIdx: index("cost_events_space_heartbeat_run_idx").on(
      table.spaceId,
      table.heartbeatRunId,
    ),
  }),
);
