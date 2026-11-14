import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, date, index, jsonb, check, uniqueIndex } from "drizzle-orm/pg-core";
import type { AgentEnvConfig } from "@outpost/shared";
import { spaces } from "./spaces.js";
import { goals } from "./goals.js";
import { agents } from "./agents.js";
import { environments } from "./environments.js";
import { connectionGrants } from "./tool_access.js";

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull().references(() => spaces.id),
    goalId: uuid("goal_id").references(() => goals.id),
    name: text("name").notNull(),
    description: text("description"),
    visibility: text("visibility").notNull().default("open"),
    privacyOwnerUserId: text("privacy_owner_user_id"),
    personalOwnerUserId: text("personal_owner_user_id"),
    status: text("status").notNull().default("backlog"),
    leadAgentId: uuid("lead_agent_id").references(() => agents.id),
    legacyEnvironmentId: uuid("environment_id").references(() => environments.id, { onDelete: "set null" }),
    targetDate: date("target_date"),
    color: text("color"),
    icon: text("icon"),
    env: jsonb("env").$type<AgentEnvConfig>(),
    gitAuthorizationGrantId: uuid("git_authorization_grant_id").references(() => connectionGrants.id, { onDelete: "set null" }),
    gitAuthorizedByUserId: text("git_authorized_by_user_id"),
    pauseReason: text("pause_reason"),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    executionWorkspacePolicy: jsonb("execution_workspace_policy").$type<Record<string, unknown>>(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    spaceIdUq: uniqueIndex("projects_space_id_uq").on(table.spaceId, table.id),
    spaceIdx: index("projects_space_idx").on(table.spaceId),
    visibilityCheck: check("projects_visibility_check", sql`${table.visibility} in ('open', 'private')`),
    personalOwnerUq: uniqueIndex("projects_space_personal_owner_uq")
      .on(table.spaceId, table.personalOwnerUserId)
      .where(sql`${table.personalOwnerUserId} is not null`),
  }),
);
