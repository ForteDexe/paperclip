import { pgTable, uuid, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { spaces } from "./spaces.js";
import { projects } from "./projects.js";

export const projectMemberships = pgTable(
  "project_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    state: text("state").notNull().default("joined"),
    starredAt: timestamp("starred_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    spaceUserIdx: index("project_memberships_space_user_idx").on(table.spaceId, table.userId),
    spaceUserStarredIdx: index("project_memberships_space_user_starred_idx").on(
      table.spaceId,
      table.userId,
      table.starredAt,
    ),
    projectIdx: index("project_memberships_project_idx").on(table.projectId),
    spaceUserProjectUq: uniqueIndex("project_memberships_space_user_project_uq").on(
      table.spaceId,
      table.userId,
      table.projectId,
    ),
  }),
);
