import { foreignKey, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { AiConnectionPoolConfig, AiConnectionRouterSelection } from "@outpost/shared";
import { spaces } from "./spaces.js";
import { agents } from "./agents.js";
import { toolConnections } from "./tool_access.js";

export const aiConnectionPools = pgTable("ai_connection_pools", {
  id: uuid("id").primaryKey().references(() => toolConnections.id, { onDelete: "cascade" }),
  spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  pluginKey: text("plugin_key").notNull(),
  config: jsonb("config").$type<AiConnectionPoolConfig>().notNull(),
  revision: integer("revision").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("ai_connection_pools_space_id_uq").on(table.spaceId, table.id),
  foreignKey({ columns: [table.spaceId, table.id], foreignColumns: [toolConnections.spaceId, toolConnections.id], name: "ai_connection_pools_space_connection_fk" }).onDelete("cascade"),
]);
export const aiConnectionRouterCursors = pgTable("ai_connection_router_cursors", {
  poolId: uuid("pool_id").primaryKey().references(() => aiConnectionPools.id, { onDelete: "cascade" }),
  spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  lastMemberId: text("last_member_id"),
  version: integer("version").notNull().default(0),
}, (table) => [foreignKey({ columns: [table.spaceId, table.poolId], foreignColumns: [aiConnectionPools.spaceId, aiConnectionPools.id], name: "ai_connection_router_cursors_space_pool_fk" }).onDelete("cascade")]);
export const aiConnectionTaskPins = pgTable("ai_connection_task_pins", {
  id: uuid("id").primaryKey().defaultRandom(),
  spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  poolId: uuid("pool_id").notNull().references(() => aiConnectionPools.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  taskKey: text("task_key").notNull(),
  selection: jsonb("selection").$type<AiConnectionRouterSelection>().notNull(),
  member: jsonb("member").$type<AiConnectionPoolConfig["members"][number]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("ai_connection_task_pins_affinity_uq").on(table.spaceId, table.poolId, table.agentId, table.taskKey),
  foreignKey({ columns: [table.spaceId, table.poolId], foreignColumns: [aiConnectionPools.spaceId, aiConnectionPools.id], name: "ai_connection_task_pins_space_pool_fk" }).onDelete("cascade"),
  foreignKey({ columns: [table.spaceId, table.agentId], foreignColumns: [agents.spaceId, agents.id], name: "ai_connection_task_pins_space_agent_fk" }).onDelete("cascade"),
]);
