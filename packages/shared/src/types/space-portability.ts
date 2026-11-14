import type { AgentAppearance } from "../agent-appearance.js";
import type { AgentRunnerChoice } from "../agent-runner.js";
import type { AgentEnvConfig } from "./secrets.js";
import type { RoutineVariable } from "./routine.js";
import type { IssueCommentAuthorType, PermissionKey } from "../constants.js";
import type { IssueCommentMetadata, IssueCommentPresentation } from "./issue.js";

export interface SpacePortabilityInclude {
  space: boolean;
  agents: boolean;
  projects: boolean;
  issues: boolean;
  skills: boolean;
}

export interface SpacePortabilityEnvInput {
  key: string;
  description: string | null;
  agentSlug: string | null;
  projectSlug: string | null;
  kind: "secret" | "plain";
  requirement: "required" | "optional";
  defaultValue: string | null;
  portability: "portable" | "system_dependent";
}

export type SpacePortabilityFileEntry =
  | string
  | {
      encoding: "base64";
      data: string;
      contentType?: string | null;
    };

export interface SpacePortabilitySpaceManifestEntry {
  path: string;
  name: string;
  description: string | null;
  logoPath: string | null;
  requireOperatorApprovalForNewAgents: boolean;
  feedbackDataSharingEnabled: boolean;
  feedbackDataSharingConsentAt: string | null;
  feedbackDataSharingConsentByUserId: string | null;
  feedbackDataSharingTermsVersion: string | null;
}

export interface SpacePortabilitySidebarOrder {
  agents: string[];
  projects: string[];
}

export interface SpacePortabilityLabelManifestEntry {
  name: string;
  color: string;
}

export interface SpacePortabilityBlobManifestEntry {
  sha256: string;
  byteSize: number;
  contentType: string;
}

export interface SpacePortabilityEmbeddedAssetManifestEntry {
  /**
   * The asset id on the SOURCE operator. Source ids are only meaningful as the
   * rewrite key for the /api/assets/<assetId>/content references embedded in
   * the bundle's markdown; the importer mints fresh asset ids and rewrites
   * every reference to them.
   */
  assetId: string;
  /** Content address of the image bytes in the bundle's blobs/ store. */
  sha256: string;
  contentType: string;
  originalFilename: string | null;
  /**
   * Export categories whose files reference this asset ("agents",
   * "projects", "skills", "tasks", "routines"), or "always" when an
   * always-exported root file references it. Lets export selection follow
   * the toggles of the referencing files. Absent entries are treated as
   * always included.
   */
  ownedBy?: string[];
}

export interface SpacePortabilityProjectManifestEntry {
  slug: string;
  name: string;
  path: string;
  description: string | null;
  ownerAgentSlug: string | null;
  leadAgentSlug: string | null;
  targetDate: string | null;
  color: string | null;
  icon: string | null;
  status: string | null;
  env: AgentEnvConfig | null;
  executionWorkspacePolicy: Record<string, unknown> | null;
  workspaces: SpacePortabilityProjectWorkspaceManifestEntry[];
  metadata: Record<string, unknown> | null;
}

export interface SpacePortabilityProjectWorkspaceManifestEntry {
  key: string;
  name: string;
  sourceType: string | null;
  repoUrl: string | null;
  repoRef: string | null;
  defaultRef: string | null;
  visibility: string | null;
  setupCommand: string | null;
  cleanupCommand: string | null;
  metadata: Record<string, unknown> | null;
  isPrimary: boolean;
}

export interface SpacePortabilityIssueRoutineTriggerManifestEntry {
  kind: string;
  label: string | null;
  enabled: boolean;
  cronExpression: string | null;
  timezone: string | null;
  signingMode: string | null;
  replayWindowSec: number | null;
}

export interface SpacePortabilityIssueRoutineManifestEntry {
  concurrencyPolicy: string | null;
  catchUpPolicy: string | null;
  variables?: RoutineVariable[] | null;
  triggers: SpacePortabilityIssueRoutineTriggerManifestEntry[];
}

export interface SpacePortabilityIssueCommentManifestEntry {
  body: string;
  authorType: IssueCommentAuthorType;
  authorAgentSlug: string | null;
  authorUserId: string | null;
  presentation: IssueCommentPresentation | null;
  metadata: IssueCommentMetadata | null;
  createdAt: string | null;
}

export interface SpacePortabilityIssueDocumentManifestEntry {
  key: string;
  title: string | null;
  format: string;
  path: string;
}

