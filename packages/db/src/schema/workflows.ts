import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { spaces } from "./spaces.js";
import { agents } from "./agents.js";

export const workflows = pgTable("workflows", {
  id: uuid("id").primaryKey().defaultRandom(),
  spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  prompt: text("prompt").notNull(),
  createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
  createdByUserId: text("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({ spaceIdx: index("workflows_space_idx").on(table.spaceId) }));
