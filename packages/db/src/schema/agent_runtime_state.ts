import { numeric, pgTable, uuid, text, timestamp, jsonb, bigint, index } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { spaces } from "./spaces.js";

export const agentRuntimeState = pgTable(
  "agent_runtime_state",
  {
    agentId: uuid("agent_id").primaryKey().references(() => agents.id),
    spaceId: uuid("space_id").notNull().references(() => spaces.id),
    adapterType: text("adapter_type").notNull(),
    sessionId: text("session_id"),
    stateJson: jsonb("state_json").$type<Record<string, unknown>>().notNull().default({}),
    lastRunId: uuid("last_run_id"),
    lastRunStatus: text("last_run_status"),
    totalInputTokens: bigint("total_input_tokens", { mode: "number" }).notNull().default(0),
    totalOutputTokens: bigint("total_output_tokens", { mode: "number" }).notNull().default(0),
    totalCachedInputTokens: bigint("total_cached_input_tokens", { mode: "number" }).notNull().default(0),
    totalCostCents: numeric("total_cost_cents", { precision: 24, scale: 7, mode: "number" }).notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    spaceAgentIdx: index("agent_runtime_state_space_agent_idx").on(table.spaceId, table.agentId),
    spaceUpdatedIdx: index("agent_runtime_state_space_updated_idx").on(table.spaceId, table.updatedAt),
  }),
);

