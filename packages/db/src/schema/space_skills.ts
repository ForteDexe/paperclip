import {
  type AnyPgColumn,
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  integer,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { SpaceSkillFileInventoryEntry, SpaceSkillSharingScope } from "@outpost/shared";
import { agents } from "./agents.js";
import { spaces } from "./spaces.js";
import { issues } from "./issues.js";
import { folders } from "./folders.js";

export const spaceSkills = pgTable(
  "space_skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull().references(() => spaces.id),
    folderId: uuid("folder_id").references(() => folders.id, { onDelete: "set null" }),
    key: text("key").notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    markdown: text("markdown").notNull(),
    sourceType: text("source_type").notNull().default("local_path"),
    sourceLocator: text("source_locator"),
    sourceRef: text("source_ref"),
    trustLevel: text("trust_level").notNull().default("markdown_only"),
    compatibility: text("compatibility").notNull().default("compatible"),
    fileInventory: jsonb("file_inventory").$type<Array<Record<string, unknown>>>().notNull().default([]),
    iconUrl: text("icon_url"),
    color: text("color"),
    tagline: text("tagline"),
    authorName: text("author_name"),
    homepageUrl: text("homepage_url"),
    categories: text("categories").array().notNull().default([]),
    sharingScope: text("sharing_scope").$type<SpaceSkillSharingScope>().notNull().default("space"),
    // Source access is inherited by editable copies too. Orphaned sources fail closed.
    accessSourceId: uuid("access_source_id"),
    publicShareToken: text("public_share_token"),
    forkedFromSkillId: uuid("forked_from_skill_id").references((): AnyPgColumn => spaceSkills.id, { onDelete: "set null" }),
    forkedFromSpaceId: uuid("forked_from_space_id").references(() => spaces.id, { onDelete: "set null" }),
    starCount: integer("star_count").notNull().default(0),
    installCount: integer("install_count").notNull().default(0),
    forkCount: integer("fork_count").notNull().default(0),
    currentVersionId: uuid("current_version_id").references((): AnyPgColumn => spaceSkillVersions.id, { onDelete: "set null" }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    spaceKeyUniqueIdx: uniqueIndex("space_skills_space_key_idx").on(table.spaceId, table.key),
    spaceNameIdx: index("space_skills_space_name_idx").on(table.spaceId, table.name),
    spaceFolderIdx: index("space_skills_space_folder_idx").on(table.spaceId, table.folderId),
    spaceCategoriesIdx: index("space_skills_space_categories_idx").using("gin", table.categories),
    spaceSharingScopeIdx: index("space_skills_space_sharing_scope_idx").on(table.spaceId, table.sharingScope),
    spaceCurrentVersionIdx: index("space_skills_space_current_version_idx").on(table.spaceId, table.currentVersionId),
    spaceForkedFromIdx: index("space_skills_space_forked_from_idx").on(table.spaceId, table.forkedFromSkillId),
  }),
);

export type SpaceSkillVersionFileInventoryEntry = SpaceSkillFileInventoryEntry & {
  content: string;
  encoding?: "utf8" | "base64";
  executable?: boolean;
};

export const spaceSkillMutationReceipts = pgTable("space_skill_mutation_receipts", {
  spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  fingerprint: text("fingerprint").notNull(),
  skillId: uuid("skill_id").notNull(),
  versionId: uuid("version_id").notNull(),
  response: jsonb("response").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  keyIdx: uniqueIndex("space_skill_mutation_receipts_key_idx").on(table.spaceId, table.key),
}));

export type SkillPackageStorageReceipt = {
  durable?: boolean;
  format: "tar-gzip-v1";
  provider: "local_disk" | "s3";
  archiveKey: string;
  archiveSha256: string;
  archiveBytes: number;
  manifestKey: string;
  manifestSha256: string;
  manifestBytes: number;
  fileCount: number;
  totalBytes: number;
};

export type SkillPackageUpload = {
  token: string;
  legacy?: boolean;
  provider: "local_disk" | "s3";
  archiveKey: string;
  manifestKey: string;
  expiresAt: string;
};

/** Exact input to the v1 packager. File bodies never live in this recipe. */
export type SkillPackageRestoreRecipe = {
  version: 1;
  sourceId: string;
  repositoryId: string;
  repositoryUrl: string;
  commitSha: string;
  skillPath: string | null;
  manifest: {
    format: "outpost-skill-package/v1";
    contentHash: string;
    totalBytes: number;
    files: Array<{ path: string; kind: SpaceSkillFileInventoryEntry["kind"]; encoding: "utf8" | "base64";
      executable: boolean; size: number; sha256: string }>;
  };
};

