import { z } from "zod";

export const spaceSkillSourceTypeSchema = z.enum(["managed", "local_path", "github", "url", "catalog", "skills_sh"]);
export const spaceSkillTrustLevelSchema = z.enum(["markdown_only", "assets", "scripts_executables"]);
export const spaceSkillCompatibilitySchema = z.enum(["compatible", "unknown", "invalid"]);
export const spaceSkillSourceBadgeSchema = z.enum(["outpost", "github", "local", "url", "catalog", "skills_sh"]);
export const spaceSkillSharingScopeSchema = z.enum(["private", "space", "public_link"]);
export const spaceSkillListSortSchema = z.enum(["alphabetical", "recent", "installs", "stars", "agents", "forks"]);
export const spaceSkillListIncludeSchema = z.enum(["lastEditor"]);

export const spaceSkillFileInventoryEntrySchema = z.object({
  path: z.string().min(1),
  kind: z.enum(["skill", "markdown", "reference", "script", "asset", "other"]),
});

export const spaceSkillVersionFileInventoryEntrySchema = spaceSkillFileInventoryEntrySchema.extend({
  content: z.string(),
  encoding: z.enum(["utf8", "base64"]).optional(),
  executable: z.boolean().optional(),
});

export const spaceSkillSchema = z.object({
  id: z.string().guid(),
  spaceId: z.string().guid(),
  folderId: z.string().guid().nullable().optional(),
  folderPath: z.string().nullable().optional(),
  key: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  markdown: z.string(),
  sourceType: spaceSkillSourceTypeSchema,
  sourceLocator: z.string().nullable(),
  sourceRef: z.string().nullable(),
  trustLevel: spaceSkillTrustLevelSchema,
  compatibility: spaceSkillCompatibilitySchema,
  fileInventory: z.array(spaceSkillFileInventoryEntrySchema).default([]),
  iconUrl: z.string().nullable(),
  color: z.string().nullable(),
  tagline: z.string().nullable(),
  authorName: z.string().nullable(),
  homepageUrl: z.string().nullable(),
  categories: z.array(z.string().min(1)).default([]),
  sharingScope: spaceSkillSharingScopeSchema,
  publicShareToken: z.string().nullable(),
  forkedFromSkillId: z.string().guid().nullable(),
  forkedFromSpaceId: z.string().guid().nullable(),
  starCount: z.number().int().nonnegative(),
  installCount: z.number().int().nonnegative(),
  forkCount: z.number().int().nonnegative(),
  currentVersionId: z.string().guid().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const spaceSkillListItemSchema = spaceSkillSchema.extend({
  attachedAgentCount: z.number().int().nonnegative(),
  editable: z.boolean(),
  editableReason: z.string().nullable(),
  sourceLabel: z.string().nullable(),
  sourceBadge: spaceSkillSourceBadgeSchema,
  catalogKind: z.enum(["bundled", "optional"]).nullable(),
  originHash: z.string().nullable(),
  packageName: z.string().nullable(),
  packageVersion: z.string().nullable(),
  lastEditor: z.object({
    kind: z.enum(["user", "agent"]),
    id: z.string().min(1),
    name: z.string().nullable(),
    imageUrl: z.string().nullable(),
  }).nullable().optional(),
});

export const spaceSkillUsageAgentSchema = z.object({
  id: z.string().guid(),
  name: z.string().min(1),
  urlKey: z.string().min(1),
  adapterType: z.string().min(1),
  desired: z.boolean(),
  actualState: z.string().nullable().describe(
    "Runtime adapter skill state when explicitly fetched; space skill detail reads return null without probing agent runtimes.",
  ),
  versionId: z.string().guid().nullable(),
});

export const spaceSkillOriginalSummarySchema = z.object({
  id: z.string().guid(),
  name: z.string().min(1),
  slug: z.string().min(1),
  sourceType: spaceSkillSourceTypeSchema,
  sourceLocator: z.string().nullable(),
  sourceRef: z.string().nullable(),
});

export const spaceSkillForkSummarySchema = spaceSkillOriginalSummarySchema.extend({
  key: z.string().min(1),
  forkedFromSkillId: z.string().guid().nullable(),
  forkedFromSpaceId: z.string().guid().nullable(),
  currentVersionId: z.string().guid().nullable(),
  createdByCurrentActor: z.boolean(),
  diverged: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const spaceSkillListQuerySchema = z.object({
  q: z.string().min(1).optional(),
  sort: spaceSkillListSortSchema.optional(),
  categories: z.array(z.string().min(1)).optional(),
  scope: spaceSkillSharingScopeSchema.optional(),
  include: z.array(spaceSkillListIncludeSchema).optional(),
  folderId: z.string().guid().optional(),
  includeSubtree: z.boolean().optional(),
});

export const spaceSkillCategoryCountSchema = z.object({
  slug: z.string().min(1),
  count: z.number().int().nonnegative(),
});

export const spaceSkillVersionSchema = z.object({
  id: z.string().guid(),
  spaceId: z.string().guid(),
  spaceSkillId: z.string().guid(),
  revisionNumber: z.number().int().positive(),
  label: z.string().nullable(),
  fileInventory: z.array(spaceSkillVersionFileInventoryEntrySchema).default([]),
  authorAgentId: z.string().guid().nullable(),
  authorUserId: z.string().nullable(),
  createdAt: z.coerce.date(),
});

export const spaceSkillDetailSchema = spaceSkillSchema.extend({
  attachedAgentCount: z.number().int().nonnegative(),
  usedByAgents: z.array(spaceSkillUsageAgentSchema).default([]),
  existingForks: z.array(spaceSkillForkSummarySchema).default([]),
  editable: z.boolean(),
  editableReason: z.string().nullable(),
  sourceLabel: z.string().nullable(),
  sourceBadge: spaceSkillSourceBadgeSchema,
  currentVersion: spaceSkillVersionSchema.nullable(),
  starredByCurrentActor: z.boolean(),
});

export const spaceSkillVersionCreateSchema = z.object({
  sourceVersionId: z.string().guid().optional(),
  expectedVersionId: z.string().guid().nullable().optional(),
  label: z.string().trim().min(1).nullable().optional(),
}).default({});

export const spaceSkillStarResultSchema = z.object({
  skillId: z.string().guid(),
  starred: z.boolean(),
  starCount: z.number().int().nonnegative(),
});

export const spaceSkillCommentSchema = z.object({
  id: z.string().guid(),
  spaceId: z.string().guid(),
  spaceSkillId: z.string().guid(),
  parentCommentId: z.string().guid().nullable(),
  authorAgentId: z.string().guid().nullable(),
  authorUserId: z.string().nullable(),
  body: z.string(),
  deletedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const spaceSkillCommentCreateSchema = z.object({
  body: z.string().min(1),
  parentCommentId: z.string().guid().nullable().optional(),
});

export const spaceSkillCommentUpdateSchema = z.object({
  body: z.string().min(1),
});

export const spaceSkillForkSchema = z.object({
  name: z.string().min(1).nullable().optional(),
  slug: z.string().min(1).nullable().optional(),
  sharingScope: spaceSkillSharingScopeSchema.optional(),
  reassignAgentIds: z.array(z.string().guid()).optional(),
}).default({});

export const spaceSkillForkReassignmentSchema = z.object({
  agentId: z.string().guid(),
  previousSkillKey: z.string().min(1),
  nextSkillKey: z.string().min(1),
});

export const spaceSkillForkResultSchema = z.object({
  skill: spaceSkillSchema,
  original: spaceSkillOriginalSummarySchema,
  reassignments: z.array(spaceSkillForkReassignmentSchema),
});

export const spaceSkillForkPrecheckResultSchema = z.object({
  skillId: z.string().guid(),
  original: spaceSkillOriginalSummarySchema,
  agentUsageCount: z.number().int().nonnegative(),
  usedByAgents: z.array(spaceSkillUsageAgentSchema),
  existingForks: z.array(spaceSkillForkSummarySchema),
});

export const spaceSkillRenameSchema = z.object({
  expectedVersionId: z.string().guid().nullable().optional(),
  name: z.string().min(1).regex(/^[^\r\n]+$/, "Name must be a single line"),
  slug: z.string().min(1).nullable().optional(),
});

export const spaceSkillRenameResultSchema = z.object({
  skill: spaceSkillSchema,
  previousName: z.string(),
  previousSlug: z.string(),
  previousKey: z.string(),
  reassignments: z.array(spaceSkillForkReassignmentSchema),
});

export const spaceSkillUpdateSchema = z.object({
  description: z.string().nullable().optional(),
  iconUrl: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  tagline: z.string().max(120).nullable().optional(),
  authorName: z.string().nullable().optional(),
  homepageUrl: z.string().nullable().optional(),
  categories: z.array(z.string().min(1)).optional(),
  sharingScope: spaceSkillSharingScopeSchema.optional(),
}).default({});

export const spaceSkillUpdateStatusSchema = z.object({
  supported: z.boolean(),
  reason: z.string().nullable(),
  trackingRef: z.string().nullable(),
  currentRef: z.string().nullable(),
  latestRef: z.string().nullable(),
  hasUpdate: z.boolean(),
  installedHash: z.string().nullable(),
  originHash: z.string().nullable(),
  userModifiedAt: z.string().nullable(),
  updateHoldReason: z.enum([
    "local_modifications",
    "audit_hard_stop",
    "origin_unavailable",
    "compatibility_invalid",
    "operator_hold",
  ]).nullable(),
  auditVerdict: z.enum(["pass", "warning", "fail"]).nullable(),
  auditCodes: z.array(z.string()),
});

export const spaceSkillAuditFindingSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(["warning", "error"]),
  message: z.string().min(1),
  path: z.string().nullable(),
});

export const spaceSkillAuditResultSchema = z.object({
  skillId: z.string().guid(),
  installedHash: z.string().nullable(),
  originHash: z.string().nullable(),
  verdict: z.enum(["pass", "warning", "fail"]),
  codes: z.array(z.string()),
  findings: z.array(spaceSkillAuditFindingSchema),
  scannedAt: z.string().min(1),
  scanVersion: z.string().min(1),
});

export const spaceSkillInstallUpdateSchema = z.object({
  force: z.boolean().optional(),
  expectedVersionId: z.string().uuid().nullable().optional(),
}).default({});

export const spaceSkillImportSchema = z.object({
  source: z.string().min(1),
});

export const spaceSkillProjectScanRequestSchema = z.object({
  projectIds: z.array(z.string().guid()).optional(),
  workspaceIds: z.array(z.string().guid()).optional(),
  mode: z.enum(["import", "preview"]).optional(),
  selection: z.array(z.object({
    workspaceId: z.string().guid(),
    path: z.string().min(1),
    slug: z.string().min(1).optional(),
  })).optional(),
});

export const spaceSkillProjectBrowseRequestSchema = z.object({
  projectId: z.string().guid(),
  workspaceId: z.string().guid(),
  path: z.string().nullable().optional(),
});

export const spaceSkillProjectBrowseEntrySchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  kind: z.enum(["directory", "file"]),
  isSkill: z.boolean(),
});

export const spaceSkillProjectBrowseResultSchema = z.object({
  projectId: z.string().guid(),
  workspaceId: z.string().guid(),
  workspaceName: z.string().min(1),
  path: z.string().min(1),
  parentPath: z.string().nullable(),
  entries: z.array(spaceSkillProjectBrowseEntrySchema),
  truncated: z.boolean(),
});

export const spaceSkillProjectScanCandidateSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  workspaceId: z.string().guid(),
  workspaceName: z.string().min(1),
  projectId: z.string().guid(),
  projectName: z.string().min(1),
  directoryRoot: z.string().min(1),
  relativePath: z.string().min(1),
  status: z.enum(["new", "already_imported", "conflict", "skipped"]),
  existingSkillId: z.string().guid().optional(),
  reason: z.string().min(1).optional(),
});

