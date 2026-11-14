import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { spaces } from "./spaces.js";
import { executionWorkspaces } from "./execution_workspaces.js";
import { issues } from "./issues.js";

export const executionWorkspaceRepositories = pgTable("execution_workspace_repositories", {
  id: uuid("id").primaryKey().defaultRandom(),
  spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  executionWorkspaceId: uuid("execution_workspace_id").notNull().references(() => executionWorkspaces.id, { onDelete: "cascade" }),
  requestedByIssueId: uuid("requested_by_issue_id").references(() => issues.id, { onDelete: "set null" }),
  repositoryIdentity: text("repository_identity").notNull(),
  catalogRepositoryId: text("catalog_repository_id"),
  repoUrl: text("repo_url").notNull(),
  relativePath: text("relative_path").notNull(),
  requestedRef: text("requested_ref").notNull().default("HEAD"),
  pinnedCommit: text("pinned_commit"),
  branchName: text("branch_name"),
  requestKey: text("request_key").notNull(),
  requestKeys: jsonb("request_keys").$type<string[]>().notNull().default([]),
  state: text("state").notNull().default("pending"),
  failureCode: text("failure_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  identityIdx: uniqueIndex("execution_workspace_repositories_identity_idx").on(table.executionWorkspaceId, table.repositoryIdentity),
  pathIdx: uniqueIndex("execution_workspace_repositories_path_idx").on(table.executionWorkspaceId, table.relativePath),
  requestIdx: uniqueIndex("execution_workspace_repositories_request_idx").on(table.executionWorkspaceId, table.requestKey),
  spaceWorkspaceIdx: index("execution_workspace_repositories_space_workspace_idx").on(table.spaceId, table.executionWorkspaceId),
}));
