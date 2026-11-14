import { pgTable, uuid, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { spaces } from "./spaces.js";
import { goals } from "./goals.js";
import { agents } from "./agents.js";
import { issues } from "./issues.js";

/**
 * The onboarding answers Outpost Cloud collected during signup, pushed into
 * this stack at activation and applied here.
 *
 * `revision` is the content hash Cloud computed over the seed. Cloud retries
 * the push until it gets a 2xx and only then records the acknowledged
 * revision, so the receiver has to be idempotent: replaying a revision that
 * already matches this row must not create a second agent or a second task.
 * The `goal_id` / `agent_id` / `issue_id` back-references are what a later
 * revision updates in place rather than duplicating.
 */
export const spaceOnboardingSeeds = pgTable(
  "space_onboarding_seeds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
    revision: text("revision").notNull(),
    mission: text("mission"),
    agentName: text("agent_name"),
    agentRole: text("agent_role"),
    firstTaskTitle: text("first_task_title"),
    firstTaskDetails: text("first_task_details"),
    goalId: uuid("goal_id").references(() => goals.id, { onDelete: "set null" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    issueId: uuid("issue_id").references(() => issues.id, { onDelete: "set null" }),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    spaceUq: uniqueIndex("space_onboarding_seeds_space_uq").on(table.spaceId),
  }),
);
