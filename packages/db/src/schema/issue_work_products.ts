import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { SourceTrustMetadata } from "@outpost/shared";
import { spaces } from "./spaces.js";
import { executionWorkspaces } from "./execution_workspaces.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { issues } from "./issues.js";
import { projects } from "./projects.js";
import { workspaceRuntimeServices } from "./workspace_runtime_services.js";

export const issueWorkProducts = pgTable(
  "issue_work_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull().references(() => spaces.id),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    executionWorkspaceId: uuid("execution_workspace_id")
      .references(() => executionWorkspaces.id, { onDelete: "set null" }),
    runtimeServiceId: uuid("runtime_service_id")
      .references(() => workspaceRuntimeServices.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    externalId: text("external_id"),
    title: text("title").notNull(),
    url: text("url"),
    status: text("status").notNull(),
    reviewState: text("review_state").notNull().default("none"),
    isPrimary: boolean("is_primary").notNull().default(false),
    healthStatus: text("health_status").notNull().default("unknown"),
    summary: text("summary"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    sourceTrust: jsonb("source_trust").$type<SourceTrustMetadata | null>(),
    createdByRunId: uuid("created_by_run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    spaceIssueTypeIdx: index("issue_work_products_space_issue_type_idx").on(
      table.spaceId,
      table.issueId,
      table.type,
    ),
    spaceExecutionWorkspaceTypeIdx: index("issue_work_products_space_execution_workspace_type_idx").on(
      table.spaceId,
      table.executionWorkspaceId,
      table.type,
    ),
    spaceProviderExternalIdIdx: index("issue_work_products_space_provider_external_id_idx").on(
      table.spaceId,
      table.provider,
      table.externalId,
    ),
    spaceUpdatedIdx: index("issue_work_products_space_updated_idx").on(
      table.spaceId,
      table.updatedAt,
    ),
  }),
);
