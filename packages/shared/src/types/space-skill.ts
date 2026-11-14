import type { IssueAttachment, IssueDocument } from "./issue.js";
import type { IssueWorkProduct } from "./work-product.js";

export type SpaceSkillSourceType = "managed" | "local_path" | "github" | "url" | "catalog" | "skills_sh";

export type SpaceSkillTrustLevel = "markdown_only" | "assets" | "scripts_executables";

export type SpaceSkillCompatibility = "compatible" | "unknown" | "invalid";

export type SpaceSkillSourceBadge = "outpost" | "github" | "local" | "url" | "catalog" | "skills_sh";

export type SpaceSkillSharingScope = "private" | "space" | "public_link";

export type SpaceSkillListSort = "alphabetical" | "recent" | "installs" | "stars" | "agents" | "forks";

export type SpaceSkillListInclude = "lastEditor";

export interface SpaceSkillLastEditor {
  kind: "user" | "agent";
  id: string;
  name: string | null;
  imageUrl: string | null;
}

export interface SpaceSkillFileInventoryEntry {
  path: string;
  kind: "skill" | "markdown" | "reference" | "script" | "asset" | "other";
}

export interface SpaceSkillVersionFileInventoryEntry extends SpaceSkillFileInventoryEntry {
  content: string;
  encoding?: "utf8" | "base64";
  executable?: boolean;
}