export const spaceSkillProjectScanSkippedSchema = z.object({
  projectId: z.string().guid().nullable(),
  projectName: z.string().min(1).nullable(),
  workspaceId: z.string().guid().nullable(),
  workspaceName: z.string().nullable(),
  path: z.string().nullable(),
  reason: z.string().min(1),
});

export const spaceSkillProjectScanConflictSchema = z.object({
  slug: z.string().min(1),
  key: z.string().min(1),
  projectId: z.string().guid(),
  projectName: z.string().min(1),
  workspaceId: z.string().guid(),
  workspaceName: z.string().min(1),
  path: z.string().min(1),
  existingSkillId: z.string().guid(),
  existingSkillKey: z.string().min(1),
  existingSourceLocator: z.string().nullable(),
  reason: z.string().min(1),
});

export const spaceSkillProjectScanResultSchema = z.object({
  scannedProjects: z.number().int().nonnegative(),
  scannedWorkspaces: z.number().int().nonnegative(),
  discovered: z.number().int().nonnegative(),
  imported: z.array(spaceSkillSchema),
  updated: z.array(spaceSkillSchema),
  skipped: z.array(spaceSkillProjectScanSkippedSchema),
  conflicts: z.array(spaceSkillProjectScanConflictSchema),
  candidates: z.array(spaceSkillProjectScanCandidateSchema),
  warnings: z.array(z.string()),
});

