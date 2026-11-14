import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { spaces } from "./spaces.js";
import { spaceSecretProviderConfigs } from "./space_secret_provider_configs.js";

export const userSecretDefinitions = pgTable(
  "user_secret_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").notNull().default("active"),
    provider: text("provider").notNull().default("local_encrypted"),
    managedMode: text("managed_mode").notNull().default("outpost_managed"),
    providerConfigId: uuid("provider_config_id").references(() => spaceSecretProviderConfigs.id, { onDelete: "set null" }),
    providerMetadata: jsonb("provider_metadata").$type<Record<string, unknown>>(),
    usageGuidance: text("usage_guidance"),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdByUserId: text("created_by_user_id"),
    updatedByAgentId: uuid("updated_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    updatedByUserId: text("updated_by_user_id"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    spaceStatusIdx: index("user_secret_definitions_space_status_idx").on(table.spaceId, table.status),
    spaceProviderIdx: index("user_secret_definitions_space_provider_idx").on(table.spaceId, table.provider),
    providerConfigIdx: index("user_secret_definitions_provider_config_idx").on(table.providerConfigId),
    spaceKeyUq: uniqueIndex("user_secret_definitions_space_key_uq")
      .on(table.spaceId, table.key)
      .where(sql`${table.deletedAt} is null`),
  }),
);
