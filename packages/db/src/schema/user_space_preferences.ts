import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { spaces } from "./spaces.js";

export const userSpacePreferences = pgTable("user_space_preferences", {
  id: uuid("id").primaryKey().defaultRandom(),
  spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  defaultAgentId: uuid("default_agent_id").references(() => agents.id, { onDelete: "set null" }),
  defaultAgentInitialized: boolean("default_agent_initialized").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  spaceUserUq: uniqueIndex("user_space_preferences_space_user_uq").on(table.spaceId, table.userId),
  defaultAgentIdx: index("user_space_preferences_default_agent_idx").on(table.defaultAgentId),
}));