export const spaceSkillCreateSchema = z.object({
  idempotencyKey: z.string().min(1).max(240).optional(),
  folderId: z.string().guid().nullable().optional(),
  name: z.string().min(1),
  slug: z.string().min(1).nullable().optional(),
  description: z.string().nullable().optional(),
  markdown: z.string().nullable().optional(),
  iconUrl: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  tagline: z.string().max(120).nullable().optional(),
  authorName: z.string().nullable().optional(),
  homepageUrl: z.string().nullable().optional(),
  categories: z.array(z.string().min(1)).optional(),
  sharingScope: spaceSkillSharingScopeSchema.optional(),
  forkedFromSkillId: z.string().guid().nullable().optional(),
});

export const spaceSkillFileDetailSchema = z.object({
  versionId: z.string().guid().nullable().optional(),
  encoding: z.enum(["utf8", "base64"]).optional(),
  executable: z.boolean().optional(),
  skillId: z.string().guid(),
  path: z.string().min(1),
  kind: z.enum(["skill", "markdown", "reference", "script", "asset", "other"]),
  content: z.string(),
  language: z.string().nullable(),
  markdown: z.boolean(),
  editable: z.boolean(),
});

export const spaceSkillFileUpdateSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  encoding: z.enum(["utf8", "base64"]).optional(),
  executable: z.boolean().optional(),
  expectedVersionId: z.string().guid().nullable().optional(),
  idempotencyKey: z.string().min(1).max(240).optional(),
});

