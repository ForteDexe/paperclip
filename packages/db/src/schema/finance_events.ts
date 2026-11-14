import { pgTable, uuid, text, timestamp, integer, numeric, index, uniqueIndex, boolean, jsonb } from "drizzle-orm/pg-core";
import { spaces } from "./spaces.js";
import { agents } from "./agents.js";
import { issues } from "./issues.js";
import { projects } from "./projects.js";
import { goals } from "./goals.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { costEvents } from "./cost_events.js";

export const financeEvents = pgTable(
  "finance_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull().references(() => spaces.id),
    agentId: uuid("agent_id").references(() => agents.id),
    issueId: uuid("issue_id").references(() => issues.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id),
    goalId: uuid("goal_id").references(() => goals.id),
    heartbeatRunId: uuid("heartbeat_run_id").references(() => heartbeatRuns.id),
    costEventId: uuid("cost_event_id").references(() => costEvents.id),
    idempotencyKey: text("idempotency_key"),
    receiptHash: text("receipt_hash"),
    billingCode: text("billing_code"),
    description: text("description"),
    eventKind: text("event_kind").notNull(),
    direction: text("direction").notNull().default("debit"),
    biller: text("biller").notNull(),
    provider: text("provider"),
    executionAdapterType: text("execution_adapter_type"),
    pricingTier: text("pricing_tier"),
    region: text("region"),
    model: text("model"),
    quantity: integer("quantity"),
    unit: text("unit"),
    amountCents: numeric("amount_cents", { precision: 24, scale: 7, mode: "number" }).notNull(),
    currency: text("currency").notNull().default("USD"),
    estimated: boolean("estimated").notNull().default(false),
    externalInvoiceId: text("external_invoice_id"),
    metadataJson: jsonb("metadata_json").$type<Record<string, unknown> | null>(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    receiptUniqueIdx: uniqueIndex("finance_events_space_receipt_idx").on(table.spaceId, table.idempotencyKey),
    spaceOccurredIdx: index("finance_events_space_occurred_idx").on(table.spaceId, table.occurredAt),
    spaceBillerOccurredIdx: index("finance_events_space_biller_occurred_idx").on(
      table.spaceId,
      table.biller,
      table.occurredAt,
    ),
    spaceKindOccurredIdx: index("finance_events_space_kind_occurred_idx").on(
      table.spaceId,
      table.eventKind,
      table.occurredAt,
    ),
    spaceDirectionOccurredIdx: index("finance_events_space_direction_occurred_idx").on(
      table.spaceId,
      table.direction,
      table.occurredAt,
    ),
    spaceHeartbeatRunIdx: index("finance_events_space_heartbeat_run_idx").on(
      table.spaceId,
      table.heartbeatRunId,
    ),
    spaceCostEventIdx: index("finance_events_space_cost_event_idx").on(
      table.spaceId,
      table.costEventId,
    ),
  }),
);
