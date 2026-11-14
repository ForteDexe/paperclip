import { sql } from "drizzle-orm";
import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { spaces } from "./spaces.js";
import { userSecretDefinitions } from "./user_secret_definitions.js";

export const userSecretDeclarations = pgTable(
  "user_secret_declarations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
    userSecretDefinitionId: uuid("user_secret_definition_id")
      .notNull()
      .references(() => userSecretDefinitions.id, { onDelete: "cascade" }),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    configPath: text("config_path").notNull(),
    envKey: text("env_key").notNull(),
    versionSelector: text("version_selector").notNull().default("latest"),
    required: boolean("required").notNull().default(true),
    allowMissingOverride: boolean("allow_missing_override").notNull().default(false),
    label: text("label"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    spaceIdx: index("user_secret_declarations_space_idx").on(table.spaceId),
    definitionIdx: index("user_secret_declarations_definition_idx").on(table.userSecretDefinitionId),
    targetIdx: index("user_secret_declarations_target_idx").on(table.spaceId, table.targetType, table.targetId),
    spaceRequiredIdx: index("user_secret_declarations_space_required_idx").on(table.spaceId, table.required),
    targetPathUq: uniqueIndex("user_secret_declarations_target_path_uq").on(
      table.spaceId,
      table.targetType,
      table.targetId,
      table.configPath,
    ),
    requiredOverrideCheck: index("user_secret_declarations_required_override_idx")
      .on(table.spaceId, table.allowMissingOverride)
      .where(sql`${table.allowMissingOverride} = true`),
  }),
);
