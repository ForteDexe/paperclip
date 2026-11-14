import { pgTable, uuid, text, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { spaces } from "./spaces.js";

export const spaceUserSidebarPreferences = pgTable(
  "space_user_sidebar_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    projectOrder: jsonb("project_order").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    spaceIdx: index("space_user_sidebar_preferences_space_idx").on(table.spaceId),
    userIdx: index("space_user_sidebar_preferences_user_idx").on(table.userId),
    spaceUserUq: uniqueIndex("space_user_sidebar_preferences_space_user_uq").on(
      table.spaceId,
      table.userId,
    ),
  }),
);