export const spaceSkillFileDeleteSchema = z.object({
  expectedVersionId: z.string().guid().nullable().optional(),
  path: z.string().min(1),
  target: z.enum(["file", "folder"]),
});

export const spaceSkillTestRunStatusSchema = z.enum(["queued", "running", "succeeded", "failed", "cancelled"]);

export const spaceSkillTestInputSchema = z.object({
  id: z.string().guid(),
  spaceId: z.string().guid(),
  skillId: z.string().guid(),
  name: z.string().min(1),
  content: z.string(),
  createdBy: z.string().nullable(),
  deletedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const spaceSkillTestInputCreateSchema = z.object({
  name: z.string().trim().min(1),
  content: z.string().min(1),
});

export const spaceSkillTestInputUpdateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  content: z.string().min(1).optional(),
}).refine((value) => value.name !== undefined || value.content !== undefined, {
  message: "At least one field is required",
});

export const spaceSkillTestRunTemplateSchema = z.object({
  id: z.string().min(1),
  spaceId: z.string().guid(),
  name: z.string().min(1),
  description: z.string().nullable(),
  body: z.string().min(1),
  builtIn: z.boolean(),
  createdByAgentId: z.string().guid().nullable(),
  createdByUserId: z.string().nullable(),
  updatedByAgentId: z.string().guid().nullable(),
  updatedByUserId: z.string().nullable(),
  deletedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export const spaceSkillTestRunTemplateCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  body: z.string().min(1).max(20_000),
});

export const spaceSkillTestRunTemplateUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  body: z.string().min(1).max(20_000).optional(),
}).refine(
  (value) => value.name !== undefined || value.description !== undefined || value.body !== undefined,
  { message: "At least one field is required" },
);

export const spaceSkillTestRunTemplateSnapshotSchema = z.object({
  templateId: z.string().min(1).nullable(),
  templateName: z.string().min(1).nullable(),
  templateBody: z.string().min(1).max(20_000).nullable(),
}).refine(
  (value) =>
    (value.templateId === null && value.templateName === null && value.templateBody === null)
    || (value.templateId !== null && value.templateName !== null && value.templateBody !== null),
  { message: "Template snapshot must be all null or include id, name, and body" },
);

