import { bigint, check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { spaces } from "./spaces.js";

/** Content-free lifecycle journal. Consumers must revalidate the resource before provisioning. */
export const resourceLifecycleEvents = pgTable("resource_lifecycle_events", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  resourceType: text("resource_type").$type<"agent" | "project" | "agent_runtime">().notNull(),
  resourceId: uuid("resource_id").notNull(),
  action: text("action").$type<"create" | "update" | "archive" | "delete" | "pause" | "resume" | "terminate">().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  resourceIdx: uniqueIndex("resource_lifecycle_events_creation_idx").on(table.spaceId, table.resourceType, table.resourceId).where(sql`${table.action} = 'create'`),
  spaceIdx: index("resource_lifecycle_events_space_idx").on(table.spaceId, table.id),
  resourceOrderIdx: index("resource_lifecycle_events_resource_order_idx").on(table.spaceId, table.resourceType, table.resourceId, table.id),
  resourceTypeCheck: check("resource_lifecycle_events_resource_type_check", sql`${table.resourceType} IN ('agent', 'project', 'agent_runtime')`),
  actionCheck: check("resource_lifecycle_events_action_check", sql`(${table.resourceType} = 'agent_runtime' AND ${table.action} IN ('update', 'delete')) OR ${table.action} = 'create' OR (${table.resourceType} = 'project' AND ${table.action} IN ('update', 'archive', 'delete')) OR (${table.resourceType} = 'agent' AND ${table.action} IN ('pause', 'resume', 'terminate'))`),
}));
