import { sql } from "drizzle-orm";
import { check, pgTable, uuid, text, timestamp, integer, jsonb, index, uniqueIndex, foreignKey } from "drizzle-orm/pg-core";
import { spaces } from "./spaces.js";
import { projects } from "./projects.js";
import { agents } from "./agents.js";
import { spaceSecretProviderConfigs } from "./space_secret_provider_configs.js";
import { userSecretDefinitions } from "./user_secret_definitions.js";
import { plugins } from "./plugins.js";

export const spaceSecrets = pgTable(
  "space_secrets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull().references(() => spaces.id),
    scope: text("scope").notNull().default("space"),
    ownerUserId: text("owner_user_id"),
    ownerAgentId: uuid("owner_agent_id"),
    ownerProjectId: uuid("owner_project_id"),
    ownerPluginId: uuid("owner_plugin_id").references(() => plugins.id, { onDelete: "cascade" }),
    userSecretDefinitionId: uuid("user_secret_definition_id").references(() => userSecretDefinitions.id, { onDelete: "set null" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    provider: text("provider").notNull().default("local_encrypted"),
    status: text("status").notNull().default("active"),
    managedMode: text("managed_mode").notNull().default("outpost_managed"),
    externalRef: text("external_ref"),
    providerConfigId: uuid("provider_config_id").references(() => spaceSecretProviderConfigs.id, { onDelete: "set null" }),
    providerMetadata: jsonb("provider_metadata").$type<Record<string, unknown>>(),
    aiSessionEpoch: integer("ai_session_epoch").notNull().default(0),
    latestVersion: integer("latest_version").notNull().default(1),
    description: text("description"),
    lastResolvedAt: timestamp("last_resolved_at", { withTimezone: true }),
    lastRotatedAt: timestamp("last_rotated_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    spaceIdx: index("space_secrets_space_idx").on(table.spaceId),
    spaceScopeIdx: index("space_secrets_space_scope_idx").on(table.spaceId, table.scope),
    spaceOwnerIdx: index("space_secrets_space_owner_idx").on(table.spaceId, table.ownerUserId),
    userDefinitionOwnerIdx: index("space_secrets_user_definition_owner_idx").on(
      table.spaceId,
      table.userSecretDefinitionId,
      table.ownerUserId,
    ),
    spaceProviderIdx: index("space_secrets_space_provider_idx").on(table.spaceId, table.provider),
    agentOwner: foreignKey({ columns: [table.spaceId, table.ownerAgentId], foreignColumns: [agents.spaceId, agents.id] }).onDelete("cascade"),
    projectOwner: foreignKey({ columns: [table.spaceId, table.ownerProjectId], foreignColumns: [projects.spaceId, projects.id] }).onDelete("cascade"),
    projectInstanceOwnerKeyUq: uniqueIndex("space_secrets_project_instance_owner_key_uq").on(table.spaceId, table.ownerProjectId, table.ownerPluginId, table.key)
      .where(sql`${table.scope} = 'instance' and ${table.deletedAt} is null`),
    instanceOwnerKeyUq: uniqueIndex("space_secrets_instance_owner_key_uq").on(table.spaceId, table.ownerAgentId, table.ownerPluginId, table.key)
      .where(sql`${table.scope} = 'instance' and ${table.deletedAt} is null`),
    providerConfigIdx: index("space_secrets_provider_config_idx").on(table.providerConfigId),
    spaceNameUq: uniqueIndex("space_secrets_space_name_uq")
      .on(table.spaceId, table.name)
      .where(sql`${table.scope} = 'space' and ${table.deletedAt} is null`),
    spaceKeyUq: uniqueIndex("space_secrets_space_key_uq")
      .on(table.spaceId, table.key)
      .where(sql`${table.scope} = 'space' and ${table.deletedAt} is null`),
    userDefinitionOwnerUq: uniqueIndex("space_secrets_user_definition_owner_uq")
      .on(table.spaceId, table.userSecretDefinitionId, table.ownerUserId)
      .where(sql`${table.scope} = 'user' and ${table.deletedAt} is null`),
    scopeShapeCheck: check(
      "space_secrets_scope_shape_check",
      sql`(
        ${table.scope} = 'space'
        and ${table.ownerUserId} is null
        and ${table.userSecretDefinitionId} is null
        and ${table.ownerAgentId} is null and ${table.ownerProjectId} is null and ${table.ownerPluginId} is null
      ) or (
        ${table.scope} = 'user'
        and ${table.ownerUserId} is not null
        and ${table.userSecretDefinitionId} is not null
        and ${table.ownerAgentId} is null and ${table.ownerProjectId} is null and ${table.ownerPluginId} is null
      ) or (
        ${table.scope} = 'instance'
        and ${table.ownerUserId} is null and ${table.userSecretDefinitionId} is null
        and (${table.ownerAgentId} is not null) <> (${table.ownerProjectId} is not null)
        and ${table.ownerPluginId} is not null
      )`,
    ),
  }),
);