export interface SpacePortabilityIssueWorkProductManifestEntry {
  type: string;
  provider: string;
  externalId: string | null;
  title: string;
  url: string | null;
  status: string;
  reviewState: string;
  isPrimary: boolean;
  healthStatus: string;
  summary: string | null;
  metadata: Record<string, unknown> | null;
}

export interface SpacePortabilityIssueMonitorManifestEntry {
  notes: string | null;
  scheduledBy: string | null;
  hadSchedule: boolean;
}

export interface SpacePortabilityIssueAttachmentManifestEntry {
  sha256: string;
  contentType: string;
  originalFilename: string | null;
  byteSize: number;
  commentIndex: number | null;
}

export interface SpacePortabilityIssueManifestEntry {
  slug: string;
  identifier: string | null;
  title: string;
  path: string;
  projectSlug: string | null;
  projectWorkspaceKey: string | null;
  assigneeAgentSlug: string | null;
  description: string | null;
  recurring: boolean;
  routine: SpacePortabilityIssueRoutineManifestEntry | null;
  legacyRecurrence: Record<string, unknown> | null;
  status: string | null;
  priority: string | null;
  labelIds: string[];
  labelNames?: string[];
  billingCode: string | null;
  executionWorkspaceSettings: Record<string, unknown> | null;
  assigneeAdapterOverrides: Record<string, unknown> | null;
  comments: SpacePortabilityIssueCommentManifestEntry[];
  blockedBy?: string[];
  documents?: SpacePortabilityIssueDocumentManifestEntry[];
  workProducts?: SpacePortabilityIssueWorkProductManifestEntry[];
  monitor?: SpacePortabilityIssueMonitorManifestEntry | null;
  attachments?: SpacePortabilityIssueAttachmentManifestEntry[];
  /** Slug of the parent task when it is part of the same bundle (schemaVersion >= 7). */
  parentSlug?: string | null;
  /** Preserved source timestamps as ISO strings (schemaVersion >= 7); absent in older bundles. */
  createdAt?: string | null;
  updatedAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
  metadata: Record<string, unknown> | null;
}

export interface SpacePortabilityAgentManifestEntry {
  runner?: AgentRunnerChoice;
  slug: string;
  name: string;
  path: string;
  skills: string[];
  role: string;
  title: string | null;
  icon: string | null;
  appearance?: AgentAppearance | null;
  capabilities: string | null;
  reportsToSlug: string | null;
  reportsToExistingAgentId: string | null;
  reportsToExistingAgentSlug: string | null;
  adapterType: string;
  adapterConfig: Record<string, unknown>;
  runtimeConfig: Record<string, unknown>;
  permissions: Record<string, unknown>;
  permissionGrants: Array<{
    permissionKey: PermissionKey;
    scope: Record<string, unknown> | null;
  }>;
  budgetMonthlyCents: number;
  metadata: Record<string, unknown> | null;
}

export interface SpacePortabilitySkillManifestEntry {
  key: string;
  slug: string;
  name: string;
  path: string;
  description: string | null;
  sourceType: string;
  sourceLocator: string | null;
  sourceRef: string | null;
  trustLevel: string | null;
  compatibility: string | null;
  metadata: Record<string, unknown> | null;
  fileInventory: Array<{
    path: string;
    kind: string;
  }>;
}

export interface SpacePortabilityManifest {
  schemaVersion: number;
  generatedAt: string;
  source: {
    spaceId: string;
    spaceName: string;
  } | null;
  includes: SpacePortabilityInclude;
  space: SpacePortabilitySpaceManifestEntry | null;
  sidebar: SpacePortabilitySidebarOrder | null;
  labels?: SpacePortabilityLabelManifestEntry[];
  blobs?: SpacePortabilityBlobManifestEntry[];
  embeddedAssets?: SpacePortabilityEmbeddedAssetManifestEntry[];
  agents: SpacePortabilityAgentManifestEntry[];
  skills: SpacePortabilitySkillManifestEntry[];
  projects: SpacePortabilityProjectManifestEntry[];
  issues: SpacePortabilityIssueManifestEntry[];
  envInputs: SpacePortabilityEnvInput[];
}

export interface SpacePortabilityExportResult {
  rootPath: string;
  manifest: SpacePortabilityManifest;
  files: Record<string, SpacePortabilityFileEntry>;
  warnings: string[];
  outpostExtensionPath: string;
}

export interface SpacePortabilityExportPreviewFile {
  path: string;
  kind: "space" | "agent" | "skill" | "project" | "issue" | "extension" | "readme" | "other";
}

