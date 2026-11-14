import { pgTable, uuid, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { spaces } from "./spaces.js";

export const agentMemberships = pgTable(
  "agent_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    state: text("state").notNull().default("joined"),
    starredAt: timestamp("starred_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    spaceUserIdx: index("agent_memberships_space_user_idx").on(table.spaceId, table.userId),
    spaceUserStarredIdx: index("agent_memberships_space_user_starred_idx").on(
      table.spaceId,
      table.userId,
      table.starredAt,
    ),
    agentIdx: index("agent_memberships_agent_idx").on(table.agentId),
    spaceUserAgentUq: uniqueIndex("agent_memberships_space_user_agent_uq").on(
      table.spaceId,
      table.userId,
      table.agentId,
    ),
  }),
);
