import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex, boolean } from "drizzle-orm/pg-core";
import { spaces } from "./spaces.js";
import { plugins } from "./plugins.js";

/**
 * `plugin_space_settings` table — stores operator-managed plugin settings
 * scoped to a specific space.
 *
 * This is distinct from `plugin_config`, which stores the plugin's declared
 * operator configuration. Each space can have at most one settings row per
 * plugin.
 *
 * Rows represent explicit overrides from the default space behavior:
 * - no row => plugin is enabled for the space by default
 * - row with `enabled = false` => plugin is disabled for that space
 * - row with `enabled = true` => plugin remains enabled and stores space settings
 */
export const pluginSpaceSettings = pgTable(
  "plugin_space_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id")
      .notNull()
      .references(() => spaces.id, { onDelete: "cascade" }),
    pluginId: uuid("plugin_id")
      .notNull()
      .references(() => plugins.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true),
    settingsJson: jsonb("settings_json").$type<Record<string, unknown>>().notNull().default({}),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    spaceIdx: index("plugin_space_settings_space_idx").on(table.spaceId),
    pluginIdx: index("plugin_space_settings_plugin_idx").on(table.pluginId),
    spacePluginUq: uniqueIndex("plugin_space_settings_space_plugin_uq").on(
      table.spaceId,
      table.pluginId,
    ),
  }),
);