export interface SpacePortabilityExportPreviewResult {
  rootPath: string;
  manifest: SpacePortabilityManifest;
  files: Record<string, SpacePortabilityFileEntry>;
  fileInventory: SpacePortabilityExportPreviewFile[];
  counts: {
    files: number;
    agents: number;
    skills: number;
    projects: number;
    issues: number;
  };
  warnings: string[];
  outpostExtensionPath: string;
}

export type SpacePortabilitySource =
  | {
      type: "inline";
      rootPath?: string | null;
      files: Record<string, SpacePortabilityFileEntry>;
      /**
       * Client-declared file count (`Object.keys(files).length`). The import
       * path fails closed when the received file set is smaller, so a
       * truncated inline body cannot import a fragment. Optional for callers
       * that predate the check.
       */
      expectedFileCount?: number;
    }
  | {
      type: "github";
      url: string;
    };

export type SpacePortabilityImportTarget =
  | {
      mode: "new_space";
      newSpaceName?: string | null;
    }
  | {
      mode: "existing_space";
      spaceId: string;
    };

export type SpacePortabilityAgentSelection = "all" | string[];

export type SpacePortabilityCollisionStrategy = "rename" | "skip" | "replace";

export interface SpacePortabilityPreviewRequest {
  source: SpacePortabilitySource;
  include?: Partial<SpacePortabilityInclude>;
  target: SpacePortabilityImportTarget;
  agents?: SpacePortabilityAgentSelection;
  collisionStrategy?: SpacePortabilityCollisionStrategy;
  nameOverrides?: Record<string, string>;
  selectedFiles?: string[];
}

export interface SpacePortabilityPreviewAgentPlan {
  slug: string;
  action: "create" | "update" | "skip";
  plannedName: string;
  existingAgentId: string | null;
  reason: string | null;
}

export interface SpacePortabilityPreviewProjectPlan {
  slug: string;
  action: "create" | "update" | "skip";
  plannedName: string;
  existingProjectId: string | null;
  reason: string | null;
}

export interface SpacePortabilityPreviewIssuePlan {
  slug: string;
  action: "create" | "skip";
  plannedTitle: string;
  reason: string | null;
}

export interface SpacePortabilityPreviewResult {
  include: SpacePortabilityInclude;
  targetSpaceId: string | null;
  targetSpaceName: string | null;
  collisionStrategy: SpacePortabilityCollisionStrategy;
  selectedAgentSlugs: string[];
  plan: {
    spaceAction: "none" | "create" | "update";
    agentPlans: SpacePortabilityPreviewAgentPlan[];
    projectPlans: SpacePortabilityPreviewProjectPlan[];
    issuePlans: SpacePortabilityPreviewIssuePlan[];
  };
  manifest: SpacePortabilityManifest;
  files: Record<string, SpacePortabilityFileEntry>;
  envInputs: SpacePortabilityEnvInput[];
  warnings: string[];
  errors: string[];
}

export interface SpacePortabilityAdapterOverride {
  runner?: AgentRunnerChoice;
  adapterType: string;
  adapterConfig?: Record<string, unknown>;
}

export interface SpacePortabilityImportRequest extends SpacePortabilityPreviewRequest {
  adapterOverrides?: Record<string, SpacePortabilityAdapterOverride>;
  secretValues?: Record<string, string>;
  pauseAutomations?: boolean;
}

export interface SpacePortabilityImportResult {
  space: {
    id: string;
    name: string;
    action: "created" | "updated" | "unchanged";
  };
  agents: {
    slug: string;
    id: string | null;
    action: "created" | "updated" | "skipped";
    name: string;
    reason: string | null;
  }[];
  skills: {
    originalKey: string;
    originalSlug: string;
    key: string;
    slug: string;
    id: string;
    action: "created" | "renamed" | "replaced" | "skipped";
    reason: string | null;
  }[];
  projects: {
    slug: string;
    id: string | null;
    action: "created" | "updated" | "skipped";
    name: string;
    reason: string | null;
  }[];
  routines: {
    slug: string;
    id: string | null;
    action: "created";
    title: string;
    status: string;
  }[];
  envInputs: SpacePortabilityEnvInput[];
  warnings: string[];
}

export interface SpacePortabilityExportRequest {
  include?: Partial<SpacePortabilityInclude>;
  agents?: string[];
  skills?: string[];
  projects?: string[];
  issues?: string[];
  projectIssues?: string[];
  selectedFiles?: string[];
  expandReferencedSkills?: boolean;
  sidebarOrder?: Partial<SpacePortabilitySidebarOrder>;
}
