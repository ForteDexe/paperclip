import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { spaces } from "./spaces.js";
import { spaceSecrets } from "./space_secrets.js";

export const spaceSecretBindings = pgTable(
  "space_secret_bindings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull().references(() => spaces.id),
    secretId: uuid("secret_id").notNull().references(() => spaceSecrets.id, { onDelete: "cascade" }),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    configPath: text("config_path").notNull(),
    versionSelector: text("version_selector").notNull().default("latest"),
    required: boolean("required").notNull().default(true),
    label: text("label"),
    projectionClass: text("projection_class").notNull().default("unclassified"),
    projectionAllowlistKey: text("projection_allowlist_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    spaceIdx: index("space_secret_bindings_space_idx").on(table.spaceId),
    secretIdx: index("space_secret_bindings_secret_idx").on(table.secretId),
    targetIdx: index("space_secret_bindings_target_idx").on(table.spaceId, table.targetType, table.targetId),
    targetPathUq: uniqueIndex("space_secret_bindings_target_path_uq").on(
      table.spaceId,
      table.targetType,
      table.targetId,
      table.configPath,
    ),
  }),
);