export interface SpaceSkill {
  id: string;
  spaceId: string;
  folderId?: string | null;
  folderPath?: string | null;
  key: string;
  slug: string;
  name: string;
  description: string | null;
  markdown: string;
  sourceType: SpaceSkillSourceType;
  sourceLocator: string | null;
  sourceRef: string | null;
  trustLevel: SpaceSkillTrustLevel;
  compatibility: SpaceSkillCompatibility;
  fileInventory: SpaceSkillFileInventoryEntry[];
  iconUrl: string | null;
  color: string | null;
  tagline: string | null;
  authorName: string | null;
  homepageUrl: string | null;
  categories: string[];
  accessSourceId?: string | null;
  sharingScope: SpaceSkillSharingScope;
  publicShareToken: string | null;
  forkedFromSkillId: string | null;
  forkedFromSpaceId: string | null;
  starCount: number;
  installCount: number;
  forkCount: number;
  currentVersionId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SpaceSkillListItem {
  id: string;
  spaceId: string;
  folderId?: string | null;
  folderPath?: string | null;
  key: string;
  slug: string;
  name: string;
  description: string | null;
  sourceType: SpaceSkillSourceType;
  sourceLocator: string | null;
  sourceRef: string | null;
  trustLevel: SpaceSkillTrustLevel;
  compatibility: SpaceSkillCompatibility;
  fileInventory: SpaceSkillFileInventoryEntry[];
  iconUrl: string | null;
  color: string | null;
  tagline: string | null;
  authorName: string | null;
  homepageUrl: string | null;
  categories: string[];
  accessSourceId?: string | null;
  sharingScope: SpaceSkillSharingScope;
  publicShareToken: string | null;
  forkedFromSkillId: string | null;
  forkedFromSpaceId: string | null;
  starCount: number;
  installCount: number;
  forkCount: number;
  currentVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
  attachedAgentCount: number;
  editable: boolean;
  editableReason: string | null;
  sourceLabel: string | null;
  sourceBadge: SpaceSkillSourceBadge;
  sourcePath: string | null;
  catalogKind: "bundled" | "optional" | null;
  originHash: string | null;
  packageName: string | null;
  packageVersion: string | null;
  lastEditor?: SpaceSkillLastEditor | null;
}

export interface SpaceSkillUsageAgent {
  id: string;
  name: string;
  urlKey: string;
  adapterType: string;
  desired: boolean;
  /**
   * Runtime adapter skill state when a caller explicitly fetched it.
   * Space skill detail reads intentionally return null here to avoid probing
   * agent runtimes while loading operator-facing skill metadata.
   */
  actualState: string | null;
  versionId: string | null;
}

export interface SpaceSkillDetail extends SpaceSkill {
  attachedAgentCount: number;
  usedByAgents: SpaceSkillUsageAgent[];
  existingForks: SpaceSkillForkSummary[];
  editable: boolean;
  editableReason: string | null;
  sourceLabel: string | null;
  sourceBadge: SpaceSkillSourceBadge;
  sourcePath: string | null;
  currentVersion: SpaceSkillVersionSummary | null;
  starredByCurrentActor: boolean;
}

export interface SpaceSkillListQuery {
  q?: string;
  sort?: SpaceSkillListSort;
  categories?: string[];
  scope?: SpaceSkillSharingScope;
  include?: SpaceSkillListInclude[];
  folderId?: string;
  includeSubtree?: boolean;
}

export interface SpaceSkillCategoryCount {
  slug: string;
  count: number;
}

export interface SpaceSkillVersion {
  repositorySnapshotId?: string | null;
  repositorySkillPath?: string | null;
  id: string;
  spaceId: string;
  spaceSkillId: string;
  revisionNumber: number;
  label: string | null;
  releaseId: string | null;
  releaseName: string | null;
  releasedAt: Date | null;
  fileInventory: SpaceSkillVersionFileInventoryEntry[];
  authorAgentId: string | null;
  authorUserId: string | null;
  createdAt: Date;
}

/** Version listings carry file names/kinds; fetch one version to read its bytes. */
export type SpaceSkillVersionSummary = Omit<SpaceSkillVersion, "fileInventory"> & {
  fileInventory: SpaceSkillFileInventoryEntry[];
};

export interface SpaceSkillVersionCreateRequest {
  sourceVersionId?: string;
  expectedVersionId?: string | null;
  label?: string | null;
}

export interface SpaceSkillStarResult {
  skillId: string;
  starred: boolean;
  starCount: number;
}

export interface SpaceSkillComment {
  id: string;
  spaceId: string;
  spaceSkillId: string;
  parentCommentId: string | null;
  authorAgentId: string | null;
  authorUserId: string | null;
  body: string;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SpaceSkillCommentCreateRequest {
  body: string;
  parentCommentId?: string | null;
}

export interface SpaceSkillCommentUpdateRequest {
  body: string;
}

export interface SpaceSkillForkRequest {
  name?: string | null;
  slug?: string | null;
  sharingScope?: SpaceSkillSharingScope;
  reassignAgentIds?: string[];
}

export interface SpaceSkillOriginalSummary {
  id: string;
  name: string;
  slug: string;
  sourceType: SpaceSkillSourceType;
  sourceLocator: string | null;
  sourceRef: string | null;
}

export interface SpaceSkillForkSummary extends SpaceSkillOriginalSummary {
  key: string;
  forkedFromSkillId: string | null;
  forkedFromSpaceId: string | null;
  currentVersionId: string | null;
  createdByCurrentActor: boolean;
  diverged: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SpaceSkillForkReassignment {
  agentId: string;
  previousSkillKey: string;
  nextSkillKey: string;
}

export interface SpaceSkillForkResult {
  skill: SpaceSkill;
  original: SpaceSkillOriginalSummary;
  reassignments: SpaceSkillForkReassignment[];
}

export interface SpaceSkillForkPrecheckResult {
  skillId: string;
  original: SpaceSkillOriginalSummary;
  agentUsageCount: number;
  usedByAgents: SpaceSkillUsageAgent[];
  existingForks: SpaceSkillForkSummary[];
}

export interface SpaceSkillRenameRequest {
  expectedVersionId?: string | null;
  name: string;
  slug?: string | null;
}

export interface SpaceSkillRenameResult {
  skill: SpaceSkill;
  previousName: string;
  previousSlug: string;
  previousKey: string;
  reassignments: SpaceSkillForkReassignment[];
}

export interface SpaceSkillUpdateRequest {
  description?: string | null;
  iconUrl?: string | null;
  color?: string | null;
  tagline?: string | null;
  authorName?: string | null;
  homepageUrl?: string | null;
  categories?: string[];
  sharingScope?: SpaceSkillSharingScope;
}

export interface SpaceSkillUpdateStatus {
  supported: boolean;
  reason: string | null;
  trackingRef: string | null;
  currentRef: string | null;
  latestRef: string | null;
  hasUpdate: boolean;
  installedHash: string | null;
  originHash: string | null;
  userModifiedAt: string | null;
  updateHoldReason: SpaceSkillUpdateHoldReason | null;
  auditVerdict: SpaceSkillAuditVerdict | null;
  auditCodes: string[];
}

export type SpaceSkillAuditSeverity = "warning" | "error";

export type SpaceSkillAuditVerdict = "pass" | "warning" | "fail";

export type SpaceSkillUpdateHoldReason =
  | "local_modifications"
  | "audit_hard_stop"
  | "origin_unavailable"
  | "compatibility_invalid"
  | "operator_hold";

export interface SpaceSkillAuditFinding {
  code: string;
  severity: SpaceSkillAuditSeverity;
  message: string;
  path: string | null;
}

export interface SpaceSkillAuditResult {
  skillId: string;
  installedHash: string | null;
  originHash: string | null;
  verdict: SpaceSkillAuditVerdict;
  codes: string[];
  findings: SpaceSkillAuditFinding[];
  scannedAt: string;
  scanVersion: string;
}

export interface SpaceSkillInstallUpdateRequest {
  force?: boolean;
  expectedVersionId?: string | null;
}

export interface SpaceSkillResetRequest {
  force?: boolean;
  expectedVersionId?: string | null;
}

export interface SpaceSkillImportRequest {
  source: string;
}

export interface SpaceSkillImportResult {
  imported: SpaceSkill[];
  warnings: string[];
}

export interface SpaceSkillProjectScanRequest {
  projectIds?: string[];
  workspaceIds?: string[];
  mode?: "import" | "preview";
  selection?: Array<{
    workspaceId: string;
    path: string;
    slug?: string;
  }>;
}

export interface SpaceSkillProjectBrowseRequest {
  projectId: string;
  workspaceId: string;
  path?: string | null;
}

export interface SpaceSkillProjectBrowseEntry {
  name: string;
  path: string;
  kind: "directory" | "file";
  isSkill: boolean;
}

export interface SpaceSkillProjectBrowseResult {
  projectId: string;
  workspaceId: string;
  workspaceName: string;
  path: string;
  parentPath: string | null;
  entries: SpaceSkillProjectBrowseEntry[];
  truncated: boolean;
}

export type SpaceSkillProjectScanCandidateStatus = "new" | "already_imported" | "conflict" | "skipped";

export interface SpaceSkillProjectScanCandidate {
  slug: string;
  name: string;
  description: string | null;
  workspaceId: string;
  workspaceName: string;
  projectId: string;
  projectName: string;
  directoryRoot: string;
  relativePath: string;
  status: SpaceSkillProjectScanCandidateStatus;
  existingSkillId?: string;
  reason?: string;
}

export interface SpaceSkillProjectScanSkipped {
  projectId: string | null;
  projectName: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  path: string | null;
  reason: string;
}

export interface SpaceSkillProjectScanConflict {
  slug: string;
  key: string;
  projectId: string;
  projectName: string;
  workspaceId: string;
  workspaceName: string;
  path: string;
  existingSkillId: string;
  existingSkillKey: string;
  existingSourceLocator: string | null;
  reason: string;
}

export interface SpaceSkillProjectScanResult {
  scannedProjects: number;
  scannedWorkspaces: number;
  discovered: number;
  imported: SpaceSkill[];
  updated: SpaceSkill[];
  skipped: SpaceSkillProjectScanSkipped[];
  conflicts: SpaceSkillProjectScanConflict[];
  candidates: SpaceSkillProjectScanCandidate[];
  warnings: string[];
}

export interface SpaceSkillCreateRequest {
  idempotencyKey?: string;
  folderId?: string | null;
  name: string;
  slug?: string | null;
  description?: string | null;
  markdown?: string | null;
  iconUrl?: string | null;
  color?: string | null;
  tagline?: string | null;
  authorName?: string | null;
  homepageUrl?: string | null;
  categories?: string[];
  sharingScope?: SpaceSkillSharingScope;
  forkedFromSkillId?: string | null;
}

export interface SpaceSkillFileDetail {
  versionId?: string | null;
  encoding?: "utf8" | "base64";
  executable?: boolean;
  skillId: string;
  path: string;
  kind: SpaceSkillFileInventoryEntry["kind"];
  content: string;
  language: string | null;
  markdown: boolean;
  editable: boolean;
}

export interface SpaceSkillFileUpdateRequest {
  expectedVersionId?: string | null;
  idempotencyKey?: string;
  encoding?: "utf8" | "base64";
  executable?: boolean;
  path: string;
  content: string;
}

export interface SpaceSkillFileDeleteRequest {
  expectedVersionId?: string | null;
  path: string;
  target: "file" | "folder";
}

export interface SpaceSkillFileDeleteResult {
  versionId?: string | null;
  skillId: string;
  path: string;
  target: "file" | "folder";
  deletedPaths: string[];
}

export type SpaceSkillTestRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface SpaceSkillTestInput {
  id: string;
  spaceId: string;
  skillId: string;
  name: string;
  content: string;
  createdBy: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SpaceSkillTestInputCreateRequest {
  name: string;
  content: string;
}

export interface SpaceSkillTestInputUpdateRequest {
  name?: string;
  content?: string;
}

export interface SpaceSkillTestRunTemplate {
  id: string;
  spaceId: string;
  name: string;
  description: string | null;
  body: string;
  builtIn: boolean;
  createdByAgentId: string | null;
  createdByUserId: string | null;
  updatedByAgentId: string | null;
  updatedByUserId: string | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SpaceSkillTestRunTemplateCreateRequest {
  name: string;
  description?: string | null;
  body: string;
}

export interface SpaceSkillTestRunTemplateUpdateRequest {
  name?: string;
  description?: string | null;
  body?: string;
}

export interface SpaceSkillTestRunTemplateSnapshot {
  templateId: string | null;
  templateName: string | null;
  templateBody: string | null;
}

export interface SpaceSkillTestRunCostSummary {
  costCents: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

export interface SpaceSkillTestRun {
  id: string;
  spaceId: string;
  skillId: string;
  inputId: string | null;
  inputSnapshot: string;
  skillVersionId: string;
  agentId: string;
  agentConfigSnapshot: Record<string, unknown>;
  issueId: string;
  templateId: string | null;
  templateName: string | null;
  templateBody: string | null;
  renderedTemplateBody: string | null;
  harnessIssueDescription: string;
  status: SpaceSkillTestRunStatus;
  outputDocumentKey: string;
  outputSnapshot: string;
  error: string | null;
  deletedAt: Date | null;
  supersededAt: Date | null;
  harnessIssueExpiresAt: Date | null;
  harnessIssueDeletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  cost: SpaceSkillTestRunCostSummary;
  taskExpired: boolean;
}

export interface SpaceSkillTestRunCreateRequest {
  inputId?: string | null;
  content?: string | null;
  agentId: string;
  /**
   * Omitted uses the built-in default template, null means "No template", and
   * a string selects a built-in or custom template id.
   */
  templateId?: string | null;
  /**
   * Re-run can provide the viewed run's template body snapshot so the new run
   * does not silently pick up later edits to the source template.
   */
  templateSnapshot?: SpaceSkillTestRunTemplateSnapshot | null;
  /**
   * Pin a specific skill version for this run instead of the live head. Used by
   * Re-run to reproduce the viewed run's `skillVersionId` snapshot.
   */
  skillVersionId?: string | null;
}

export interface SpaceSkillTestRunListQuery {
  inputId?: string;
}

export type SpaceSkillTestRunHarnessContentUnavailableReason = "expired" | "deleted" | "missing";

/**
 * Rich renderable content hydrated from the run's own hidden harness issue.
 * When the harness issue has expired or been deleted, `available` is false and
 * the collections are empty; stored run snapshots (input/output/template)
 * remain usable on the run itself.
 */
export interface SpaceSkillTestRunHarnessContent {
  available: boolean;
  unavailableReason: SpaceSkillTestRunHarnessContentUnavailableReason | null;
  documents: IssueDocument[];
  attachments: IssueAttachment[];
  workProducts: IssueWorkProduct[];
}

export interface SpaceSkillTestRunDetail extends SpaceSkillTestRun {
  skillVersion: SpaceSkillVersionSummary;
  outputBody: string;
  harnessContent: SpaceSkillTestRunHarnessContent;
  harnessIssue: {
    id: string;
    identifier: string | null;
    title: string;
    status: string;
    hiddenAt: Date | null;
  } | null;
  documents: Array<{
    key: string;
    title: string | null;
    updatedAt: Date;
    body: string;
  }>;
  interactions: Array<{
    id: string;
    kind: string;
    status: string;
    title: string;
    createdAt: Date;
    updatedAt: Date;
  }>;
  artifacts: Array<{
    id: string;
    kind: "attachment" | "work_product";
    title: string;
    summary: string | null;
    createdAt: Date;
  }>;
}

export type CatalogSkillKind = "bundled" | "optional";

export type CatalogSkillFileKind = SpaceSkillFileInventoryEntry["kind"];

export interface CatalogSkillFile {
  path: string;
  kind: CatalogSkillFileKind;
  sizeBytes: number;
  sha256: string;
}

export interface CatalogSkillGitHubSource {
  type: "github";
  hostname: string;
  owner: string;
  repo: string;
  ref: string;
  commit: string;
  path: string;
  url: string;
}

export type CatalogSkillSource = CatalogSkillGitHubSource;

export interface CatalogSkill {
  id: string;
  key: string;
  kind: CatalogSkillKind;
  category: string;
  slug: string;
  name: string;
  description: string;
  path: string;
  entrypoint: "SKILL.md";
  trustLevel: SpaceSkillTrustLevel;
  compatibility: SpaceSkillCompatibility;
  defaultInstall: boolean;
  recommendedForRoles: string[];
  requires: string[];
  tags: string[];
  files: CatalogSkillFile[];
  contentHash: string;
  source?: CatalogSkillSource;
  packageName?: string;
  packageVersion?: string;
}

export interface CatalogSkillListQuery {
  kind?: CatalogSkillKind;
  category?: string;
  q?: string;
}

export interface CatalogSkillFileDetail {
  catalogSkillId: string;
  path: string;
  kind: CatalogSkillFileKind;
  content: string;
  language: string | null;
  markdown: boolean;
}

export interface SpaceSkillInstallCatalogRequest {
  catalogSkillId: string;
  slug?: string | null;
  force?: boolean;
}

export interface SpaceSkillInstallCatalogResult {
  action: "created" | "updated" | "unchanged";
  skill: SpaceSkill;
  catalogSkill: CatalogSkill;
  warnings: string[];
}