export type SkillPackageFileMapping = SpaceSkillFileInventoryEntry & { sourcePath: string; encoding?: "utf8" | "base64" };

/** Durable deletion receipts survive space/snapshot deletion until storage confirms removal. */
export const skillPackageDeletions = pgTable("skill_package_deletions", {
  id: uuid("id").primaryKey().defaultRandom(),
  spaceId: uuid("space_id").notNull(),
  provider: text("provider").notNull(),
  archiveKey: text("archive_key").notNull(),
  manifestKey: text("manifest_key").notNull(),
  deleteAfter: timestamp("delete_after", { withTimezone: true }).notNull(),
}, table => ({ due: index("skill_package_deletions_due_idx").on(table.deleteAfter, table.id) }));

/** Immutable repository bytes shared by all skill versions from the same package. */
export const spaceSkillRepositorySnapshots = pgTable("space_skill_repository_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
  contentHash: text("content_hash").notNull(),
  // Legacy payload only. New packages retain bytes in the configured storage backend.
  fileInventory: jsonb("file_inventory").$type<SpaceSkillVersionFileInventoryEntry[]>().notNull().default([]),
  storage: jsonb("storage").$type<SkillPackageStorageReceipt>(),
  upload: jsonb("upload").$type<SkillPackageUpload>(),
  restore: jsonb("restore").$type<SkillPackageRestoreRecipe>(),
  // These deadlines are consumed by the delivery coordinator, never polled per turn.
  migrationAt: timestamp("migration_at", { withTimezone: true }).defaultNow(),
  maintenanceAt: timestamp("maintenance_at", { withTimezone: true }).defaultNow(),
  restoreRetryAt: timestamp("restore_retry_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  content: uniqueIndex("space_skill_repository_snapshots_content_idx").on(table.spaceId, table.contentHash),
  migration: index("space_skill_snapshots_migration_idx").on(table.migrationAt).where(sql`${table.migrationAt} is not null`),
  maintenance: index("space_skill_snapshots_maintenance_idx").on(table.maintenanceAt).where(sql`${table.maintenanceAt} is not null`),
}));

export const spaceSkillVersions = pgTable(
  "space_skill_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
    spaceSkillId: uuid("space_skill_id").notNull().references(() => spaceSkills.id, { onDelete: "cascade" }),
    repositorySnapshotId: uuid("repository_snapshot_id").references(() => spaceSkillRepositorySnapshots.id, { onDelete: "restrict" }),
    repositorySkillPath: text("repository_skill_path"),
    packageSnapshotId: uuid("package_snapshot_id").references(() => spaceSkillRepositorySnapshots.id, { onDelete: "restrict" }),
    packageFileMap: jsonb("package_file_map").$type<SkillPackageFileMapping[]>(),
    migrationAt: timestamp("migration_at", { withTimezone: true }).defaultNow(),
    revisionNumber: integer("revision_number").notNull(),
    label: text("label"),
    releaseId: text("release_id"),
    releaseName: text("release_name"),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    fileInventory: jsonb("file_inventory").$type<SpaceSkillVersionFileInventoryEntry[]>().notNull().default([]),
    authorAgentId: uuid("author_agent_id").references(() => agents.id, { onDelete: "set null" }),
    authorUserId: text("author_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    migrationIdx: index("space_skill_versions_migration_idx").on(table.migrationAt).where(sql`${table.migrationAt} is not null`),
    packageSnapshotIdx: index("space_skill_versions_package_snapshot_idx").on(table.packageSnapshotId),
    repositorySnapshotIdx: index("space_skill_versions_repository_snapshot_idx").on(table.repositorySnapshotId),
    spaceSkillRevisionUniqueIdx: uniqueIndex("space_skill_versions_skill_revision_idx").on(
      table.spaceSkillId,
      table.revisionNumber,
    ),
    spaceSkillReleaseUniqueIdx: uniqueIndex("space_skill_versions_skill_release_idx")
      .on(table.spaceSkillId, table.releaseId)
      .where(sql`${table.releaseId} is not null`),
    spaceSkillCreatedIdx: index("space_skill_versions_space_skill_created_idx").on(
      table.spaceId,
      table.spaceSkillId,
      table.createdAt,
    ),
  }),
);

