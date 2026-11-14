import { index, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { spaces } from "./spaces.js";

/** Independent durable inputs. No producer updates a shared space cursor. */
export const budgetEvaluationWork = pgTable("budget_evaluation_work", {
  id: uuid("id").primaryKey().defaultRandom(),
  spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id"),
  projectId: uuid("project_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  spacePending: index("budget_evaluation_work_space_pending_idx").on(table.spaceId, table.createdAt, table.id),
  agentPending: index("budget_evaluation_work_agent_pending_idx").on(table.spaceId, table.agentId, table.createdAt),
  projectPending: index("budget_evaluation_work_project_pending_idx").on(table.spaceId, table.projectId, table.createdAt),
}));
