import { bigint, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { spaces } from "./spaces.js";
import { plugins } from "./plugins.js";

/**
 * Per-plugin delivery progress for one lifecycle resource stream. Every event of the resource with
 * an id at or below `acknowledgedThroughId` is acknowledged by the plugin. Acknowledgments above
 * the cursor still use `plugin_lifecycle_acknowledgments`, which remains the record of each
 * acknowledgment.
 */
export const pluginLifecycleResourceCursors = pgTable("plugin_lifecycle_resource_cursors", {
  pluginId: uuid("plugin_id").notNull().references(() => plugins.id, { onDelete: "cascade" }),
  spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  resourceType: text("resource_type").$type<"agent" | "project" | "agent_runtime">().notNull(),
  resourceId: uuid("resource_id").notNull(),
  acknowledgedThroughId: bigint("acknowledged_through_id", { mode: "number" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  pk: primaryKey({ name: "plugin_lifecycle_resource_cursors_pk", columns: [table.pluginId, table.spaceId, table.resourceType, table.resourceId] }),
}));
