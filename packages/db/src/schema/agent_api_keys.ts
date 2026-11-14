import { pgTable, uuid, text, timestamp, index, jsonb } from "drizzle-orm/pg-core";
import type { AgentApiKeyScope } from "@outpost/shared";
import { agents } from "./agents.js";
import { spaces } from "./spaces.js";

export const agentApiKeys = pgTable(
  "agent_api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    spaceId: uuid("space_id").notNull().references(() => spaces.id),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull(),
    responsibleUserId: text("responsible_user_id"),
    scopeConfig: jsonb("scope_config").$type<AgentApiKeyScope | null>(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    keyHashIdx: index("agent_api_keys_key_hash_idx").on(table.keyHash),
    spaceAgentIdx: index("agent_api_keys_space_agent_idx").on(table.spaceId, table.agentId),
  }),
);
