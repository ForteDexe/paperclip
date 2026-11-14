import type { InteractionResolverPolicy } from "@outpost/shared";
import { numeric, pgTable, uuid, text, integer, timestamp, boolean, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";

export const spaces = pgTable(
  "spaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    workspaceRoot: text("workspace_root"),
    workspaceRootKey: text("workspace_root_key"),
    status: text("status").notNull().default("active"),
    pauseReason: text("pause_reason"),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    issuePrefix: text("issue_prefix").notNull().default("PAP"),
    issueCounter: integer("issue_counter").notNull().default(0),
    budgetMonthlyCents: integer("budget_monthly_cents").notNull().default(0),
    spendMonthUtc: text("spend_month_utc"),
    spentMonthlyCents: numeric("spent_monthly_cents", { precision: 24, scale: 7, mode: "number" }).notNull().default(0),
    defaultResponsibleUserId: text("default_responsible_user_id"),
    /** Space-wide default for entry points that need one agent. Not a rank. */
    defaultAgentId: uuid("default_agent_id"),
    requireOperatorApprovalForNewAgents: boolean("require_operator_approval_for_new_agents")
      .notNull()
      .default(false),
    interactionResolverPolicy: jsonb("interaction_resolver_policy")
      .$type<InteractionResolverPolicy>()
      .notNull()
      .default({}),
    feedbackDataSharingEnabled: boolean("feedback_data_sharing_enabled")
      .notNull()
      .default(false),
    feedbackDataSharingConsentAt: timestamp("feedback_data_sharing_consent_at", { withTimezone: true }),
    feedbackDataSharingConsentByUserId: text("feedback_data_sharing_consent_by_user_id"),
    feedbackDataSharingTermsVersion: text("feedback_data_sharing_terms_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    issuePrefixUniqueIdx: uniqueIndex("spaces_issue_prefix_idx").on(table.issuePrefix),
    workspaceRootUniqueIdx: uniqueIndex("spaces_workspace_root_key_idx")
      .on(table.workspaceRootKey),
    defaultAgentIdx: index("spaces_default_agent_id_idx").on(table.defaultAgentId),
  }),
);
