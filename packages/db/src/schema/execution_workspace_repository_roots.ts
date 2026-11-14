import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { spaces } from "./spaces.js";

/** Legacy physical-root policy ledger; retained for schema compatibility, unused by runtime. */
export const executionWorkspaceRepositoryRoots = pgTable("execution_workspace_repository_roots", {
  id: uuid("id").primaryKey().defaultRandom(),
  spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  canonicalCwd: text("canonical_cwd").notNull(),
  rootKey: text("root_key").notNull(),
  mode: text("mode").$type<"anonymous_only" | "managed">().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  rootIdx: uniqueIndex("execution_workspace_repository_roots_space_root_idx").on(table.spaceId, table.rootKey),
}));