export const spaceSkillTestRunCostSummarySchema = z.object({
  costCents: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
});

export const spaceSkillTestRunSchema = z.object({
  id: z.string().guid(),
  spaceId: z.string().guid(),
  skillId: z.string().guid(),
  inputId: z.string().guid().nullable(),
  inputSnapshot: z.string(),
  skillVersionId: z.string().guid(),
  agentId: z.string().guid(),
  agentConfigSnapshot: z.record(z.string(), z.unknown()),
  issueId: z.string().guid(),
  templateId: z.string().nullable(),
  templateName: z.string().nullable(),
  templateBody: z.string().nullable(),
  renderedTemplateBody: z.string().nullable(),
  harnessIssueDescription: z.string(),
  status: spaceSkillTestRunStatusSchema,
  outputDocumentKey: z.string().min(1),
  outputSnapshot: z.string(),
  error: z.string().nullable(),
  deletedAt: z.coerce.date().nullable(),
  supersededAt: z.coerce.date().nullable(),
  harnessIssueExpiresAt: z.coerce.date().nullable(),
  harnessIssueDeletedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  cost: spaceSkillTestRunCostSummarySchema,
  taskExpired: z.boolean(),
});

export const spaceSkillTestRunCreateSchema = z.object({
  inputId: z.string().guid().nullable().optional(),
  content: z.string().min(1).nullable().optional(),
  agentId: z.string().guid(),
  templateId: z.string().min(1).nullable().optional(),
  templateSnapshot: spaceSkillTestRunTemplateSnapshotSchema.nullable().optional(),
  // Re-run pins the viewed run's skill version instead of the live head, so the
  // new run reproduces the same snapshots (golden-path step 5).
  skillVersionId: z.string().guid().nullable().optional(),
}).refine((value) => Boolean(value.inputId) || Boolean(value.content?.trim()), {
  message: "inputId or content is required",
});

export const spaceSkillTestRunListQuerySchema = z.object({
  inputId: z.string().guid().optional(),
});

export type SpaceSkillImport = z.infer<typeof spaceSkillImportSchema>;
export type SpaceSkillListQuery = z.infer<typeof spaceSkillListQuerySchema>;
export type SpaceSkillProjectScan = z.infer<typeof spaceSkillProjectScanRequestSchema>;
export type SpaceSkillProjectBrowse = z.infer<typeof spaceSkillProjectBrowseRequestSchema>;
export type SpaceSkillCreate = z.infer<typeof spaceSkillCreateSchema>;
export type SpaceSkillFileUpdate = z.infer<typeof spaceSkillFileUpdateSchema>;
export type SpaceSkillFileDelete = z.infer<typeof spaceSkillFileDeleteSchema>;
export type SpaceSkillTestInputCreate = z.infer<typeof spaceSkillTestInputCreateSchema>;
export type SpaceSkillTestInputUpdate = z.infer<typeof spaceSkillTestInputUpdateSchema>;
export type SpaceSkillTestRunTemplateCreate = z.infer<typeof spaceSkillTestRunTemplateCreateSchema>;
export type SpaceSkillTestRunTemplateUpdate = z.infer<typeof spaceSkillTestRunTemplateUpdateSchema>;
export type SpaceSkillTestRunCreate = z.infer<typeof spaceSkillTestRunCreateSchema>;
export type SpaceSkillTestRunListQuery = z.infer<typeof spaceSkillTestRunListQuerySchema>;
export type SpaceSkillVersionCreate = z.infer<typeof spaceSkillVersionCreateSchema>;
export type SpaceSkillCommentCreate = z.infer<typeof spaceSkillCommentCreateSchema>;
export type SpaceSkillCommentUpdate = z.infer<typeof spaceSkillCommentUpdateSchema>;
export type SpaceSkillFork = z.infer<typeof spaceSkillForkSchema>;
export type SpaceSkillRename = z.infer<typeof spaceSkillRenameSchema>;
export type SpaceSkillUpdate = z.infer<typeof spaceSkillUpdateSchema>;
export type SpaceSkillInstallUpdate = z.infer<typeof spaceSkillInstallUpdateSchema>;