export const spaceSkillStars = pgTable(
  "space_skill_stars",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
    spaceSkillId: uuid("space_skill_id").notNull().references(() => spaceSkills.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "cascade" }),
    userId: text("user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    spaceSkillAgentUniqueIdx: uniqueIndex("space_skill_stars_skill_agent_idx").on(table.spaceSkillId, table.agentId),
    spaceSkillUserUniqueIdx: uniqueIndex("space_skill_stars_skill_user_idx").on(table.spaceSkillId, table.userId),
    spaceSkillCreatedIdx: index("space_skill_stars_space_skill_created_idx").on(
      table.spaceId,
      table.spaceSkillId,
      table.createdAt,
    ),
  }),
);

export const spaceSkillComments = pgTable(
  "space_skill_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
    spaceSkillId: uuid("space_skill_id").notNull().references(() => spaceSkills.id, { onDelete: "cascade" }),
    parentCommentId: uuid("parent_comment_id").references((): AnyPgColumn => spaceSkillComments.id, { onDelete: "set null" }),
    authorAgentId: uuid("author_agent_id").references(() => agents.id, { onDelete: "set null" }),
    authorUserId: text("author_user_id"),
    body: text("body").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    spaceSkillCreatedIdx: index("space_skill_comments_space_skill_created_idx").on(
      table.spaceId,
      table.spaceSkillId,
      table.createdAt,
    ),
    parentIdx: index("space_skill_comments_parent_idx").on(table.parentCommentId),
  }),
);

export const spaceSkillTestInputs = pgTable(
  "space_skill_test_inputs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id").notNull().references(() => spaceSkills.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    content: text("content").notNull(),
    createdBy: text("created_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    spaceSkillNameIdx: index("space_skill_test_inputs_space_skill_name_idx").on(
      table.spaceId,
      table.skillId,
      table.name,
    ),
    spaceSkillActiveIdx: index("space_skill_test_inputs_space_skill_active_idx").on(
      table.spaceId,
      table.skillId,
      table.deletedAt,
    ),
  }),
);

export const spaceSkillTestRunTemplates = pgTable(
  "space_skill_test_run_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    body: text("body").notNull(),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdByUserId: text("created_by_user_id"),
    updatedByAgentId: uuid("updated_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    updatedByUserId: text("updated_by_user_id"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    spaceActiveIdx: index("space_skill_test_run_templates_space_active_idx").on(
      table.spaceId,
      table.deletedAt,
      table.name,
    ),
  }),
);

export const spaceSkillTestRuns = pgTable(
  "space_skill_test_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spaceId: uuid("space_id").notNull().references(() => spaces.id, { onDelete: "cascade" }),
    skillId: uuid("skill_id").notNull().references(() => spaceSkills.id, { onDelete: "cascade" }),
    inputId: uuid("input_id").references(() => spaceSkillTestInputs.id, { onDelete: "set null" }),
    inputSnapshot: text("input_snapshot").notNull(),
    skillVersionId: uuid("skill_version_id").notNull().references(() => spaceSkillVersions.id, { onDelete: "restrict" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "restrict" }),
    agentConfigSnapshot: jsonb("agent_config_snapshot").$type<Record<string, unknown>>().notNull().default({}),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "restrict" }),
    templateId: text("template_id"),
    templateName: text("template_name"),
    templateBody: text("template_body"),
    renderedTemplateBody: text("rendered_template_body"),
    harnessIssueDescription: text("harness_issue_description").notNull().default(""),
    status: text("status").notNull().default("queued"),
    outputDocumentKey: text("output_document_key").notNull().default("output"),
    outputSnapshot: text("output_snapshot").notNull().default(""),
    error: text("error"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    harnessIssueExpiresAt: timestamp("harness_issue_expires_at", { withTimezone: true }),
    harnessIssueDeletedAt: timestamp("harness_issue_deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    spaceSkillCreatedIdx: index("space_skill_test_runs_space_skill_created_idx").on(
      table.spaceId,
      table.skillId,
      table.createdAt,
    ),
    spaceIssueIdx: uniqueIndex("space_skill_test_runs_space_issue_idx").on(table.spaceId, table.issueId),
    spaceInputCreatedIdx: index("space_skill_test_runs_space_input_created_idx").on(
      table.spaceId,
      table.inputId,
      table.createdAt,
    ),
    spaceStatusIdx: index("space_skill_test_runs_space_status_idx").on(table.spaceId, table.status),
    spaceHarnessIssueExpiresIdx: index("space_skill_test_runs_space_harness_expires_idx").on(
      table.spaceId,
      table.harnessIssueExpiresAt,
    ),
  }),
);
