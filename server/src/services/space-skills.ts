import { skillExecutionContent } from "./skill-execution-content.js";
import { notifySkillVersionRetention } from "./skill-version-retention-notifications.js";
import { managedSkillContent, type SkillContentPublication } from "./managed-skill-content.js";
import { DELIVERY_QUEUES, notifyDeliveryWork } from "./delivery-work-notifications.js";
import { verifyFileManifest } from "./file-manifest-cache.js";
import { skillPackageStorageEnabled, skillPackageStore, skillVersionFileMap, skillVersionUsesWholePackage, skillVersionMetadataColumns, withSkillPackageReadScope, type StoredSkillVersion } from "./skill-package-store.js";
import { skillPackageRuntime } from "./skill-package-runtime.js";
import type { SkillPackageFileMapping } from "@outpost/db";
import { ensureSkillCacheDirectory, protectedVersions, withSkillVersionCacheLock } from "./skill-version-cache.js";
import { measureRunPhase } from "./execution-preparation-timing.js";
import { verifyExistingBundledSkillRelease } from "./bundled-skill-release-validation.js";
import { retainProjectSkillAccess, skillAccessService } from "./skill-access.js";
import { assertLocalImportOutsideSkillPackageCache } from "./skill-local-import-boundary.js";
import type { AuthorizationActor } from "./authorization.js";
import { updateAgentConfigurationInTransaction } from "./agent-configuration-transaction.js";
import { logger } from "../middleware/logger.js";
import { removeRuntimeSkillCache, resolveRuntimeSkillCache, runtimeSkillCacheSpec } from "./runtime-skill-cache.js";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { skillFileBytes, snapshotFile, assertSkillSnapshotPath, skillSnapshotHash, MAX_SKILL_SNAPSHOT_BYTES, MAX_SKILL_SNAPSHOT_FILES } from "./skill-snapshot.js";
import { fileURLToPath } from "node:url";
import { and, asc, desc, eq, inArray, isNull, isNotNull, lt, ne, or, sql } from "drizzle-orm";
import type { Db } from "@outpost/db";
import {
  agents as agentsTable,
  assets,
  authUsers,
  spaces,
  spaceSkillComments,
  spaceSkillStars,
  spaceSkillTestInputs,
  spaceSkillTestRunTemplates,
  spaceSkillTestRuns,
  spaceSkillVersions, withDedicatedDbConnection,
  spaceSkills,
  spaceSkillRepositorySnapshots,
  costEvents,
  documents,
  issueAttachments,
  issueDocuments,
  issues,
  issueThreadInteractions,
  issueWorkProducts,
} from "@outpost/db";
import { readOutpostSkillSyncPreference, writeOutpostSkillSyncPreference, resolveOutpostDesiredSkillNames,
  resolveLegacyOutpostDesiredSkillNames } from "@outpost/adapter-utils/server-utils";
import { REPOSITORY_CONTENT_DIR, repositorySkillProjection } from "./skill-repository-package.js";
import type { OutpostDesiredSkillEntry, OutpostSkillEntry } from "@outpost/adapter-utils/server-utils";
import type {
  AgentDesiredSkillEntry,
  SpaceSkill,
  SpaceSkillAuditFinding,
  SpaceSkillAuditResult,
  SpaceSkillAuditVerdict,
  SpaceSkillCategoryCount,
  SpaceSkillComment,
  SpaceSkillCommentCreateRequest,
  SpaceSkillCommentUpdateRequest,
  SpaceSkillCreateRequest,
  SpaceSkillCompatibility,
  SpaceSkillDetail,
  SpaceSkillFileDeleteRequest,
  SpaceSkillFileDeleteResult,
  SpaceSkillFileDetail,
  SpaceSkillFileInventoryEntry,
  SpaceSkillForkPrecheckResult,
  SpaceSkillForkRequest,
  SpaceSkillForkResult,
  SpaceSkillForkReassignment,
  SpaceSkillForkSummary,
  SpaceSkillImportResult,
  SpaceSkillListQuery,
  SpaceSkillListItem,
  SpaceSkillLastEditor,
  SpaceSkillOriginalSummary,
  SpaceSkillProjectBrowseRequest,
  SpaceSkillProjectBrowseResult,
  SpaceSkillProjectScanConflict,
  SpaceSkillProjectScanCandidate,
  SpaceSkillProjectScanRequest,
  SpaceSkillProjectScanResult,
  SpaceSkillProjectScanSkipped,
  SpaceSkillRenameRequest,
  SpaceSkillRenameResult,
  SpaceSkillSharingScope,
  SpaceSkillSourceBadge,
  SpaceSkillSourceType,
  SpaceSkillTestInput,
  SpaceSkillTestInputCreateRequest,
  SpaceSkillTestInputUpdateRequest,
  SpaceSkillTestRun,
  SpaceSkillTestRunCreateRequest,
  SpaceSkillTestRunDetail,
  SpaceSkillTestRunHarnessContent,
  SpaceSkillTestRunListQuery,
  SpaceSkillTestRunTemplate,
  SpaceSkillTestRunTemplateCreateRequest,
  SpaceSkillTestRunTemplateSnapshot,
  SpaceSkillTestRunTemplateUpdateRequest,
  SpaceSkillTestRunStatus,
  SpaceSkillTrustLevel,
  SpaceSkillUpdateRequest,
  SpaceSkillUpdateStatus,
  SpaceSkillUpdateHoldReason,
  SpaceSkillUsageAgent,
  SpaceSkillVersion,
  SpaceSkillVersionSummary,
  SpaceSkillVersionCreateRequest,
  SpaceSkillVersionFileInventoryEntry,
  IssueAttachment,
  IssueDocument,
} from "@outpost/shared";
import {
  isUuidLike,
  joinFrontmatterBlock,
  normalizeAgentUrlKey,
  parseFrontmatterMarkdown,
  splitFrontmatterBlock,
  stringifyFrontmatter,
} from "@outpost/shared";
import { resolveOutpostInstanceRoot } from "../home-paths.js";
import { conflict, forbidden, notFound, unprocessable } from "../errors.js";
import { ghFetch, gitHubApiBase, resolveRawGitHubUrl } from "./github-fetch.js";
import { agentService } from "./agents.js";
import { issueDocumentSelect, mapIssueDocumentRow } from "./documents.js";
import { toIssueWorkProduct } from "./work-products.js";
import { projectService } from "./projects.js";
import { normalizePortablePath } from "./portable-path.js";
import { folderService } from "./folders.js";

type SpaceSkillRow = typeof spaceSkills.$inferSelect;
type SpaceSkillVersionRow = typeof spaceSkillVersions.$inferSelect;
type SpaceSkillCommentRow = typeof spaceSkillComments.$inferSelect;
type SpaceSkillTestInputRow = typeof spaceSkillTestInputs.$inferSelect;
type SpaceSkillTestRunTemplateRow = typeof spaceSkillTestRunTemplates.$inferSelect;
type SpaceSkillTestRunRow = typeof spaceSkillTestRuns.$inferSelect;
type SpaceSkillListDbRow = Pick<
  SpaceSkillRow,
  | "id"
  | "spaceId"
  | "folderId"
  | "key"
  | "slug"
  | "name"
  | "description"
  | "sourceType"
  | "sourceLocator"
  | "sourceRef"
  | "trustLevel"
  | "compatibility"
  | "fileInventory"
  | "iconUrl"
  | "color"
  | "tagline"
  | "authorName"
  | "homepageUrl"
  | "categories"
  | "sharingScope"
  | "publicShareToken"
  | "forkedFromSkillId"
  | "forkedFromSpaceId"
  | "starCount"
  | "installCount"
  | "forkCount"
  | "currentVersionId"
  | "metadata"
  | "createdAt"
  | "updatedAt"
>;
type SpaceSkillListRow = Pick<
  SpaceSkill,
  | "id"
  | "spaceId"
  | "folderId"
  | "folderPath"
  | "key"
  | "slug"
  | "name"
  | "description"
  | "sourceType"
  | "sourceLocator"
  | "sourceRef"
  | "trustLevel"
  | "compatibility"
  | "fileInventory"
  | "iconUrl"
  | "color"
  | "tagline"
  | "authorName"
  | "homepageUrl"
  | "categories"
  | "sharingScope"
  | "publicShareToken"
  | "forkedFromSkillId"
  | "forkedFromSpaceId"
  | "starCount"
  | "installCount"
  | "forkCount"
  | "currentVersionId"
  | "metadata"
  | "createdAt"
  | "updatedAt"
>;
type SpaceSkillReferenceRow = Pick<
  SpaceSkillRow,
  | "id"
  | "key"
  | "slug"
>;
type SkillReferenceTarget = Pick<SpaceSkill, "id" | "key" | "slug">;
type SkillSourceInfoTarget = Pick<
  SpaceSkill,
  | "spaceId"
  | "sourceType"
  | "sourceLocator"
  | "metadata"
>;

type ImportedSkill = {
  key: string;
  slug: string;
  name: string;
  description: string | null;
  markdown: string;
  packageDir?: string | null;
  sourceType: SpaceSkillSourceType;
  sourceLocator: string | null;
  sourceRef: string | null;
  trustLevel: SpaceSkillTrustLevel;
  compatibility: SpaceSkillCompatibility;
  fileInventory: SpaceSkillFileInventoryEntry[];
  metadata: Record<string, unknown> | null;
};

type ImportedSkillPersistValues = Pick<
  SpaceSkill,
  | "spaceId"
  | "folderId"
  | "key"
  | "slug"
  | "name"
  | "description"
  | "markdown"
  | "accessSourceId"
  | "sourceType"
  | "sourceLocator"
  | "sourceRef"
  | "trustLevel"
  | "compatibility"
  | "iconUrl"
  | "color"
  | "tagline"
  | "authorName"
  | "homepageUrl"
  | "categories"
  | "sharingScope"
  | "installCount"
> & {
  fileInventory: Array<Record<string, unknown>>;
  metadata: Record<string, unknown>;
  updatedAt: Date;
};

type PackageSkillConflictStrategy = "replace" | "rename" | "skip";

export type ImportPackageSkillResult = {
  skill: SpaceSkill;
  action: "created" | "renamed" | "replaced" | "skipped";
  originalKey: string;
  originalSlug: string;
  requestedRefs: string[];
  reason: string | null;
};

type ParsedSkillImportSource = {
  resolvedSource: string;
  requestedSkillSlug: string | null;
  originalSkillsShUrl: string | null;
  warnings: string[];
};

const EXTERNAL_SKILL_SOURCE_TYPES = new Set<SpaceSkillSourceType>(["github", "skills_sh", "url"]);

function isPinnedCommitRef(value: string | null | undefined) {
  return Boolean(value && /^[0-9a-f]{40}$/i.test(value.trim()));
}

function assertImportedSkillSourceAllowed(skill: ImportedSkill) {
  if (!EXTERNAL_SKILL_SOURCE_TYPES.has(skill.sourceType)) return;
  if (skill.trustLevel === "scripts_executables") {
    throw unprocessable(
      `External skill source "${skill.slug}" contains executable scripts and cannot be imported.`,
      {
        sourceType: skill.sourceType,
        trustLevel: skill.trustLevel,
        reason: "scripts_executables_blocked",
      },
    );
  }
  if ((skill.sourceType === "github" || skill.sourceType === "skills_sh") && !isPinnedCommitRef(skill.sourceRef)) {
    throw unprocessable(
      `External skill source "${skill.slug}" must resolve to a pinned Git commit before import.`,
      {
        sourceType: skill.sourceType,
        trustLevel: skill.trustLevel,
        reason: "unpinned_external_source",
      },
    );
  }
}

function assertImportedSkillKeyAllowed(skill: ImportedSkill) {
  if (!skill.key.startsWith("outpost/outpost/")) return;
  const metadata = isPlainRecord(skill.metadata) ? skill.metadata : null;
  const sourceKind = asString(metadata?.sourceKind);
  if (sourceKind === "outpost_bundled") return;
  throw unprocessable(
    `Reserved Outpost skill key "${skill.key}" cannot be imported from unbundled sources.`,
    {
      skillKey: skill.key,
      sourceKind: sourceKind ?? skill.sourceType,
    },
  );
}

type SkillSourceMeta = {
  skillKey?: string;
  sourceKind?: string;
  missingSource?: SkillMissingSourceMarker;
  hostname?: string;
  owner?: string;
  repo?: string;
  ref?: string;
  trackingRef?: string;
  repoSkillDir?: string;
  projectId?: string;
  projectName?: string;
  workspaceId?: string;
  workspaceName?: string;
  workspaceCwd?: string;
  catalogId?: string;
  catalogKind?: string;
  originHash?: string;
  packageName?: string;
  packageVersion?: string;
  originVersion?: string;
  originVersionId?: string;
  originSnapshotLocator?: string;
  installedHash?: string;
  forkedByAgentId?: string | null;
  forkedByUserId?: string | null;
  userModifiedAt?: string | null;
  updateHoldReason?: SpaceSkillUpdateHoldReason | null;
  auditVerdict?: SpaceSkillAuditVerdict;
  auditCodes?: string[];
  auditScannedAt?: string;
  auditScanVersion?: string;
};

type SkillMissingSourceMarker = {
  reason: "local_source_missing";
  sourceType: "local_path";
  sourceLocator: string | null;
  sourcePath: string | null;
  detectedAt: string;
};

export type LocalSkillInventoryMode = "full" | "project_root";

export type ProjectSkillScanTarget = {
  projectId: string;
  projectName: string;
  workspaceId: string;
  workspaceName: string;
  workspaceCwd: string;
};

export type RuntimeSkillVersionSelection = {
  spaceId: string;
  skillId: string;
  key: string;
  runtimeName: string;
  versionId: string | null;
  currentVersionId: string | null;
};

type RuntimeSkillEntryOptions = {
  selectVersions?: (entries: RuntimeSkillVersionSelection[]) => Promise<Set<string>>;
  materializeMissing?: boolean;
  versionSelections?: Map<string, string | null>;
  selectionConfig?: Record<string, unknown>;
  includeLegacy?: boolean;
  onlyKeys?: Set<string>;
  snapshotLatest?: boolean;
};

type SkillActor = {
  type: "agent" | "user" | "system";
  agentId?: string | null;
  userId?: string | null;
};

type BundledSkillReleaseManifestEntry = {
  id: string;
  releaseName: string;
  releasedAt: string;
  notes: string;
  dir: string;
};

type CreateVersionOptions = {
  publication?: SkillContentPublication;
  repositorySnapshotId?: string;
  repositorySkillPath?: string;
  packageSnapshotId?: string;
  packageFileMap?: SkillPackageFileMapping[] | null;
  fileInventory?: SpaceSkillVersionFileInventoryEntry[];
  release?: { id: string; name: string; releasedAt: Date };
  updateCurrentVersion?: boolean;
  skipInventoryRefresh?: boolean;
  skill?: SpaceSkill;
  database?: DbOrTransaction;
};

type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
type DbOrTransaction = Db | DbTransaction;

type PlannedSkillReassignment = {
  agentId: string;
  reassignment: SpaceSkillForkReassignment;
};

type RuntimeSkillSourceResolution =
  | { status: "available"; source: string }
  | { status: "missing"; source: string; detail: string };

const skillInventoryRefreshPromises = new Map<string, Promise<void>>();

function selectSpaceSkillColumns() {
  return {
    id: spaceSkills.id,
    spaceId: spaceSkills.spaceId,
    folderId: spaceSkills.folderId,
    key: spaceSkills.key,
    slug: spaceSkills.slug,
    name: spaceSkills.name,
    description: spaceSkills.description,
    markdown: spaceSkills.markdown,
    sourceType: spaceSkills.sourceType,
    sourceLocator: spaceSkills.sourceLocator,
    sourceRef: spaceSkills.sourceRef,
    trustLevel: spaceSkills.trustLevel,
    compatibility: spaceSkills.compatibility,
    fileInventory: spaceSkills.fileInventory,
    iconUrl: spaceSkills.iconUrl,
    color: spaceSkills.color,
    tagline: spaceSkills.tagline,
    authorName: spaceSkills.authorName,
    homepageUrl: spaceSkills.homepageUrl,
    categories: spaceSkills.categories,
    accessSourceId: spaceSkills.accessSourceId,
    sharingScope: spaceSkills.sharingScope,
    publicShareToken: spaceSkills.publicShareToken,
    forkedFromSkillId: spaceSkills.forkedFromSkillId,
    forkedFromSpaceId: spaceSkills.forkedFromSpaceId,
    starCount: spaceSkills.starCount,
    installCount: spaceSkills.installCount,
    forkCount: spaceSkills.forkCount,
    currentVersionId: spaceSkills.currentVersionId,
    metadata: spaceSkills.metadata,
    createdAt: spaceSkills.createdAt,
    updatedAt: spaceSkills.updatedAt,
  };
}

const PROJECT_SCAN_DIRECTORY_ROOTS = [
  "skills",
  "skills/.curated",
  "skills/.experimental",
  "skills/.system",
  ".agents/skills",
  ".agent/skills",
  ".augment/skills",
  ".claude/skills",
  ".codex/skills",
  ".codebuddy/skills",
  ".commandcode/skills",
  ".continue/skills",
  ".cursor/skills",
  ".cortex/skills",
  ".crush/skills",
  ".factory/skills",
  ".goose/skills",
  ".gemini/skills",
  ".junie/skills",
  ".iflow/skills",
  ".kilocode/skills",
  ".kiro/skills",
  ".kode/skills",
  ".mcpjam/skills",
  ".vibe/skills",
  ".mux/skills",
  ".openhands/skills",
  ".opencode/skills",
  ".pi/skills",
  ".qoder/skills",
  ".qwen/skills",
  ".roo/skills",
  ".trae/skills",
  ".windsurf/skills",
  ".zencoder/skills",
  ".neovate/skills",
  ".pochi/skills",
  ".adal/skills",
] as const;

const PROJECT_ROOT_SKILL_SUBDIRECTORIES = [
  "references",
  "scripts",
  "assets",
] as const;

const SKILL_AUDIT_SCAN_VERSION = "skills-audit-v1";
const MAX_CATALOG_FILE_BYTES = 1024 * 1024;

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePackageFileMap(files: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const [rawPath, content] of Object.entries(files)) {
    const nextPath = normalizePortablePath(rawPath);
    if (!nextPath) continue;
    out[nextPath] = content;
  }
  return out;
}

function normalizeSkillSlug(value: string | null | undefined) {
  return value ? normalizeAgentUrlKey(value) ?? null : null;
}

function normalizeSkillKey(value: string | null | undefined) {
  if (!value) return null;
  const segments = value
    .split("/")
    .map((segment) => normalizeSkillSlug(segment))
    .filter((segment): segment is string => Boolean(segment));
  return segments.length > 0 ? segments.join("/") : null;
}

export function normalizeGitHubSkillDirectory(
  value: string | null | undefined,
  fallback: string,
) {
  const normalized = normalizePortablePath(value ?? "");
  if (!normalized) return normalizePortablePath(fallback);
  if (path.posix.basename(normalized).toLowerCase() === "skill.md") {
    return normalizePortablePath(path.posix.dirname(normalized));
  }
  return normalized;
}

function hashSkillValue(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}

function sha256Buffer(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

function buildInventoryContentHash(entries: Array<{ path: string; sha256: string }>) {
  const hashInput = entries
    .map((entry) => ({ path: normalizePortablePath(entry.path), sha256: entry.sha256 }))
    .sort((left, right) => {
      if (left.path === "SKILL.md") return -1;
      if (right.path === "SKILL.md") return 1;
      return left.path.localeCompare(right.path);
    });
  return `sha256:${sha256Buffer(Buffer.from(JSON.stringify(hashInput)))}`;
}

function uniqueSkillSlug(baseSlug: string, usedSlugs: Set<string>) {
  if (!usedSlugs.has(baseSlug)) return baseSlug;
  let attempt = 2;
  let candidate = `${baseSlug}-${attempt}`;
  while (usedSlugs.has(candidate)) {
    attempt += 1;
    candidate = `${baseSlug}-${attempt}`;
  }
  return candidate;
}

function uniqueImportedSkillKey(spaceId: string, baseSlug: string, usedKeys: Set<string>) {
  const initial = `space/${spaceId}/${baseSlug}`;
  if (!usedKeys.has(initial)) return initial;
  let attempt = 2;
  let candidate = `space/${spaceId}/${baseSlug}-${attempt}`;
  while (usedKeys.has(candidate)) {
    attempt += 1;
    candidate = `space/${spaceId}/${baseSlug}-${attempt}`;
  }
  return candidate;
}

export function buildSkillRuntimeName(key: string, slug: string) {
  if (key.startsWith("outpost/outpost/")) return slug;
  return `${slug}--${hashSkillValue(key)}`;
}

/**
 * Rewrite only the top-level `name:` frontmatter field of a SKILL.md document,
 * leaving the body and every other field byte-identical. Returns the input
 * unchanged when there is no frontmatter or no `name:` field to update.
 */
function rewriteFrontmatterName(markdown: string, newName: string): string {
  const block = splitFrontmatterBlock(markdown);
  if (!block.hasFrontmatter) return markdown;
  let replaced = false;
  const nextLines = block.frontmatterText.split("\n").map((line) => {
    if (!replaced && /^name\s*:/.test(line)) {
      replaced = true;
      return stringifyFrontmatter({ name: newName });
    }
    return line;
  });
  if (!replaced) return markdown;
  return joinFrontmatterBlock({ ...block, frontmatterText: nextLines.join("\n") });
}

function readCanonicalSkillKey(frontmatter: Record<string, unknown>, metadata: Record<string, unknown> | null) {
  const direct = normalizeSkillKey(
    asString(frontmatter.key)
    ?? asString(frontmatter.skillKey)
    ?? asString(metadata?.skillKey)
    ?? asString(metadata?.canonicalKey)
    ?? asString(metadata?.outpostSkillKey),
  );
  if (direct) return direct;
  const outpost = isPlainRecord(metadata?.outpost) ? metadata?.outpost as Record<string, unknown> : null;
  return normalizeSkillKey(
    asString(outpost?.skillKey)
    ?? asString(outpost?.key),
  );
}

/** Focused bundled skills used by Outpost agents. */
export const OUTPOST_CORE_SKILL_KEYS = [
  "outpost/outpost/outpost-task",
  "outpost/outpost/outpost-decision",
  "outpost/outpost/outpost-artifact",
  "outpost/outpost/outpost-case",
  "outpost/outpost/outpost-north-star",
  "outpost/outpost/outpost-delegation",
] as const;

function deriveCanonicalSkillKey(
  spaceId: string,
  input: Pick<ImportedSkill, "slug" | "sourceType" | "sourceLocator" | "metadata">,
) {
  const slug = normalizeSkillSlug(input.slug) ?? "skill";
  const metadata = isPlainRecord(input.metadata) ? input.metadata : null;
  const explicitKey = readCanonicalSkillKey({}, metadata);
  if (explicitKey) return explicitKey;

  const sourceKind = asString(metadata?.sourceKind);
  if (sourceKind === "outpost_bundled") {
    return `outpost/outpost/${slug}`;
  }

  const owner = normalizeSkillSlug(asString(metadata?.owner));
  const repo = normalizeSkillSlug(asString(metadata?.repo));
  if ((input.sourceType === "github" || input.sourceType === "skills_sh" || sourceKind === "github" || sourceKind === "skills_sh") && owner && repo) {
    return `${owner}/${repo}/${slug}`;
  }

  if (input.sourceType === "url" || sourceKind === "url") {
    const locator = asString(input.sourceLocator);
    if (locator) {
      try {
        const url = new URL(locator);
        const host = normalizeSkillSlug(url.host) ?? "url";
        return `url/${host}/${hashSkillValue(locator)}/${slug}`;
      } catch {
        return `url/unknown/${hashSkillValue(locator)}/${slug}`;
      }
    }
  }

  if (input.sourceType === "local_path") {
    if (sourceKind === "managed_local") {
      return `space/${spaceId}/${slug}`;
    }
    const locator = asString(input.sourceLocator);
    if (locator) {
      return `local/${hashSkillValue(path.resolve(locator))}/${slug}`;
    }
  }

  return `space/${spaceId}/${slug}`;
}

export function classifyInventoryKind(relativePath: string): SpaceSkillFileInventoryEntry["kind"] {
  let normalized = normalizePortablePath(relativePath).toLowerCase();
  // Projection adds a container, not a new meaning for the original file path.
  while (normalized.startsWith(`${REPOSITORY_CONTENT_DIR}/`)) {
    normalized = normalized.slice(REPOSITORY_CONTENT_DIR.length + 1);
  }
  if (normalized.endsWith("/skill.md") || normalized === "skill.md") return "skill";
  const fileName = path.posix.basename(normalized);
  // Font packages commonly keep their binary assets in a dedicated fonts folder.
  if (/\.(ttf|otf|woff2?|eot)$/i.test(fileName)) return "asset";
  if (
    fileName.endsWith(".sh")
    || fileName.endsWith(".js")
    || fileName.endsWith(".mjs")
    || fileName.endsWith(".cjs")
    || fileName.endsWith(".ts")
    || fileName.endsWith(".py")
    || fileName.endsWith(".rb")
    || fileName.endsWith(".bash")
  ) {
    return "script";
  }
  if (normalized.startsWith("scripts/")) return "script";
  if (normalized.startsWith("references/")) return "reference";
  if (normalized.startsWith("assets/")) return "asset";
  if (normalized.endsWith(".md")) return "markdown";
  if (
    fileName.endsWith(".png")
    || fileName.endsWith(".jpg")
    || fileName.endsWith(".jpeg")
    || fileName.endsWith(".gif")
    || fileName.endsWith(".svg")
    || fileName.endsWith(".webp")
    || fileName.endsWith(".pdf")
  ) {
    return "asset";
  }
  return "other";
}

function deriveTrustLevel(fileInventory: SpaceSkillFileInventoryEntry[]): SpaceSkillTrustLevel {
  if (fileInventory.some((entry) => entry.kind === "script")) return "scripts_executables";
  if (fileInventory.some((entry) => entry.kind === "asset" || entry.kind === "other")) return "assets";
  return "markdown_only";
}

async function fetchText(url: string) {
  const response = await ghFetch(url);
  if (!response.ok) {
    throw unprocessable(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.text();
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await ghFetch(url, {
    headers: {
      accept: "application/vnd.github+json",
    },
  });
  if (!response.ok) {
    throw unprocessable(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.json() as Promise<T>;
}


async function resolveGitHubDefaultBranch(owner: string, repo: string, apiBase: string) {
  const response = await fetchJson<{ default_branch?: string }>(
    `${apiBase}/repos/${owner}/${repo}`,
  );
  return asString(response.default_branch) ?? "main";
}

async function resolveGitHubCommitSha(owner: string, repo: string, ref: string, apiBase: string) {
  const response = await fetchJson<{ sha?: string }>(
    `${apiBase}/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`,
  );
  const sha = asString(response.sha);
  if (!sha) {
    throw unprocessable(`Failed to resolve GitHub ref ${ref}`);
  }
  return sha;
}

function parseGitHubSourceUrl(rawUrl: string) {
  const url = parseRemoteSkillImportUrl(rawUrl);
  if (url.protocol !== "https:") {
    throw unprocessable("GitHub source URL must use HTTPS");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw unprocessable("Remote skill source URLs cannot include credentials, query parameters, or fragments.");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw unprocessable("Invalid GitHub URL");
  }
  const owner = parts[0]!;
  const repo = parts[1]!.replace(/\.git$/i, "");
  let ref = "main";
  let basePath = "";
  let filePath: string | null = null;
  let explicitRef = false;
  if (parts[2] === "tree") {
    ref = parts[3] ?? "main";
    basePath = parts.slice(4).join("/");
    explicitRef = true;
  } else if (parts[2] === "blob") {
    ref = parts[3] ?? "main";
    filePath = parts.slice(4).join("/");
    basePath = filePath ? path.posix.dirname(filePath) : "";
    explicitRef = true;
  }
  return { hostname: url.hostname, owner, repo, ref, basePath, filePath, explicitRef };
}

function parseRemoteSkillImportUrl(rawUrl: string) {
  try {
    return new URL(rawUrl);
  } catch {
    throw unprocessable("Invalid remote skill source URL.");
  }
}

function normalizeRemoteSkillImportSource(rawUrl: string) {
  const url = parseRemoteSkillImportUrl(rawUrl);
  if (url.username || url.password || url.search || url.hash) {
    throw unprocessable("Remote skill source URLs cannot include credentials, query parameters, or fragments.");
  }
  if (isGitRepoSkillImportSource(rawUrl)) {
    const hostname = url.hostname.toLowerCase() === "www.github.com" ? "github.com" : url.hostname.toLowerCase();
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length >= 2) {
      const owner = segments[0]!.toLowerCase();
      const repo = segments[1]!.replace(/\.git$/i, "").toLowerCase();
      const suffix = segments.slice(2).join("/");
      return `https://${hostname}/${owner}/${repo}${suffix ? `/${suffix}` : ""}`;
    }
  }
  return url.toString();
}

async function resolveGitHubPinnedRef(parsed: ReturnType<typeof parseGitHubSourceUrl>) {
  const apiBase = gitHubApiBase(parsed.hostname);
  if (/^[0-9a-f]{40}$/i.test(parsed.ref.trim())) {
    return {
      pinnedRef: parsed.ref,
      trackingRef: parsed.explicitRef ? parsed.ref : null,
    };
  }

  const trackingRef = parsed.explicitRef
    ? parsed.ref
    : await resolveGitHubDefaultBranch(parsed.owner, parsed.repo, apiBase);
  const pinnedRef = await resolveGitHubCommitSha(parsed.owner, parsed.repo, trackingRef, apiBase);
  return { pinnedRef, trackingRef };
}


function extractCommandTokens(raw: string) {
  const matches = raw.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return matches.map((token) => token.replace(/^['"]|['"]$/g, ""));
}

export function parseSkillImportSourceInput(rawInput: string): ParsedSkillImportSource {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    throw unprocessable("Skill source is required.");
  }

  const warnings: string[] = [];
  let source = trimmed;
  let requestedSkillSlug: string | null = null;

  if (/^npx\s+skills\s+add\s+/i.test(trimmed)) {
    const tokens = extractCommandTokens(trimmed);
    const addIndex = tokens.findIndex(
      (token, index) =>
        token === "add"
        && index > 0
        && tokens[index - 1]?.toLowerCase() === "skills",
    );
    if (addIndex >= 0) {
      source = tokens[addIndex + 1] ?? "";
      for (let index = addIndex + 2; index < tokens.length; index += 1) {
        const token = tokens[index]!;
        if (token === "--skill") {
          requestedSkillSlug = normalizeSkillSlug(tokens[index + 1] ?? null);
          index += 1;
          continue;
        }
        if (token.startsWith("--skill=")) {
          requestedSkillSlug = normalizeSkillSlug(token.slice("--skill=".length));
        }
      }
    }
  }

  const normalizedSource = source.trim();
  if (!normalizedSource) {
    throw unprocessable("Skill source is required.");
  }
  const normalizedRemoteSource = /^https?:\/\//i.test(normalizedSource)
    ? normalizeRemoteSkillImportSource(normalizedSource)
    : null;
  const canonicalSource = normalizedRemoteSource ?? normalizedSource;

  // Key-style imports (org/repo/skill) originate from the skills.sh registry
  if (!/^https?:\/\//i.test(canonicalSource) && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(canonicalSource)) {
    const [owner, repo, skillSlugRaw] = canonicalSource.split("/");
    return {
      resolvedSource: `https://github.com/${owner}/${repo}`,
      requestedSkillSlug: normalizeSkillSlug(skillSlugRaw),
      originalSkillsShUrl: `https://skills.sh/${owner}/${repo}/${skillSlugRaw}`,
      warnings,
    };
  }

  if (!/^https?:\/\//i.test(canonicalSource) && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(canonicalSource)) {
    return {
      resolvedSource: `https://github.com/${canonicalSource}`,
      requestedSkillSlug,
      originalSkillsShUrl: null,
      warnings,
    };
  }

  // Detect skills.sh URLs and resolve to GitHub: https://skills.sh/org/repo/skill → org/repo/skill key
  const skillsShMatch = canonicalSource.match(/^https?:\/\/(?:www\.)?skills\.sh\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\/([A-Za-z0-9_.-]+))?$/i);
  if (skillsShMatch) {
    const [, owner, repo, skillSlugRaw] = skillsShMatch;
    return {
      resolvedSource: `https://github.com/${owner}/${repo}`,
      requestedSkillSlug: skillSlugRaw ? normalizeSkillSlug(skillSlugRaw) : requestedSkillSlug,
      originalSkillsShUrl: canonicalSource,
      warnings,
    };
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(canonicalSource) && !/^https:\/\//i.test(canonicalSource)) {
    throw unprocessable("Remote skill sources must use HTTPS", {
      code: "skill_source_validation_failed",
    });
  }

  return {
    resolvedSource: canonicalSource,
    requestedSkillSlug,
    originalSkillsShUrl: null,
    warnings,
  };
}

export function isGitRepoSkillImportSource(source: string) {
  try {
    const parsed = new URL(source.trim());
    if (parsed.protocol !== "https:") return false;
    const hostname = parsed.hostname.toLowerCase();
    if (hostname.endsWith(".githubusercontent.com") || hostname === "gist.github.com") return false;
    const segments = parsed.pathname.split("/").filter(Boolean);
    return segments.length >= 2 && !parsed.pathname.endsWith(".md");
  } catch {
    return false;
  }
}

function resolveBundledSkillsRoot() {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return [
    path.resolve(moduleDir, "../../skills"),
    path.resolve(process.cwd(), "skills"),
    path.resolve(moduleDir, "../../../skills"),
  ];
}

function resolveBundledSkillReleasesRoot() {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return [
    path.resolve(moduleDir, "../../skills-releases/outpost"),
    path.resolve(process.cwd(), "skills-releases/outpost"),
    path.resolve(moduleDir, "../../../skills-releases/outpost"),
  ];
}

function matchesRequestedSkill(relativeSkillPath: string, requestedSkillSlug: string | null) {
  if (!requestedSkillSlug) return true;
  const skillDir = path.posix.dirname(relativeSkillPath);
  return normalizeSkillSlug(path.posix.basename(skillDir)) === requestedSkillSlug;
}

function deriveImportedSkillSlug(frontmatter: Record<string, unknown>, fallback: string) {
  return normalizeSkillSlug(asString(frontmatter.slug))
    ?? normalizeSkillSlug(asString(frontmatter.name))
    ?? normalizeAgentUrlKey(fallback)
    ?? "skill";
}

function deriveImportedSkillSource(
  frontmatter: Record<string, unknown>,
  fallbackSlug: string,
): Pick<ImportedSkill, "sourceType" | "sourceLocator" | "sourceRef" | "metadata"> {
  const metadata = isPlainRecord(frontmatter.metadata) ? frontmatter.metadata : null;
  const canonicalKey = readCanonicalSkillKey(frontmatter, metadata);
  const rawSources = metadata && Array.isArray(metadata.sources) ? metadata.sources : [];
  const sourceEntry = rawSources.find((entry) => isPlainRecord(entry)) as Record<string, unknown> | undefined;
  const kind = asString(sourceEntry?.kind);

  if (kind === "github-dir" || kind === "github-file") {
    const repo = asString(sourceEntry?.repo);
    const repoPath = asString(sourceEntry?.path);
    const commit = asString(sourceEntry?.commit);
    const trackingRef = asString(sourceEntry?.trackingRef);
    const sourceHostname = asString(sourceEntry?.hostname) || "github.com";
    const url = asString(sourceEntry?.url)
      ?? (repo
        ? `https://${sourceHostname}/${repo}${repoPath ? `/tree/${trackingRef ?? commit ?? "main"}/${repoPath}` : ""}`
        : null);
    const [owner, repoName] = (repo ?? "").split("/");
    if (repo && owner && repoName) {
      const sourceKind = owner === "outpost"
        && repoName === "outpost"
        && canonicalKey?.startsWith("outpost/outpost/")
        ? "outpost_bundled"
        : "github";
      return {
        sourceType: "github",
        sourceLocator: url,
        sourceRef: commit,
        metadata: {
          ...(canonicalKey ? { skillKey: canonicalKey } : {}),
          sourceKind,
          ...(sourceHostname !== "github.com" ? { hostname: sourceHostname } : {}),
          owner,
          repo: repoName,
          ref: commit,
          trackingRef,
          repoSkillDir: repoPath ?? `skills/${fallbackSlug}`,
        },
      };
    }
  }

  if (kind === "url") {
    const url = asString(sourceEntry?.url) ?? asString(sourceEntry?.rawUrl);
    if (url) {
      return {
        sourceType: "url",
        sourceLocator: url,
        sourceRef: null,
        metadata: {
          ...(canonicalKey ? { skillKey: canonicalKey } : {}),
          sourceKind: "url",
        },
      };
    }
  }

  return {
    sourceType: "managed",
    sourceLocator: null,
    sourceRef: null,
    metadata: {
      ...(canonicalKey ? { skillKey: canonicalKey } : {}),
      sourceKind: "managed",
    },
  };
}

function readInlineSkillImports(spaceId: string, files: Record<string, string>): ImportedSkill[] {
  const normalizedFiles = normalizePackageFileMap(files);
  const skillPaths = Object.keys(normalizedFiles).filter(
    (entry) => path.posix.basename(entry).toLowerCase() === "skill.md",
  );
  const imports: ImportedSkill[] = [];

  for (const skillPath of skillPaths) {
    const dir = path.posix.dirname(skillPath);
    const skillDir = dir === "." ? "" : dir;
    const slugFallback = path.posix.basename(skillDir || path.posix.dirname(skillPath));
    const markdown = normalizedFiles[skillPath]!;
    const parsed = parseFrontmatterMarkdown(markdown);
    const slug = deriveImportedSkillSlug(parsed.frontmatter, slugFallback);
    const source = deriveImportedSkillSource(parsed.frontmatter, slug);
    const inventory = Object.keys(normalizedFiles)
      .filter((entry) => entry === skillPath || (skillDir ? entry.startsWith(`${skillDir}/`) : true))
      .map((entry) => {
        const relative = entry === skillPath ? "SKILL.md" : skillDir ? entry.slice(skillDir.length + 1) : entry;
        return {
          path: normalizePortablePath(relative),
          kind: classifyInventoryKind(relative),
        };
      })
      .sort((left, right) => left.path.localeCompare(right.path));

    imports.push({
      key: "",
      slug,
      name: asString(parsed.frontmatter.name) ?? slug,
      description: asString(parsed.frontmatter.description),
      markdown,
      packageDir: skillDir,
      sourceType: source.sourceType,
      sourceLocator: source.sourceLocator,
      sourceRef: source.sourceRef,
      trustLevel: deriveTrustLevel(inventory),
      compatibility: "compatible",
      fileInventory: inventory,
      metadata: source.metadata,
    });
    imports[imports.length - 1]!.key = deriveCanonicalSkillKey(spaceId, imports[imports.length - 1]!);
  }

  return imports;
}

async function walkLocalFiles(root: string, current: string, out: string[]) {
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const absolutePath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await walkLocalFiles(root, absolutePath, out);
      continue;
    }
    if (!entry.isFile()) continue;
    out.push(normalizePortablePath(path.relative(root, absolutePath)));
  }
}

async function statPath(targetPath: string) {
  return fs.stat(targetPath).catch(() => null);
}

async function hasExactSkillFile(directoryPath: string) {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true }).catch(() => []);
  const skillEntry = entries.find((entry) => entry.name === "SKILL.md");
  return Boolean(skillEntry && (skillEntry.isFile() || skillEntry.isSymbolicLink()));
}

function pathIsContained(rootPath: string, candidatePath: string) {
  const relativePath = path.relative(rootPath, candidatePath);
  return relativePath === ""
    || (!path.isAbsolute(relativePath) && relativePath !== ".." && !relativePath.startsWith(`..${path.sep}`));
}

async function assertNoSymlinksInLocalTree(currentPath: string): Promise<void> {
  const entries = await fs.readdir(currentPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const absolutePath = path.join(currentPath, entry.name);
    if (entry.isSymbolicLink()) {
      throw unprocessable(`Project skill candidate contains a symbolic link at ${absolutePath}.`);
    }
    if (entry.isDirectory()) {
      await assertNoSymlinksInLocalTree(absolutePath);
    }
  }
}

async function validateProjectSkillImportPath(
  skillDir: string,
  workspaceRoot: string,
  inventoryMode: LocalSkillInventoryMode,
) {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const resolvedSkillDir = path.resolve(skillDir);
  const canonicalWorkspaceRoot = await fs.realpath(resolvedWorkspaceRoot);
  const canonicalSkillDir = await fs.realpath(resolvedSkillDir);
  if (!pathIsContained(canonicalWorkspaceRoot, canonicalSkillDir)) {
    throw unprocessable(`Project skill candidate ${resolvedSkillDir} resolves outside workspace root ${resolvedWorkspaceRoot}.`);
  }

  // macOS exposes the same temporary directory through both `/var` and
  // `/private/var`. Discovery returns a canonical path, while a persisted
  // workspace may retain the user-facing alias. Traverse the lexical path when
  // possible so symlinks remain detectable; otherwise compare and traverse the
  // already-verified canonical pair.
  const lexicalPathIsContained = pathIsContained(resolvedWorkspaceRoot, resolvedSkillDir);
  const traversalWorkspaceRoot = lexicalPathIsContained
    ? resolvedWorkspaceRoot
    : canonicalWorkspaceRoot;
  const traversalSkillDir = lexicalPathIsContained
    ? resolvedSkillDir
    : canonicalSkillDir;
  let currentPath = traversalWorkspaceRoot;
  const relativeSkillDir = path.relative(traversalWorkspaceRoot, traversalSkillDir);
  for (const segment of relativeSkillDir.split(path.sep).filter(Boolean)) {
    currentPath = path.join(currentPath, segment);
    const segmentStat = await fs.lstat(currentPath);
    if (segmentStat.isSymbolicLink()) {
      throw unprocessable(`Project skill candidate contains a symbolic link at ${currentPath}.`);
    }
  }

  const skillFilePath = path.join(traversalSkillDir, "SKILL.md");
  const skillFileStat = await fs.lstat(skillFilePath);
  if (skillFileStat.isSymbolicLink()) {
    throw unprocessable(`Project skill candidate contains a symbolic link at ${skillFilePath}.`);
  }
  if (!skillFileStat.isFile()) {
    throw unprocessable(`No SKILL.md file was found in ${resolvedSkillDir}.`);
  }
  const canonicalSkillFilePath = await fs.realpath(skillFilePath);
  if (!pathIsContained(canonicalWorkspaceRoot, canonicalSkillFilePath)) {
    throw unprocessable(`Project skill file ${skillFilePath} resolves outside workspace root ${resolvedWorkspaceRoot}.`);
  }

  if (inventoryMode === "full") {
    await assertNoSymlinksInLocalTree(resolvedSkillDir);
    return;
  }
  for (const relativeDir of PROJECT_ROOT_SKILL_SUBDIRECTORIES) {
    const absoluteDir = path.join(resolvedSkillDir, relativeDir);
    const dirStat = await fs.lstat(absoluteDir).catch(() => null);
    if (!dirStat) continue;
    if (dirStat.isSymbolicLink()) {
      throw unprocessable(`Project skill candidate contains a symbolic link at ${absoluteDir}.`);
    }
    if (dirStat.isDirectory()) {
      await assertNoSymlinksInLocalTree(absoluteDir);
    }
  }
}

function projectSkillImportFailureReason(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("symbolic link")) {
    return "Skipped because symbolic links can point outside the project workspace. Replace the link with a real file or directory to import this skill.";
  }
  if (message.includes("outside workspace root")) return "Project skill candidate resolves outside the workspace.";
  if (message.includes("No SKILL.md file")) return "Project skill candidate does not contain a readable SKILL.md file.";
  return "Project skill candidate could not be read.";
}

async function collectLocalSkillInventory(
  skillDir: string,
  mode: LocalSkillInventoryMode = "full",
): Promise<SpaceSkillFileInventoryEntry[]> {
  const skillFilePath = path.join(skillDir, "SKILL.md");
  const skillFileStat = await statPath(skillFilePath);
  if (!skillFileStat?.isFile()) {
    throw unprocessable(`No SKILL.md file was found in ${skillDir}.`);
  }

  const allFiles = new Set<string>(["SKILL.md"]);
  if (mode === "full") {
    const discoveredFiles: string[] = [];
    await walkLocalFiles(skillDir, skillDir, discoveredFiles);
    for (const relativePath of discoveredFiles) {
      allFiles.add(relativePath);
    }
  } else {
    for (const relativeDir of PROJECT_ROOT_SKILL_SUBDIRECTORIES) {
      const absoluteDir = path.join(skillDir, relativeDir);
      const dirStat = await statPath(absoluteDir);
      if (!dirStat?.isDirectory()) continue;
      const discoveredFiles: string[] = [];
      await walkLocalFiles(skillDir, absoluteDir, discoveredFiles);
      for (const relativePath of discoveredFiles) {
        allFiles.add(relativePath);
      }
    }
  }

  return Array.from(allFiles)
    .map((relativePath) => ({
      path: normalizePortablePath(relativePath),
      kind: classifyInventoryKind(relativePath),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function inventoryEntriesEqual(
  left: SpaceSkillFileInventoryEntry[],
  right: SpaceSkillFileInventoryEntry[],
) {
  if (left.length !== right.length) return false;
  const normalize = (entries: SpaceSkillFileInventoryEntry[]) =>
    entries
      .map((entry) => ({
        path: normalizePortablePath(entry.path),
        kind: entry.kind,
      }))
      .sort((leftEntry, rightEntry) => leftEntry.path.localeCompare(rightEntry.path));
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  return normalizedLeft.every((entry, index) => {
    const other = normalizedRight[index];
    return other?.path === entry.path && other.kind === entry.kind;
  });
}

function stableJsonComparable(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    return value.map((entry) => stableJsonComparable(entry) ?? null);
  }
  if (isPlainRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const normalized = stableJsonComparable(value[key]);
      if (normalized !== undefined) out[key] = normalized ?? null;
    }
    return out;
  }
  return value;
}

function stableJsonEqual(left: unknown, right: unknown) {
  return JSON.stringify(stableJsonComparable(left)) === JSON.stringify(stableJsonComparable(right));
}

function isOutpostBundledSkillKey(key: string) {
  return key.startsWith("outpost/outpost/");
}

function outpostBundledFolderCategory(key: string, metadata?: unknown) {
  const keyParts = key.split("/");
  if (keyParts[0] === "outpost" && keyParts[1] === "bundled" && keyParts[2]) {
    return keyParts[2];
  }
  if (isOutpostBundledSkillKey(key)) return "outpost-core";
  if (isPlainRecord(metadata) && asString(metadata.sourceKind) === "outpost_bundled") {
    return "outpost-core";
  }
  return null;
}

function bundledFolderLabel(category: string) {
  return category
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function stripDerivedOutpostBundledMetadata(key: string, metadata: unknown): unknown {
  if (metadata === null || metadata === undefined) return {};
  const comparable = stableJsonComparable(metadata);
  if (!isPlainRecord(comparable)) return comparable;

  const out = { ...comparable };
  if (out.skillKey === key) delete out.skillKey;
  if (out.sourceKind === "outpost_bundled") delete out.sourceKind;
  delete out.missingSource;
  return out;
}

function importedSkillMetadataEqual(existing: SpaceSkill, values: ImportedSkillPersistValues) {
  const incomingMetadata = isPlainRecord(values.metadata) ? values.metadata : null;
  if (isOutpostBundledSkillKey(values.key) && asString(incomingMetadata?.sourceKind) === "outpost_bundled") {
    return JSON.stringify(stripDerivedOutpostBundledMetadata(existing.key, existing.metadata))
      === JSON.stringify(stripDerivedOutpostBundledMetadata(values.key, values.metadata));
  }
  return stableJsonEqual(existing.metadata ?? null, values.metadata);
}

function stringArraysEqual(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  return left.every((entry, index) => entry === right[index]);
}

function importedSkillPersistValuesMatchExisting(
  existing: SpaceSkill,
  values: ImportedSkillPersistValues,
) {
  return existing.spaceId === values.spaceId
    && existing.folderId === values.folderId
    && existing.key === values.key
    && existing.slug === values.slug
    && existing.name === values.name
    && existing.description === values.description
    && existing.markdown === values.markdown
    && existing.sourceType === values.sourceType
    && existing.sourceLocator === values.sourceLocator
    && existing.sourceRef === values.sourceRef
    && existing.trustLevel === values.trustLevel
    && existing.compatibility === values.compatibility
    && inventoryEntriesEqual(
      existing.fileInventory,
      normalizeFileInventory({ fileInventory: values.fileInventory }),
    )
    && existing.iconUrl === values.iconUrl
    && existing.color === values.color
    && existing.tagline === values.tagline
    && existing.authorName === values.authorName
    && existing.homepageUrl === values.homepageUrl
    && stringArraysEqual(existing.categories, normalizeCategoryList(values.categories))
    && existing.sharingScope === values.sharingScope
    && existing.installCount === values.installCount
    && importedSkillMetadataEqual(existing, values);
}

function inferLocalSkillInventoryMode(
  skill: Pick<SpaceSkillRow, "sourceLocator" | "metadata">,
): LocalSkillInventoryMode {
  const metadata = isPlainRecord(skill.metadata) ? skill.metadata : null;
  const sourceKind = asString(metadata?.sourceKind);
  const workspaceCwd = asString(metadata?.workspaceCwd);
  if (sourceKind === "project_scan" && workspaceCwd && skill.sourceLocator === workspaceCwd) {
    return "project_root";
  }
  return "full";
}

export async function readLocalSkillImportFromDirectory(
  spaceId: string,
  skillDir: string,
  options?: {
    inventoryMode?: LocalSkillInventoryMode;
    metadata?: Record<string, unknown> | null;
    workspaceRoot?: string;
  },
): Promise<ImportedSkill> {
  const resolvedSkillDir = path.resolve(skillDir);
  const inventoryMode = options?.inventoryMode ?? "full";
  if (options?.workspaceRoot) {
    await validateProjectSkillImportPath(resolvedSkillDir, options.workspaceRoot, inventoryMode);
  }
  const skillFilePath = path.join(resolvedSkillDir, "SKILL.md");
  const markdown = await fs.readFile(skillFilePath, "utf8");
  const parsed = parseFrontmatterMarkdown(markdown);
  const slug = deriveImportedSkillSlug(parsed.frontmatter, path.basename(resolvedSkillDir));
  const parsedMetadata = isPlainRecord(parsed.frontmatter.metadata) ? parsed.frontmatter.metadata : null;
  const skillKey = readCanonicalSkillKey(parsed.frontmatter, parsedMetadata);
  const metadata = {
    ...(skillKey ? { skillKey } : {}),
    ...(parsedMetadata ?? {}),
    sourceKind: "local_path",
    ...(options?.metadata ?? {}),
  };
  const inventory = await collectLocalSkillInventory(resolvedSkillDir, inventoryMode);

  return {
    key: deriveCanonicalSkillKey(spaceId, {
      slug,
      sourceType: "local_path",
      sourceLocator: resolvedSkillDir,
      metadata,
    }),
    slug,
    name: asString(parsed.frontmatter.name) ?? slug,
    description: asString(parsed.frontmatter.description),
    markdown,
    packageDir: resolvedSkillDir,
    sourceType: "local_path",
    sourceLocator: resolvedSkillDir,
    sourceRef: null,
    trustLevel: deriveTrustLevel(inventory),
    compatibility: "compatible",
    fileInventory: inventory,
    metadata,
  };
}

export async function discoverProjectWorkspaceSkillDirectories(
  target: ProjectSkillScanTarget,
  explicitPaths: string[] = [],
): Promise<Array<{
  skillDir: string;
  directoryRoot: string;
  relativePath: string;
  inventoryMode: LocalSkillInventoryMode;
}>> {
  const discovered = new Map<string, {
    directoryRoot: string;
    relativePath: string;
    inventoryMode: LocalSkillInventoryMode;
  }>();
  const workspaceRoot = await fs.realpath(path.resolve(target.workspaceCwd)).catch(() => null);
  if (!workspaceRoot) return [];
  const rootSkillPath = path.join(workspaceRoot, "SKILL.md");
  if ((await statPath(rootSkillPath))?.isFile()) {
    discovered.set(workspaceRoot, {
      directoryRoot: ".",
      relativePath: ".",
      inventoryMode: "project_root",
    });
  }

  for (const explicitPath of explicitPaths) {
    const relativeSkillDir = explicitPath.toLowerCase().endsWith("/skill.md")
      ? path.posix.dirname(explicitPath)
      : explicitPath.toLowerCase() === "skill.md"
        ? "."
        : explicitPath;
    const absoluteSkillDir = await fs.realpath(path.resolve(workspaceRoot, relativeSkillDir)).catch(() => null);
    if (!absoluteSkillDir) continue;
    const relativeToWorkspace = path.relative(workspaceRoot, absoluteSkillDir);
    if (
      relativeToWorkspace === ".."
      || relativeToWorkspace.startsWith(`..${path.sep}`)
      || path.isAbsolute(relativeToWorkspace)
    ) continue;
    if (!(await statPath(path.join(absoluteSkillDir, "SKILL.md")))?.isFile()) continue;
    discovered.set(absoluteSkillDir, {
      directoryRoot: relativeSkillDir === "." ? "." : path.posix.dirname(relativeSkillDir),
      relativePath: relativeSkillDir,
      inventoryMode: relativeSkillDir === "." ? "project_root" : "full",
    });
  }

  for (const relativeRoot of PROJECT_SCAN_DIRECTORY_ROOTS) {
    const absoluteRoot = path.join(workspaceRoot, relativeRoot);
    const rootStat = await statPath(absoluteRoot);
    if (!rootStat?.isDirectory()) continue;

    const entries = await fs.readdir(absoluteRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const absoluteSkillDir = path.resolve(absoluteRoot, entry.name);
      const entryStat = entry.isSymbolicLink() ? await statPath(absoluteSkillDir) : null;
      if (!entry.isDirectory() && !entryStat?.isDirectory()) continue;
      if (!(await statPath(path.join(absoluteSkillDir, "SKILL.md")))?.isFile()) continue;
      discovered.set(absoluteSkillDir, {
        directoryRoot: relativeRoot,
        relativePath: normalizePortablePath(path.relative(workspaceRoot, absoluteSkillDir)),
        inventoryMode: "full",
      });
    }
  }

  return Array.from(discovered.entries())
    .map(([skillDir, details]) => ({ skillDir, ...details }))
    .sort((left, right) => left.skillDir.localeCompare(right.skillDir));
}

function normalizeProjectScanSelectionPath(value: string): string | null {
  const trimmed = value.trim().replace(/\\/g, "/");
  if (trimmed === ".") return ".";
  if (!trimmed || trimmed.startsWith("/") || /^[A-Za-z]:\//.test(trimmed)) return null;
  const segments = trimmed.split("/").filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === "." || segment === "..")) return null;
  return segments.join("/");
}

function projectScanSelectionKey(workspaceId: string, relativePath: string) {
  return `${workspaceId}\u0000${relativePath}`;
}

async function readLocalSkillImports(spaceId: string, sourcePath: string): Promise<ImportedSkill[]> {
  const resolvedPath = path.resolve(sourcePath);
  const stat = await fs.stat(resolvedPath).catch(() => null);
  if (!stat) {
    throw unprocessable(`Skill source path does not exist: ${sourcePath}`);
  }

  if (stat.isFile()) {
    const markdown = await fs.readFile(resolvedPath, "utf8");
    const sourceDir = path.dirname(resolvedPath);
    const parsed = parseFrontmatterMarkdown(markdown);
    const slug = deriveImportedSkillSlug(parsed.frontmatter, path.basename(sourceDir));
    const parsedMetadata = isPlainRecord(parsed.frontmatter.metadata) ? parsed.frontmatter.metadata : null;
    const skillKey = readCanonicalSkillKey(parsed.frontmatter, parsedMetadata);
    const metadata = {
      ...(skillKey ? { skillKey } : {}),
      ...(parsedMetadata ?? {}),
      sourceKind: "local_path",
    };
    const inventory = await collectLocalSkillInventory(sourceDir, "project_root");
    return [{
      key: deriveCanonicalSkillKey(spaceId, {
        slug,
        sourceType: "local_path",
        sourceLocator: sourceDir,
        metadata,
      }),
      slug,
      name: asString(parsed.frontmatter.name) ?? slug,
      description: asString(parsed.frontmatter.description),
      markdown,
      packageDir: path.dirname(resolvedPath),
      sourceType: "local_path",
      sourceLocator: sourceDir,
      sourceRef: null,
      trustLevel: deriveTrustLevel(inventory),
      compatibility: "compatible",
      fileInventory: inventory,
      metadata,
    }];
  }

  const root = resolvedPath;
  const allFiles: string[] = [];
  await walkLocalFiles(root, root, allFiles);
  const skillPaths = allFiles.filter((entry) => path.posix.basename(entry).toLowerCase() === "skill.md");
  if (skillPaths.length === 0) {
    throw unprocessable("No SKILL.md files were found in the provided path.");
  }

  const imports: ImportedSkill[] = [];
  for (const skillPath of skillPaths) {
    const skillDir = path.posix.dirname(skillPath);
    const inventory = allFiles
      .filter((entry) => entry === skillPath || entry.startsWith(`${skillDir}/`))
      .map((entry) => {
        const relative = entry === skillPath ? "SKILL.md" : entry.slice(skillDir.length + 1);
        return {
          path: normalizePortablePath(relative),
          kind: classifyInventoryKind(relative),
        };
      })
      .sort((left, right) => left.path.localeCompare(right.path));
    const imported = await readLocalSkillImportFromDirectory(spaceId, path.join(root, skillDir));
    imported.fileInventory = inventory;
    imported.trustLevel = deriveTrustLevel(inventory);
    imports.push(imported);
  }

  return imports;
}

async function readUrlSkillImports(
  spaceId: string,
  sourceUrl: string,
  requestedSkillSlug: string | null = null,
): Promise<{ skills: ImportedSkill[]; warnings: string[] }> {
  const url = sourceUrl.trim();
  const warnings: string[] = [];
  const looksLikeRepoUrl = isGitRepoSkillImportSource(url);
  if (looksLikeRepoUrl) {
    const parsed = parseGitHubSourceUrl(url);
    const apiBase = gitHubApiBase(parsed.hostname);
    const { pinnedRef, trackingRef } = await resolveGitHubPinnedRef(parsed);
    let ref = pinnedRef;
    const tree = await fetchJson<{ tree?: Array<{ path: string; type: string }> }>(
      `${apiBase}/repos/${parsed.owner}/${parsed.repo}/git/trees/${ref}?recursive=1`,
    ).catch(() => {
      throw unprocessable(`Failed to read GitHub tree for ${url}`);
    });
    const allPaths = (tree.tree ?? [])
      .filter((entry) => entry.type === "blob")
      .map((entry) => entry.path)
      .filter((entry): entry is string => typeof entry === "string");
    const basePrefix = parsed.basePath ? `${parsed.basePath.replace(/^\/+|\/+$/g, "")}/` : "";
    const scopedPaths = basePrefix
      ? allPaths.filter((entry) => entry.startsWith(basePrefix))
      : allPaths;
    const relativePaths = scopedPaths.map((entry) => basePrefix ? entry.slice(basePrefix.length) : entry);
    const filteredPaths = parsed.filePath
      ? relativePaths.filter((entry) => entry === path.posix.relative(parsed.basePath || ".", parsed.filePath!))
      : relativePaths;
    const skillPaths = filteredPaths.filter(
      (entry) => path.posix.basename(entry).toLowerCase() === "skill.md",
    );
    if (skillPaths.length === 0) {
      throw unprocessable(
        "No SKILL.md files were found in the provided GitHub source.",
      );
    }
    const skills: ImportedSkill[] = [];
    for (const relativeSkillPath of skillPaths) {
      const repoSkillPath = basePrefix ? `${basePrefix}${relativeSkillPath}` : relativeSkillPath;
      const markdown = await fetchText(resolveRawGitHubUrl(parsed.hostname, parsed.owner, parsed.repo, ref, repoSkillPath));
      const parsedMarkdown = parseFrontmatterMarkdown(markdown);
      const skillDir = path.posix.dirname(relativeSkillPath);
      const slug = deriveImportedSkillSlug(parsedMarkdown.frontmatter, path.posix.basename(skillDir));
      const skillKey = readCanonicalSkillKey(
        parsedMarkdown.frontmatter,
        isPlainRecord(parsedMarkdown.frontmatter.metadata) ? parsedMarkdown.frontmatter.metadata : null,
      );
      if (requestedSkillSlug && !matchesRequestedSkill(relativeSkillPath, requestedSkillSlug) && slug !== requestedSkillSlug) {
        continue;
      }
      const metadata = {
        ...(skillKey ? { skillKey } : {}),
        sourceKind: "github",
        ...(parsed.hostname !== "github.com" ? { hostname: parsed.hostname } : {}),
        owner: parsed.owner,
        repo: parsed.repo,
        ref,
        trackingRef,
        repoSkillDir: normalizeGitHubSkillDirectory(
          basePrefix ? `${basePrefix}${skillDir}` : skillDir,
          slug,
        ),
      };
      const inventory = filteredPaths
        .filter((entry) => entry === relativeSkillPath || entry.startsWith(`${skillDir}/`))
        .map((entry) => ({
          path: entry === relativeSkillPath ? "SKILL.md" : entry.slice(skillDir.length + 1),
          kind: classifyInventoryKind(entry === relativeSkillPath ? "SKILL.md" : entry.slice(skillDir.length + 1)),
        }))
        .sort((left, right) => left.path.localeCompare(right.path));
      skills.push({
        key: deriveCanonicalSkillKey(spaceId, {
          slug,
          sourceType: "github",
          sourceLocator: sourceUrl,
          metadata,
        }),
        slug,
        name: asString(parsedMarkdown.frontmatter.name) ?? slug,
        description: asString(parsedMarkdown.frontmatter.description),
        markdown,
        sourceType: "github",
        sourceLocator: sourceUrl,
        sourceRef: ref,
        trustLevel: deriveTrustLevel(inventory),
        compatibility: "compatible",
        fileInventory: inventory,
        metadata,
      });
    }
    if (skills.length === 0) {
      throw unprocessable(
        requestedSkillSlug
          ? `Skill ${requestedSkillSlug} was not found in the provided GitHub source.`
          : "No SKILL.md files were found in the provided GitHub source.",
      );
    }
    return { skills, warnings };
  }

  if (url.startsWith("http://") || url.startsWith("https://")) {
    const markdown = await fetchText(url);
    const parsedMarkdown = parseFrontmatterMarkdown(markdown);
    const urlObj = new URL(url);
    const fileName = path.posix.basename(urlObj.pathname);
    const slug = deriveImportedSkillSlug(parsedMarkdown.frontmatter, fileName.replace(/\.md$/i, ""));
    const skillKey = readCanonicalSkillKey(
      parsedMarkdown.frontmatter,
      isPlainRecord(parsedMarkdown.frontmatter.metadata) ? parsedMarkdown.frontmatter.metadata : null,
    );
    const metadata = {
      ...(skillKey ? { skillKey } : {}),
      sourceKind: "url",
    };
    const inventory: SpaceSkillFileInventoryEntry[] = [{ path: "SKILL.md", kind: "skill" }];
    return {
      skills: [{
        key: deriveCanonicalSkillKey(spaceId, {
          slug,
          sourceType: "url",
          sourceLocator: url,
          metadata,
        }),
        slug,
        name: asString(parsedMarkdown.frontmatter.name) ?? slug,
        description: asString(parsedMarkdown.frontmatter.description),
        markdown,
        sourceType: "url",
        sourceLocator: url,
        sourceRef: null,
        trustLevel: deriveTrustLevel(inventory),
        compatibility: "compatible",
        fileInventory: inventory,
        metadata,
      }],
      warnings,
    };
  }

  throw unprocessable("Unsupported skill source. Use a local path or URL.");
}

function normalizeFileInventory(row: { fileInventory: unknown }): SpaceSkillFileInventoryEntry[] {
  return Array.isArray(row.fileInventory)
    ? row.fileInventory.flatMap((entry) => {
      if (!isPlainRecord(entry)) return [];
      return [{
        path: String(entry.path ?? ""),
        kind: (String(entry.kind ?? "other") as SpaceSkillFileInventoryEntry["kind"]),
      }];
    })
    : [];
}

function toSpaceSkill(row: SpaceSkillRow): SpaceSkill {
  return {
    ...row,
    description: row.description ?? null,
    sourceType: row.sourceType as SpaceSkillSourceType,
    sourceLocator: row.sourceLocator ?? null,
    sourceRef: row.sourceRef ?? null,
    trustLevel: row.trustLevel as SpaceSkillTrustLevel,
    compatibility: row.compatibility as SpaceSkillCompatibility,
    fileInventory: normalizeFileInventory(row),
    iconUrl: row.iconUrl ?? null,
    color: row.color ?? null,
    tagline: row.tagline ?? null,
    authorName: row.authorName ?? null,
    homepageUrl: row.homepageUrl ?? null,
    categories: normalizeCategoryList(row.categories),
    sharingScope: normalizeSharingScope(row.sharingScope),
    publicShareToken: row.publicShareToken ?? null,
    forkedFromSkillId: row.forkedFromSkillId ?? null,
    forkedFromSpaceId: row.forkedFromSpaceId ?? null,
    starCount: Math.max(0, row.starCount ?? 0),
    installCount: Math.max(0, row.installCount ?? 0),
    forkCount: Math.max(0, row.forkCount ?? 0),
    currentVersionId: row.currentVersionId ?? null,
    metadata: isPlainRecord(row.metadata) ? row.metadata : null,
  };
}

function toSpaceSkillListRow(row: SpaceSkillListDbRow): SpaceSkillListRow {
  return {
    ...row,
    description: row.description ?? null,
    sourceType: row.sourceType as SpaceSkillSourceType,
    sourceLocator: row.sourceLocator ?? null,
    sourceRef: row.sourceRef ?? null,
    trustLevel: row.trustLevel as SpaceSkillTrustLevel,
    compatibility: row.compatibility as SpaceSkillCompatibility,
    fileInventory: normalizeFileInventory(row),
    iconUrl: row.iconUrl ?? null,
    color: row.color ?? null,
    tagline: row.tagline ?? null,
    authorName: row.authorName ?? null,
    homepageUrl: row.homepageUrl ?? null,
    categories: normalizeCategoryList(row.categories),
    sharingScope: normalizeSharingScope(row.sharingScope),
    publicShareToken: row.publicShareToken ?? null,
    forkedFromSkillId: row.forkedFromSkillId ?? null,
    forkedFromSpaceId: row.forkedFromSpaceId ?? null,
    starCount: Math.max(0, row.starCount ?? 0),
    installCount: Math.max(0, row.installCount ?? 0),
    forkCount: Math.max(0, row.forkCount ?? 0),
    currentVersionId: row.currentVersionId ?? null,
    metadata: isPlainRecord(row.metadata) ? row.metadata : null,
  };
}

function normalizeSharingScope(value: unknown): SpaceSkillSharingScope {
  return value === "private" || value === "public_link" || value === "space" ? value : "space";
}

function normalizeMutableSharingScope(value: unknown): SpaceSkillSharingScope | null {
  if (value === undefined || value === null) return null;
  if (value === "private" || value === "space") return value;
  if (value === "public_link") {
    throw unprocessable("Public skill sharing is not available in this version.");
  }
  throw unprocessable("Invalid skill sharing scope.");
}

function normalizeCategoryName(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}

function categoryLookupKey(value: string) {
  return value.toLocaleLowerCase();
}

function normalizeCategoryList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const categories: string[] = [];
  for (const value of values) {
    const category = normalizeCategoryName(value);
    if (!category) continue;
    const key = categoryLookupKey(category);
    if (seen.has(key)) continue;
    seen.add(key);
    categories.push(category);
  }
  return categories;
}

function normalizeStoreText(value: unknown, maxLength = 500) {
  const text = asString(value);
  return text ? text.slice(0, maxLength) : null;
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(asString).filter((entry): entry is string => Boolean(entry))
    : [];
}

function readSkillStoreMetadata(frontmatter: Record<string, unknown>, metadata: Record<string, unknown> | null) {
  const categories = normalizeCategoryList([
    ...readStringList(frontmatter.categories),
    ...readStringList(frontmatter.tags),
    ...readStringList(metadata?.categories),
    ...readStringList(metadata?.tags),
  ]);
  return {
    iconUrl: normalizeStoreText(frontmatter.iconUrl ?? frontmatter.icon ?? metadata?.iconUrl ?? metadata?.icon, 2000),
    color: normalizeStoreText(frontmatter.color ?? metadata?.color, 64),
    tagline: normalizeStoreText(frontmatter.tagline ?? frontmatter.summary ?? metadata?.tagline, 120),
    authorName: normalizeStoreText(frontmatter.author ?? frontmatter.authorName ?? metadata?.authorName, 200),
    homepageUrl: normalizeStoreText(frontmatter.homepage ?? frontmatter.homepageUrl ?? metadata?.homepageUrl, 2000),
    categories,
  };
}

function serializeFileInventory(
  fileInventory: SpaceSkillFileInventoryEntry[],
): Array<Record<string, unknown>> {
  return fileInventory.map((entry) => ({
    path: entry.path,
    kind: entry.kind,
  }));
}

function serializeVersionFileInventory(
  fileInventory: SpaceSkillVersionFileInventoryEntry[],
): SpaceSkillVersionFileInventoryEntry[] {
  return fileInventory.map((entry) => ({
    path: entry.path,
    kind: entry.kind,
    content: entry.content,
    ...(entry.encoding ? { encoding: entry.encoding } : {}),
    ...(entry.executable ? { executable: true } : {}),
  }));
}

function toSpaceSkillVersion(row: SpaceSkillVersionRow): SpaceSkillVersion {
  const { packageSnapshotId: _package, packageFileMap: _map, migrationAt: _migration, ...publicRow } = row;
  return {
    ...publicRow,
    label: row.label ?? null,
    releaseId: row.releaseId ?? null,
    releaseName: row.releaseName ?? null,
    releasedAt: row.releasedAt ?? null,
    fileInventory: Array.isArray(row.fileInventory)
      ? row.fileInventory.flatMap((entry) => {
        if (!isPlainRecord(entry)) return [];
        return [{
          path: String(entry.path ?? ""),
          kind: (String(entry.kind ?? "other") as SpaceSkillFileInventoryEntry["kind"]),
          content: String(entry.content ?? ""),
          ...(entry.encoding === "base64" ? { encoding: "base64" as const } : {}),
          ...(entry.executable === true ? { executable: true } : {}),
        }];
      })
      : [],
    authorAgentId: row.authorAgentId ?? null,
    authorUserId: row.authorUserId ?? null,
  };
}

function toSpaceSkillComment(row: SpaceSkillCommentRow): SpaceSkillComment {
  return {
    ...row,
    parentCommentId: row.parentCommentId ?? null,
    authorAgentId: row.authorAgentId ?? null,
    authorUserId: row.authorUserId ?? null,
    deletedAt: row.deletedAt ?? null,
  };
}

function toSpaceSkillTestInput(row: SpaceSkillTestInputRow): SpaceSkillTestInput {
  return {
    ...row,
    deletedAt: row.deletedAt ?? null,
  };
}

const BUILT_IN_SKILL_TEST_RUN_TEMPLATE_ID = "built-in:default-test-template";
const BUILT_IN_SKILL_TEST_RUN_TEMPLATE_DATE = new Date("2026-01-01T00:00:00.000Z");
const BUILT_IN_SKILL_TEST_RUN_TEMPLATE_BODY = [
  "You are running a Skills Studio test for `{{skillName}}` (`{{skillKey}}`), skill version v{{skillVersion}}.",
  "",
  "Invoke and use the selected skill under test: `{{skillInvocation}}`. Use the pinned skill revision supplied by Outpost as the source of truth, regardless of any other runtime skills.",
  "",
  "This is a test run. Do not make durable changes outside this test task. Do not mutate unrelated issues, push, publish, send external messages, or affect real work.",
  "",
  "If the skill would create documents, images, videos, files, or other assets, create test versions in an obviously test-scoped location when applicable, then post the results back to this task as issue documents, attachments, or work products.",
  "",
  "Write the final result to issue document `{{outputDocumentKey}}`, then mark this test task done.",
].join("\n");

function builtInSkillTestRunTemplate(spaceId: string): SpaceSkillTestRunTemplate {
  return {
    id: BUILT_IN_SKILL_TEST_RUN_TEMPLATE_ID,
    spaceId,
    name: "Default test template",
    description: "Outpost's read-only default harness instructions for Skills Studio runs.",
    body: BUILT_IN_SKILL_TEST_RUN_TEMPLATE_BODY,
    builtIn: true,
    createdByAgentId: null,
    createdByUserId: null,
    updatedByAgentId: null,
    updatedByUserId: null,
    deletedAt: null,
    createdAt: BUILT_IN_SKILL_TEST_RUN_TEMPLATE_DATE,
    updatedAt: BUILT_IN_SKILL_TEST_RUN_TEMPLATE_DATE,
  };
}

function toSpaceSkillTestRunTemplate(row: SpaceSkillTestRunTemplateRow): SpaceSkillTestRunTemplate {
  return {
    ...row,
    description: row.description ?? null,
    builtIn: false,
    createdByAgentId: row.createdByAgentId ?? null,
    createdByUserId: row.createdByUserId ?? null,
    updatedByAgentId: row.updatedByAgentId ?? null,
    updatedByUserId: row.updatedByUserId ?? null,
    deletedAt: row.deletedAt ?? null,
  };
}

const ALLOWED_SKILL_TEST_TEMPLATE_PLACEHOLDERS = new Set([
  "skillName",
  "skillKey",
  "skillInvocation",
  "skillVersion",
  "runId",
  "issueId",
  "outputDocumentKey",
]);

function validateSkillTestTemplatePlaceholders(body: string) {
  const unknown = new Set<string>();
  const recognized = /\{\{\s*([A-Za-z][A-Za-z0-9]*)\s*\}\}/g;
  for (const match of body.matchAll(recognized)) {
    const key = match[1] ?? "";
    if (!ALLOWED_SKILL_TEST_TEMPLATE_PLACEHOLDERS.has(key)) {
      unknown.add(key);
    }
  }
  if (body.replace(recognized, "").includes("{{") || body.replace(recognized, "").includes("}}")) {
    throw unprocessable("Malformed template placeholder. Use explicit placeholders like {{skillName}}.");
  }
  if (unknown.size > 0) {
    throw unprocessable(`Unknown template placeholder${unknown.size === 1 ? "" : "s"}: ${Array.from(unknown).sort().join(", ")}`);
  }
}

function renderSkillTestTemplate(body: string, values: Record<string, string>) {
  validateSkillTestTemplatePlaceholders(body);
  return body.replace(/\{\{\s*([A-Za-z][A-Za-z0-9]*)\s*\}\}/g, (_match, rawKey: string) => values[rawKey] ?? "");
}

function buildHarnessIssueDescription(inputSnapshot: string, renderedTemplateBody: string | null) {
  const trimmedInput = inputSnapshot.trim();
  const trimmedTemplate = renderedTemplateBody?.trim() ?? "";
  return trimmedTemplate ? `${trimmedInput}\n\n---\n\n${trimmedTemplate}` : trimmedInput;
}

function normalizeTestRunStatus(value: string): SpaceSkillTestRunStatus {
  return value === "running" || value === "succeeded" || value === "failed" || value === "cancelled"
    ? value
    : "queued";
}

function emptyTestRunCost() {
  return {
    costCents: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
  };
}

function toSpaceSkillTestRun(
  row: SpaceSkillTestRunRow,
  cost = emptyTestRunCost(),
  taskExpired = false,
): SpaceSkillTestRun {
  return {
    ...row,
    inputId: row.inputId ?? null,
    agentConfigSnapshot: isPlainRecord(row.agentConfigSnapshot) ? row.agentConfigSnapshot : {},
    templateId: row.templateId ?? null,
    templateName: row.templateName ?? null,
    templateBody: row.templateBody ?? null,
    renderedTemplateBody: row.renderedTemplateBody ?? null,
    harnessIssueDescription: row.harnessIssueDescription || row.inputSnapshot,
    status: normalizeTestRunStatus(row.status),
    outputDocumentKey: row.outputDocumentKey || "output",
    outputSnapshot: row.outputSnapshot ?? "",
    error: row.error ?? null,
    deletedAt: row.deletedAt ?? null,
    supersededAt: row.supersededAt ?? null,
    harnessIssueExpiresAt: row.harnessIssueExpiresAt ?? null,
    harnessIssueDeletedAt: row.harnessIssueDeletedAt ?? null,
    cost,
    taskExpired,
  };
}

function versionInventorySnapshotEqual(
  left: SpaceSkillVersionFileInventoryEntry[],
  right: SpaceSkillVersionFileInventoryEntry[],
) {
  const normalize = (entries: SpaceSkillVersionFileInventoryEntry[]) =>
    JSON.stringify([...entries].sort((a, b) => a.path.localeCompare(b.path)));
  return normalize(left) === normalize(right);
}

function getSkillMeta(skill: Pick<SpaceSkill, "metadata">): SkillSourceMeta {
  return isPlainRecord(skill.metadata) ? skill.metadata as SkillSourceMeta : {};
}

function getMissingSourceMarker(metadata: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!isPlainRecord(metadata)) return null;
  return isPlainRecord(metadata.missingSource) ? metadata.missingSource : null;
}

function buildMissingLocalSourceMarker(
  skill: Pick<SpaceSkill, "sourceLocator" | "metadata">,
): SkillMissingSourceMarker {
  const existing = getMissingSourceMarker(skill.metadata);
  return {
    reason: "local_source_missing",
    sourceType: "local_path",
    sourceLocator: skill.sourceLocator ?? null,
    sourcePath: normalizeSourceLocatorDirectory(skill.sourceLocator),
    detectedAt: asString(existing?.detectedAt) ?? new Date().toISOString(),
  };
}

function withMissingSourceMarker(
  metadata: Record<string, unknown> | null,
  marker: SkillMissingSourceMarker,
) {
  return {
    ...(isPlainRecord(metadata) ? metadata : {}),
    missingSource: marker,
  };
}

function withoutMissingSourceMarker(metadata: Record<string, unknown> | null) {
  if (!isPlainRecord(metadata) || !isPlainRecord(metadata.missingSource)) return metadata;
  const next = { ...metadata };
  delete next.missingSource;
  return next;
}

function resolveSkillReference(
  skills: SkillReferenceTarget[],
  reference: string,
): { skill: SkillReferenceTarget | null; ambiguous: boolean } {
  const trimmed = reference.trim();
  if (!trimmed) {
    return { skill: null, ambiguous: false };
  }

  const byId = skills.find((skill) => skill.id === trimmed);
  if (byId) {
    return { skill: byId, ambiguous: false };
  }

  const normalizedKey = normalizeSkillKey(trimmed);
  if (normalizedKey) {
    const byKey = skills.find((skill) => skill.key === normalizedKey);
    if (byKey) {
      return { skill: byKey, ambiguous: false };
    }
  }

  const normalizedSlug = normalizeSkillSlug(trimmed);
  if (!normalizedSlug) {
    return { skill: null, ambiguous: false };
  }

  const bySlug = skills.filter((skill) => skill.slug === normalizedSlug);
  if (bySlug.length === 1) {
    return { skill: bySlug[0] ?? null, ambiguous: false };
  }
  if (bySlug.length > 1) {
    return { skill: null, ambiguous: true };
  }

  return { skill: null, ambiguous: false };
}

function resolveRequestedSkillKeysOrThrow(
  skills: SpaceSkill[],
  requestedReferences: string[],
) {
  const missing = new Set<string>();
  const ambiguous = new Set<string>();
  const resolved = new Set<string>();

  for (const reference of requestedReferences) {
    const trimmed = reference.trim();
    if (!trimmed) continue;

    const match = resolveSkillReference(skills, trimmed);
    if (match.skill) {
      resolved.add(match.skill.key);
      continue;
    }

    if (match.ambiguous) {
      ambiguous.add(trimmed);
      continue;
    }

    missing.add(trimmed);
  }

  if (ambiguous.size > 0 || missing.size > 0) {
    const problems: string[] = [];
    if (ambiguous.size > 0) {
      problems.push(`ambiguous references: ${Array.from(ambiguous).sort().join(", ")}`);
    }
    if (missing.size > 0) {
      problems.push(`unknown references: ${Array.from(missing).sort().join(", ")}`);
    }
    throw unprocessable(`Invalid space skill selection (${problems.join("; ")}).`);
  }

  return Array.from(resolved);
}

function normalizeRequestedDesiredSkillSelection(value: string | AgentDesiredSkillEntry): OutpostDesiredSkillEntry {
  if (typeof value === "string") {
    return { key: value.trim(), versionId: null };
  }
  return {
    key: value.key.trim(),
    versionId: value.versionId ?? null,
  };
}

async function assertVersionMatchesSkill(
  db: Db,
  spaceId: string,
  skillId: string,
  versionId: string | null,
) {
  if (!versionId) return;
  const row = await db
    .select({ id: spaceSkillVersions.id })
    .from(spaceSkillVersions)
    .where(and(
      eq(spaceSkillVersions.spaceId, spaceId),
      eq(spaceSkillVersions.spaceSkillId, skillId),
      eq(spaceSkillVersions.id, versionId),
    ))
    .then((rows) => rows[0] ?? null);
  if (!row) {
    throw unprocessable("Selected skill version does not belong to the requested space skill.", {
      versionId,
      skillId,
    });
  }
}

export interface ResolvedRequestedSkillEntries {
  /** References that resolved to a space-library skill. */
  resolved: OutpostDesiredSkillEntry[];
  /**
   * References that could not be resolved to a space-library skill, returned
   * in first-seen order. Only populated when `tolerateUnknownReferences` is set;
   * otherwise unknown references throw. Callers preserve these so stale desired
   * keys stay visible (and removable) instead of silently 422-ing a whole save.
   */
  unresolved: string[];
}

async function resolveRequestedSkillEntriesOrThrow(
  db: Db,
  spaceId: string,
  skills: SpaceSkill[],
  requestedSelections: Array<string | AgentDesiredSkillEntry>,
  options: { tolerateUnknownReferences?: boolean } = {},
): Promise<ResolvedRequestedSkillEntries> {
  const missing = new Set<string>();
  const ambiguous = new Set<string>();
  const resolved = new Map<string, OutpostDesiredSkillEntry>();
  const unresolved: string[] = [];
  const seenUnresolved = new Set<string>();

  for (const rawSelection of requestedSelections) {
    const selection = normalizeRequestedDesiredSkillSelection(rawSelection);
    if (!selection.key) continue;

    const match = resolveSkillReference(skills, selection.key);
    if (match.skill) {
      const skill = skills.find((candidate) => candidate.id === match.skill?.id);
      if (!skill) {
        missing.add(selection.key);
        continue;
      }
      const selectedVersionId = selection.versionId ?? null;
      await assertVersionMatchesSkill(db, spaceId, skill.id, selectedVersionId);
      if (!resolved.has(skill.key)) {
        resolved.set(skill.key, { key: skill.key, versionId: selectedVersionId });
      }
      continue;
    }

    if (match.ambiguous) {
      ambiguous.add(selection.key);
      continue;
    }

    // Unknown / stale reference (no longer in the space library).
    if (options.tolerateUnknownReferences) {
      if (!seenUnresolved.has(selection.key)) {
        seenUnresolved.add(selection.key);
        unresolved.push(selection.key);
      }
      continue;
    }
    missing.add(selection.key);
  }

  // Ambiguous references are always a hard error — they signal a genuine
  // conflict the caller must disambiguate. Unknown references are only fatal
  // when the caller has not opted into tolerating (and preserving) stale keys.
  if (ambiguous.size > 0 || missing.size > 0) {
    const problems: string[] = [];
    if (ambiguous.size > 0) {
      problems.push(`ambiguous references: ${Array.from(ambiguous).sort().join(", ")}`);
    }
    if (missing.size > 0) {
      problems.push(`unknown references: ${Array.from(missing).sort().join(", ")}`);
    }
    throw unprocessable(`Invalid space skill selection (${problems.join("; ")}).`);
  }

  return { resolved: Array.from(resolved.values()), unresolved };
}

function resolveDesiredSkillKeys(
  skills: SkillReferenceTarget[],
  config: Record<string, unknown>,
) {
  const preference = readOutpostSkillSyncPreference(config);
  return Array.from(new Set(
    preference.desiredSkills
      .map((reference) => resolveSkillReference(skills, reference).skill?.key ?? normalizeSkillKey(reference))
      .filter((value): value is string => Boolean(value)),
  ));
}

function resolveDesiredSkillEntries(
  skills: SkillReferenceTarget[],
  config: Record<string, unknown>,
) {
  const preference = readOutpostSkillSyncPreference(config);
  const out = new Map<string, OutpostDesiredSkillEntry>();
  for (const entry of preference.desiredSkillEntries) {
    const key = resolveSkillReference(skills, entry.key).skill?.key ?? normalizeSkillKey(entry.key);
    if (!key || out.has(key)) continue;
    out.set(key, { key, versionId: entry.versionId ?? null });
  }
  return Array.from(out.values());
}

function normalizeSkillDirectory(skill: SkillSourceInfoTarget) {
  if ((skill.sourceType !== "local_path" && skill.sourceType !== "catalog") || !skill.sourceLocator) return null;
  const resolved = path.resolve(skill.sourceLocator);
  if (path.basename(resolved).toLowerCase() === "skill.md") {
    return path.dirname(resolved);
  }
  return resolved;
}

function normalizeSourceLocatorDirectory(sourceLocator: string | null) {
  if (!sourceLocator) return null;
  const resolved = path.resolve(sourceLocator);
  return path.basename(resolved).toLowerCase() === "skill.md" ? path.dirname(resolved) : resolved;
}

async function resolveExistingSkillDirectory(skillDir: string | null) {
  if (!skillDir) return null;
  const dirStat = await statPath(skillDir);
  const skillFileStat = await statPath(path.join(skillDir, "SKILL.md"));
  return dirStat?.isDirectory() && skillFileStat?.isFile() ? skillDir : null;
}

function buildMissingRuntimeSourceDetail(skill: Pick<SpaceSkill, "name" | "sourceLocator" | "metadata">) {
  const marker = getMissingSourceMarker(skill.metadata);
  const sourcePath = asString(marker?.sourcePath) ?? normalizeSourceLocatorDirectory(skill.sourceLocator);
  if (sourcePath) {
    return `Outpost skill "${skill.name}" is in the library, but Outpost cannot find its local source at ${sourcePath}.`;
  }
  return `Outpost skill "${skill.name}" is in the library, but Outpost cannot find a valid local runtime source for it.`;
}

export async function findMissingLocalSkillIds(
  skills: Array<Pick<SpaceSkill, "id" | "sourceType" | "sourceLocator">>,
) {
  const missingIds: string[] = [];

  for (const skill of skills) {
    if (skill.sourceType !== "local_path") continue;
    const skillDir = normalizeSourceLocatorDirectory(skill.sourceLocator);
    if (!skillDir) {
      missingIds.push(skill.id);
      continue;
    }

    const skillDirStat = await statPath(skillDir);
    const skillFileStat = await statPath(path.join(skillDir, "SKILL.md"));
    if (!skillDirStat?.isDirectory() || !skillFileStat?.isFile()) {
      missingIds.push(skill.id);
    }
  }

  return missingIds;
}

function resolveManagedSkillsRoot(spaceId: string) {
  return path.resolve(resolveOutpostInstanceRoot(), "skills", spaceId);
}

/**
 * A rename target must be a true Outpost-managed local skill: a `local_path`
 * skill whose `managed_local` source directory lives directly under the
 * space managed-skills root (e.g. `<managedRoot>/<slug>`). This deliberately
 * excludes catalog (`__catalog__/...`), runtime (`__runtime__/...`) and other
 * reserved subtrees, project-scanned skills, unmanaged `local_path` skills, and
 * all remote source types, which keep their own identity/update semantics.
 */
function isOutpostManagedRenameTarget(skill: SpaceSkill): boolean {
  if (skill.sourceType !== "local_path") return false;
  if (getSkillMeta(skill).sourceKind !== "managed_local") return false;
  const skillDir = normalizeSkillDirectory(skill);
  if (!skillDir) return false;
  const managedRoot = resolveManagedSkillsRoot(skill.spaceId);
  const relative = path.relative(managedRoot, skillDir);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return false;
  const segments = relative.split(path.sep);
  // Managed skills are a direct child of the root; reject reserved `__*` dirs.
  return segments.length === 1 && !segments[0]!.startsWith("__");
}

function resolveLocalSkillFilePath(skill: SpaceSkill, relativePath: string) {
  const normalized = normalizePortablePath(relativePath);
  const skillDir = normalizeSkillDirectory(skill);
  if (skillDir) {
    return path.resolve(skillDir, normalized);
  }

  if (!skill.sourceLocator) return null;
  const fallbackRoot = path.resolve(skill.sourceLocator);
  const directPath = path.resolve(fallbackRoot, normalized);
  return directPath;
}

async function collectSkillFileBytes(skillDir: string): Promise<{
  files: Array<{ path: string; bytes: Buffer; sizeBytes: number; kind: SpaceSkillFileInventoryEntry["kind"] }>;
  findings: SpaceSkillAuditFinding[];
}> {
  const files: Array<{ path: string; bytes: Buffer; sizeBytes: number; kind: SpaceSkillFileInventoryEntry["kind"] }> = [];
  const findings: SpaceSkillAuditFinding[] = [];
  const root = path.resolve(skillDir);

  async function visit(current: string) {
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolutePath = path.resolve(current, entry.name);
      const relativePath = normalizePortablePath(path.relative(root, absolutePath));
      if (!relativePath || relativePath.split("/").includes("..") || path.isAbsolute(relativePath)) {
        findings.push({
          code: "path_out_of_tree",
          severity: "error",
          message: "Resolved file path is outside the skill directory.",
          path: relativePath || null,
        });
        continue;
      }

      const lstat = await fs.lstat(absolutePath).catch(() => null);
      if (!lstat) continue;
      if (lstat.isSymbolicLink()) {
        findings.push({
          code: "symlink",
          severity: "error",
          message: "Skill files must not be symlinks.",
          path: relativePath,
        });
        continue;
      }
      if (lstat.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!lstat.isFile()) continue;
      const bytes = await fs.readFile(absolutePath);
      files.push({
        path: relativePath,
        bytes,
        sizeBytes: lstat.size,
        kind: classifyInventoryKind(relativePath),
      });
    }
  }

  await visit(root);
  files.sort((left, right) => {
    if (left.path === "SKILL.md") return -1;
    if (right.path === "SKILL.md") return 1;
    return left.path.localeCompare(right.path);
  });
  return { files, findings };
}

function contentLooksBinary(bytes: Buffer) {
  if (bytes.includes(0)) return true;
  const text = bytes.toString("utf8");
  return text.includes("\uFFFD");
}

function extractMarkdownLinks(markdown: string) {
  const links: string[] = [];
  const regex = /\[[^\]]+\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(markdown)) !== null) {
    const link = match[1]?.trim();
    if (link) links.push(link);
  }
  return links;
}

function pushFinding(
  findings: SpaceSkillAuditFinding[],
  code: string,
  severity: SpaceSkillAuditFinding["severity"],
  message: string,
  filePath: string | null,
) {
  findings.push({ code, severity, message, path: filePath });
}

async function auditInstalledSkillBytes(skill: SpaceSkill, requireEntrypoint = true): Promise<SpaceSkillAuditResult> {
  const skillDir = normalizeSkillDirectory(skill);
  const scannedAt = new Date().toISOString();
  const originHash = asString(getSkillMeta(skill).originHash);
  if (!skillDir) {
    return {
      skillId: skill.id,
      installedHash: null,
      originHash,
      verdict: "fail",
      codes: ["origin_unavailable"],
      findings: [{
        code: "origin_unavailable",
        severity: "error",
        message: "Skill files are not available on disk for audit.",
        path: null,
      }],
      scannedAt,
      scanVersion: SKILL_AUDIT_SCAN_VERSION,
    };
  }

  const { files, findings } = await collectSkillFileBytes(skillDir);
  const actualPaths = files.map((file) => file.path).sort((left, right) => left.localeCompare(right));
  const expectedPaths = skill.fileInventory.map((entry) => normalizePortablePath(entry.path)).sort((left, right) => left.localeCompare(right));
  const installedHash = buildInventoryContentHash(files.map((file) => ({
    path: file.path,
    sha256: sha256Buffer(file.bytes),
  })));

  if (requireEntrypoint && !actualPaths.includes("SKILL.md")) {
    pushFinding(findings, "missing_skill_md", "error", "Skill inventory does not contain SKILL.md.", "SKILL.md");
  }

  const actualSet = new Set(actualPaths);
  const expectedSet = new Set(expectedPaths);
  for (const expected of expectedPaths) {
    if (!actualSet.has(expected)) {
      if (expected === "SKILL.md") continue;
      pushFinding(findings, "inventory_mismatch", "error", "Expected inventory file is missing on disk.", expected);
    }
  }
  for (const actual of actualPaths) {
    if (!expectedSet.has(actual)) {
      pushFinding(findings, "inventory_mismatch", "error", "Installed file is not present in recorded inventory.", actual);
    }
  }

  const fileMap = new Map(files.map((file) => [file.path, file]));
  const skillFile = fileMap.get("SKILL.md");
  if (requireEntrypoint && skillFile) {
    const markdown = skillFile.bytes.toString("utf8");
    const parsed = parseFrontmatterMarkdown(markdown);
    if (!markdown.startsWith("---\n") || !asString(parsed.frontmatter.name)) {
      pushFinding(findings, "invalid_frontmatter", "error", "SKILL.md must contain valid frontmatter with a name.", "SKILL.md");
    }
  }

  const remoteExecPattern = /\b(?:curl|wget)\b[\s\S]{0,160}\|\s*(?:sh|bash)|\b(?:bash|sh)\s+-c\b|\beval(?:\s*\(|[ \t]+["'$`])|\bpython\s+-c\b|\bnode\s+-e\b/i;
  const shellEvalPattern = /(?:^|[;&|(){}!\n]|\b(?:if|then|else|elif|while|until|do|time)\b)[ \t]*(?:(?:command|builtin)[ \t]+)*["']?eval["']?(?:\s|;|$)/i;
  const secretExfilPattern = /\b(?:cat|printenv|env|grep)\b[\s\S]{0,160}(?:\.aws\/credentials|\.ssh\/|\.npmrc|id_rsa|OPENAI_API_KEY|ANTHROPIC_API_KEY|API_KEY|TOKEN|SECRET)[\s\S]{0,160}\b(?:curl|wget|nc|netcat|scp)\b/i;
  const networkPattern = /\b(?:curl|wget|fetch|httpie|nc|netcat|scp|ssh)\b|https?:\/\//i;
  const secretReferencePattern = /\b(?:process\.env|printenv|\$[A-Z][A-Z0-9_]{2,}|API_KEY|TOKEN|SECRET|PASSWORD|\.env)\b/i;

  for (const file of files) {
    if (file.sizeBytes > MAX_CATALOG_FILE_BYTES) {
      pushFinding(findings, "oversized_file", "error", `Skill file exceeds ${MAX_CATALOG_FILE_BYTES} bytes.`, file.path);
    }
    if (file.kind !== "asset" && contentLooksBinary(file.bytes)) {
      pushFinding(findings, "non_text_file", "error", "Non-asset skill files must be UTF-8 text.", file.path);
      continue;
    }
    if (file.kind === "asset" || file.kind === "script" || file.kind === "other") {
      pushFinding(findings, `${file.kind}_trust`, "warning", `Skill includes a ${file.kind} file.`, file.path);
    }
    // Text assets still require content checks; a directory or extension must
    // not hide remote execution or secret exfiltration instructions.
    if (file.kind === "asset" && contentLooksBinary(file.bytes)) continue;

    const text = file.bytes.toString("utf8");
    if (remoteExecPattern.test(text) || (file.kind === "script" && shellEvalPattern.test(text))) {
      pushFinding(findings, "remote_fetch_exec", "error", "Remote-fetch or dynamic execution pattern is not allowed.", file.path);
    }
    if (secretExfilPattern.test(text)) {
      pushFinding(findings, "secret_exfiltration", "error", "Secret exfiltration pattern is not allowed.", file.path);
    }
    if (networkPattern.test(text)) {
      pushFinding(findings, "network_reference", "warning", "Skill content references network-capable commands or URLs.", file.path);
    }
    if (secretReferencePattern.test(text)) {
      pushFinding(findings, "secret_reference", "warning", "Skill content references environment variables or secret-like values.", file.path);
    }
    if (isMarkdownPath(file.path)) {
      for (const link of extractMarkdownLinks(text)) {
        if (/^(?:https?:|mailto:|#)/i.test(link)) continue;
        const linkTarget = normalizePortablePath(path.posix.join(path.posix.dirname(file.path), link.split("#")[0] ?? ""));
        if (linkTarget && !actualSet.has(linkTarget)) {
          pushFinding(findings, "broken_internal_link", "warning", `Markdown link target is missing: ${link}`, file.path);
        }
      }
    }
  }

  if (originHash && installedHash !== originHash) {
    pushFinding(findings, "local_modifications", "warning", "Installed catalog bytes differ from the pinned origin hash.", null);
  }

  findings.sort((left, right) => `${left.severity}:${left.code}:${left.path ?? ""}`.localeCompare(`${right.severity}:${right.code}:${right.path ?? ""}`));
  const verdict: SpaceSkillAuditVerdict = findings.some((finding) => finding.severity === "error")
    ? "fail"
    : findings.length > 0 ? "warning" : "pass";
  return {
    skillId: skill.id,
    installedHash,
    originHash,
    verdict,
    codes: Array.from(new Set(findings.map((finding) => finding.code))).sort(),
    findings,
    scannedAt,
    scanVersion: SKILL_AUDIT_SCAN_VERSION,
  };
}

/** Audit downloaded packages before they become installed space content. */
export async function auditSkillSnapshot(files: SpaceSkillVersionFileInventoryEntry[], requireEntrypoint = true) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "outpost-skill-audit-"));
  try {
    for (const file of files) {
      const target = path.join(root, assertSkillSnapshotPath(file.path));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, skillFileBytes(file), { mode: 0o600 });
    }
    const result = await auditInstalledSkillBytes({ sourceType: "local_path", sourceLocator: root,
      fileInventory: files, metadata: null } as unknown as SpaceSkill, requireEntrypoint);
    return result.findings;
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

function inferLanguageFromPath(filePath: string) {
  const fileName = path.posix.basename(filePath).toLowerCase();
  if (fileName === "skill.md" || fileName.endsWith(".md")) return "markdown";
  if (fileName.endsWith(".ts")) return "typescript";
  if (fileName.endsWith(".tsx")) return "tsx";
  if (fileName.endsWith(".js")) return "javascript";
  if (fileName.endsWith(".jsx")) return "jsx";
  if (fileName.endsWith(".json")) return "json";
  if (fileName.endsWith(".yml") || fileName.endsWith(".yaml")) return "yaml";
  if (fileName.endsWith(".sh")) return "bash";
  if (fileName.endsWith(".py")) return "python";
  if (fileName.endsWith(".html")) return "html";
  if (fileName.endsWith(".css")) return "css";
  return null;
}

function isMarkdownPath(filePath: string) {
  const fileName = path.posix.basename(filePath).toLowerCase();
  return fileName === "skill.md" || fileName.endsWith(".md");
}

function deriveSkillSourceInfo(skill: SkillSourceInfoTarget): {
  editable: boolean;
  editableReason: string | null;
  sourceLabel: string | null;
  sourceBadge: SpaceSkillSourceBadge;
  sourcePath: string | null;
} {
  const metadata = getSkillMeta(skill);
  if (skill.sourceType === "managed") return {
    editable: true, editableReason: null, sourceLabel: "Outpost", sourceBadge: "outpost", sourcePath: null,
  };
  const localSkillDir = normalizeSkillDirectory(skill);
  if (metadata.sourceKind === "outpost_bundled") {
    return {
      editable: false,
      editableReason: "Bundled Outpost skills are read-only.",
      sourceLabel: "Outpost bundled",
      sourceBadge: "outpost",
      sourcePath: null,
    };
  }

  if (skill.sourceType === "skills_sh") {
    const owner = asString(metadata.owner) ?? null;
    const repo = asString(metadata.repo) ?? null;
    return {
      editable: false,
      editableReason: "Skills.sh-managed skills are read-only.",
      sourceLabel: skill.sourceLocator ?? (owner && repo ? `${owner}/${repo}` : null),
      sourceBadge: "skills_sh",
      sourcePath: null,
    };
  }

  if (skill.sourceType === "github") {
    const owner = asString(metadata.owner) ?? null;
    const repo = asString(metadata.repo) ?? null;
    return {
      editable: false,
      editableReason: "Remote GitHub skills are read-only. Fork or import locally to edit them.",
      sourceLabel: owner && repo ? `${owner}/${repo}` : skill.sourceLocator,
      sourceBadge: "github",
      sourcePath: null,
    };
  }

  if (skill.sourceType === "url") {
    return {
      editable: false,
      editableReason: "URL-based skills are read-only. Save them locally to edit them.",
      sourceLabel: skill.sourceLocator,
      sourceBadge: "url",
      sourcePath: null,
    };
  }

  if (skill.sourceType === "local_path") {
    const managedRoot = resolveManagedSkillsRoot(skill.spaceId);
    const projectName = asString(metadata.projectName);
    const workspaceName = asString(metadata.workspaceName);
    const isProjectScan = metadata.sourceKind === "project_scan";
    if (localSkillDir && localSkillDir.startsWith(managedRoot)) {
      return {
        editable: true,
        editableReason: null,
        sourceLabel: "Outpost workspace",
        sourceBadge: "outpost",
        sourcePath: managedRoot,
      };
    }

    return {
      editable: true,
      editableReason: null,
      sourceLabel: isProjectScan
        ? [projectName, workspaceName].filter((value): value is string => Boolean(value)).join(" / ")
          || skill.sourceLocator
        : skill.sourceLocator,
      sourceBadge: "local",
      sourcePath: null,
    };
  }

  return {
    editable: false,
    editableReason: "This skill source is read-only.",
    sourceLabel: skill.sourceLocator,
    sourceBadge: "catalog",
    sourcePath: null,
  };
}

function enrichSkill(
  skill: SpaceSkill,
  attachedAgentCount: number,
  usedByAgents: SpaceSkillUsageAgent[] = [],
  currentVersion: SpaceSkillVersionSummary | null = null,
  starredByCurrentActor = false,
  existingForks: SpaceSkillForkSummary[] = [],
) {
  const source = deriveSkillSourceInfo(skill);
  return {
    ...skill,
    attachedAgentCount,
    usedByAgents,
    existingForks,
    currentVersion,
    starredByCurrentActor,
    ...source,
  };
}

function summarizeOriginalSkill(skill: SpaceSkill): SpaceSkillOriginalSummary {
  return {
    id: skill.id,
    name: skill.name,
    slug: skill.slug,
    sourceType: skill.sourceType,
    sourceLocator: skill.sourceLocator,
    sourceRef: skill.sourceRef,
  };
}

function forkCreatedByActor(skill: SpaceSkill, actor?: SkillActor | null) {
  const metadata = getSkillMeta(skill);
  if (actor?.type === "agent" && actor.agentId) {
    return asString(metadata.forkedByAgentId) === actor.agentId;
  }
  if (actor?.type === "user" && actor.userId) {
    return asString(metadata.forkedByUserId) === actor.userId;
  }
  return false;
}

function summarizeForkSkill(
  skill: SpaceSkill,
  actor: SkillActor | null | undefined,
  versionCount: number,
): SpaceSkillForkSummary {
  const metadata = getSkillMeta(skill);
  return {
    ...summarizeOriginalSkill(skill),
    key: skill.key,
    forkedFromSkillId: skill.forkedFromSkillId,
    forkedFromSpaceId: skill.forkedFromSpaceId,
    currentVersionId: skill.currentVersionId,
    createdByCurrentActor: forkCreatedByActor(skill, actor),
    diverged: versionCount > 1 || Boolean(asString(metadata.userModifiedAt)),
    createdAt: skill.createdAt,
    updatedAt: skill.updatedAt,
  };
}

function toSpaceSkillListItem(skill: SpaceSkillListRow, attachedAgentCount: number): SpaceSkillListItem {
  const source = deriveSkillSourceInfo(skill);
  const metadata = getSkillMeta(skill);
  const catalogKind = skill.sourceType === "catalog" && (metadata.catalogKind === "bundled" || metadata.catalogKind === "optional")
    ? metadata.catalogKind
    : null;
  const originHash = skill.sourceType === "catalog" ? asString(metadata.originHash) : null;
  const packageName = skill.sourceType === "catalog" ? asString(metadata.packageName) : null;
  const packageVersion = skill.sourceType === "catalog" ? asString(metadata.packageVersion) : null;
  return {
    id: skill.id,
    spaceId: skill.spaceId,
    folderId: skill.folderId,
    folderPath: skill.folderPath ?? null,
    key: skill.key,
    slug: skill.slug,
    name: skill.name,
    description: skill.description,
    sourceType: skill.sourceType,
    sourceLocator: skill.sourceLocator,
    sourceRef: skill.sourceRef,
    trustLevel: skill.trustLevel,
    compatibility: skill.compatibility,
    fileInventory: skill.fileInventory,
    iconUrl: skill.iconUrl,
    color: skill.color,
    tagline: skill.tagline,
    authorName: skill.authorName,
    homepageUrl: skill.homepageUrl,
    categories: skill.categories,
    sharingScope: skill.sharingScope,
    publicShareToken: skill.publicShareToken,
    forkedFromSkillId: skill.forkedFromSkillId,
    forkedFromSpaceId: skill.forkedFromSpaceId,
    starCount: skill.starCount,
    installCount: skill.installCount,
    forkCount: skill.forkCount,
    currentVersionId: skill.currentVersionId,
    createdAt: skill.createdAt,
    updatedAt: skill.updatedAt,
    attachedAgentCount,
    editable: source.editable,
    editableReason: source.editableReason,
    sourceLabel: source.sourceLabel,
    sourceBadge: source.sourceBadge,
    sourcePath: source.sourcePath,
    catalogKind,
    originHash,
    packageName,
    packageVersion,
  };
}

async function listLastEditorsBySkillId(
  db: Db,
  spaceId: string,
  skillIds: string[],
): Promise<Map<string, SpaceSkillLastEditor | null>> {
  if (skillIds.length === 0) return new Map();
  const rows = await db
    .selectDistinctOn([spaceSkillVersions.spaceSkillId], {
      spaceSkillId: spaceSkillVersions.spaceSkillId,
      authorAgentId: spaceSkillVersions.authorAgentId,
      authorUserId: spaceSkillVersions.authorUserId,
      userName: authUsers.name,
      userImage: authUsers.image,
      agentName: agentsTable.name,
    })
    .from(spaceSkillVersions)
    .leftJoin(authUsers, eq(authUsers.id, spaceSkillVersions.authorUserId))
    .leftJoin(
      agentsTable,
      and(
        eq(agentsTable.spaceId, spaceId),
        eq(agentsTable.id, spaceSkillVersions.authorAgentId),
      ),
    )
    .where(and(
      eq(spaceSkillVersions.spaceId, spaceId),
      inArray(spaceSkillVersions.spaceSkillId, skillIds),
    ))
    .orderBy(
      spaceSkillVersions.spaceSkillId,
      desc(spaceSkillVersions.createdAt),
      desc(spaceSkillVersions.revisionNumber),
      desc(spaceSkillVersions.id),
    );

  const editors = new Map<string, SpaceSkillLastEditor | null>();
  for (const row of rows) {
    if (row.authorUserId) {
      editors.set(row.spaceSkillId, {
        kind: "user",
        id: row.authorUserId,
        name: row.userName ?? null,
        imageUrl: row.userImage ?? null,
      });
      continue;
    }
    if (row.authorAgentId) {
      editors.set(row.spaceSkillId, {
        kind: "agent",
        id: row.authorAgentId,
        name: row.agentName ?? null,
        imageUrl: null,
      });
      continue;
    }
    editors.set(row.spaceSkillId, null);
  }
  return editors;
}

export function spaceSkillService(db: Db, options: { actor?: AuthorizationActor; packageDb?: Db } = {}) {
  const packageDb = options.packageDb ?? db;
  const managedContent = managedSkillContent(db, packageDb);
  const executionContent = skillExecutionContent(db, options);
  const packages = skillPackageStore(packageDb);
  const packageRuntime = skillPackageRuntime(packageDb);
  // Admin reads keep SQL on the caller's transaction, which may own the pool's only slot.
  const packageReader = db === packageDb ? packages : skillPackageStore(db, undefined, packageDb);
  const visibility = (database: DbOrTransaction = db) => skillAccessService(database as Db, options.actor);
  const folderSvc = folderService(db);
  const agents = agentService(db);
  const projects = projectService(db);

  async function assertLocalImportSourceAllowed(spaceId: string, source: string) {
    const sourceRealPath = await fs.realpath(path.resolve(source)).catch(() => null);
    if (!sourceRealPath) {
      throw unprocessable("Local skill source is not available", {
        code: "skill_source_validation_failed",
      });
    }
    await assertLocalImportOutsideSkillPackageCache(sourceRealPath, resolveManagedSkillsRoot(spaceId));
    const projectRows = await projects.list(spaceId);
    const configuredRoots = [
      resolveManagedSkillsRoot(spaceId),
      ...projectRows.flatMap((project) => project.workspaces.map((workspace) => workspace.cwd)),
      // Include server-derived managed-checkout dirs for projects with no registered workspace cwd.
      // Uses managedFolder (not effectiveLocalFolder) to stay server-controlled; user-registered
      // localFolder paths are already covered by workspaces[].cwd above.
      ...projectRows.map((project) => project.codebase.managedFolder),
    ].filter((root): root is string => typeof root === "string" && root.trim().length > 0);
    const approvedRoots = (await Promise.all(
      configuredRoots.map((root) => fs.realpath(path.resolve(root)).catch(() => null)),
    )).filter((root): root is string => Boolean(root));
    const allowed = approvedRoots.some(
      (root) => sourceRealPath === root || sourceRealPath.startsWith(`${root}${path.sep}`),
    );
    if (!allowed) {
      throw forbidden("Local skill source is outside approved space workspace roots", {
        code: "skill_workspace_boundary_denied",
        remediation: "Import from a configured Outpost workspace or the space managed-skill directory.",
      });
    }
    // A filesystem import cannot discard the provenance of installed private
    // snapshots or their materialized copies, even for an authorized reader.
    const restricted = await db.select({ id: spaceSkills.id, key: spaceSkills.key, slug: spaceSkills.slug,
      sourceType: spaceSkills.sourceType, sourceLocator: spaceSkills.sourceLocator }).from(spaceSkills).where(and(
      eq(spaceSkills.spaceId, spaceId), isNotNull(spaceSkills.accessSourceId)));
    for (const skill of restricted) {
      const localRoot = skill.sourceType === "local_path" || skill.sourceType === "catalog" ? normalizeSourceLocatorDirectory(skill.sourceLocator) : null;
      const protectedRoots = [path.join(resolveManagedSkillsRoot(spaceId), "__versions__", skill.id),
        resolveRuntimeSkillMaterializedPath(spaceId, skill), localRoot].filter((root): root is string => Boolean(root));
      for (const root of protectedRoots) {
        const canonical = await fs.realpath(root).catch(() => null);
        if (canonical && (sourceRealPath === canonical || sourceRealPath.startsWith(`${canonical}${path.sep}`)
          || canonical.startsWith(`${sourceRealPath}${path.sep}`))) {
          await visibility().assertSkill(spaceId, skill.id);
          throw unprocessable("Project-derived skill files cannot be imported as a space-wide local source. Fork the installed skill to retain project access.",
            { code: "skill_project_provenance_required" });
        }
      }
    }
  }

  async function ensureBundledSkills(spaceId: string) {
    for (const skillsRoot of resolveBundledSkillsRoot()) {
      const stats = await fs.stat(skillsRoot).catch(() => null);
      if (!stats?.isDirectory()) continue;
      const bundledSkills = await readLocalSkillImports(spaceId, skillsRoot)
        .then((skills) => skills.map((skill) => ({
          ...skill,
          key: deriveCanonicalSkillKey(spaceId, {
            ...skill,
            metadata: {
              ...(skill.metadata ?? {}),
              sourceKind: "outpost_bundled",
            },
          }),
          metadata: {
            ...(skill.metadata ?? {}),
            sourceKind: "outpost_bundled",
          },
        })))
        .then((skills) => skills.filter((skill) =>
          OUTPOST_CORE_SKILL_KEYS.includes(skill.key as typeof OUTPOST_CORE_SKILL_KEYS[number])))
        .catch(() => [] as ImportedSkill[]);
      if (bundledSkills.length === 0) continue;
      return upsertImportedSkills(spaceId, bundledSkills, db, { includeFolderPath: false });
    }
    return [];
  }

  async function readBundledSkillReleaseRegistry() {
    for (const registryRoot of resolveBundledSkillReleasesRoot()) {
      const manifestPath = path.join(registryRoot, "releases.json");
      const manifestText = await fs.readFile(manifestPath, "utf8").catch(() => null);
      if (!manifestText) continue;
      const parsed = JSON.parse(manifestText) as unknown;
      if (!Array.isArray(parsed)) throw new Error(`Invalid bundled skill release manifest: ${manifestPath}`);
      return parsed.map((entry): BundledSkillReleaseManifestEntry & { releaseDir: string } => {
        if (!isPlainRecord(entry)) throw new Error(`Invalid bundled skill release entry: ${manifestPath}`);
        const id = asString(entry.id);
        const releaseName = asString(entry.releaseName);
        const releasedAt = asString(entry.releasedAt);
        const notes = asString(entry.notes);
        const dir = asString(entry.dir);
        if (!id || !releaseName || !releasedAt || !notes || !dir) {
          throw new Error(`Incomplete bundled skill release entry: ${manifestPath}`);
        }
        const releaseDir = path.resolve(registryRoot, dir);
        const relativeReleaseDir = path.relative(registryRoot, releaseDir);
        if (relativeReleaseDir.startsWith("..") || path.isAbsolute(relativeReleaseDir)) {
          throw new Error(`Bundled skill release directory escapes registry root: ${dir}`);
        }
        return { id, releaseName, releasedAt, notes, dir, releaseDir };
      });
    }
    return [];
  }

  async function collectVersionFileInventoryFromDirectory(
    skillDir: string,
  ): Promise<SpaceSkillVersionFileInventoryEntry[]> {
    const inventory = await collectLocalSkillInventory(skillDir);
    return Promise.all(inventory.map(async (entry) => ({
      ...snapshotFile(entry.path, entry.kind, await fs.readFile(path.join(skillDir, entry.path)), Boolean((await fs.stat(path.join(skillDir, entry.path))).mode & 0o111)),
    })));
  }

  async function ensureBundledSkillReleases(spaceId: string, bundledSkills: SpaceSkill[]) {
    const outpostSkill = bundledSkills.find((skill) => skill.key === "outpost/outpost/outpost-task");
    if (!outpostSkill) return;
    for (const release of await readBundledSkillReleaseRegistry()) {
      const fileInventory = serializeVersionFileInventory(
        await collectVersionFileInventoryFromDirectory(release.releaseDir),
      );
      const registryHash = buildInventoryContentHash(fileInventory.map((entry) => ({
        path: entry.path,
        sha256: sha256Buffer(entry.content),
      })));
      if (await verifyExistingBundledSkillRelease({ db, spaceId, skillId: outpostSkill.id, releaseId: release.id,
        expectedInventoryHash: registryHash, validateInventory: existing => {
          const existingInventory = toSpaceSkillVersion(existing).fileInventory;
          const existingHash = buildInventoryContentHash(existingInventory.map((entry) => ({
            path: entry.path,
            sha256: sha256Buffer(entry.content),
          })));
          if (existingHash !== registryHash) {
            throw new Error(`Bundled skill release ${release.id} does not match its seeded snapshot.`);
          }
        },
      })) continue;
      const releasedAt = new Date(release.releasedAt);
      if (Number.isNaN(releasedAt.getTime())) {
        throw new Error(`Invalid bundled skill release date: ${release.releasedAt}`);
      }
      await createVersion(spaceId, outpostSkill.id, { label: release.releaseName }, null, {
        fileInventory,
        release: { id: release.id, name: release.releaseName, releasedAt },
        updateCurrentVersion: false,
        skipInventoryRefresh: true,
        skill: outpostSkill,
      });
    }
  }

  async function reconcileOutpostSkillFolders(spaceId: string) {
    const shippedSkills = await db
      .select({
        id: spaceSkills.id,
        key: spaceSkills.key,
        folderId: spaceSkills.folderId,
        metadata: sql<Record<string, unknown>>`jsonb_build_object('sourceKind', ${spaceSkills.metadata}->'sourceKind')`,
      })
      .from(spaceSkills)
      .where(eq(spaceSkills.spaceId, spaceId))
      .then((rows) => rows.flatMap((skill) => {
        const category = outpostBundledFolderCategory(skill.key, skill.metadata);
        return category ? [{ ...skill, category }] : [];
      }));
    const foldersByCategory = new Map<string, Awaited<ReturnType<typeof folderSvc.ensureBundledCategory>>>();
    for (const skill of shippedSkills) {
      let folder = foldersByCategory.get(skill.category);
      if (!folder) {
        folder = await folderSvc.ensureBundledCategory(spaceId, bundledFolderLabel(skill.category));
        foldersByCategory.set(skill.category, folder);
      }
      if (skill.folderId === folder.id) continue;
      await db
        .update(spaceSkills)
        .set({ folderId: folder.id, updatedAt: new Date() })
        .where(and(eq(spaceSkills.spaceId, spaceId), eq(spaceSkills.id, skill.id)));
    }
    await folderSvc.pruneEmptyBundledCategories(
      spaceId,
      Array.from(foldersByCategory.keys(), bundledFolderLabel),
    );
  }

  async function reconcileLocalPathSkillSources(spaceId: string, skillId?: string) {
    const rows = await db
      .select({
        id: spaceSkills.id,
        key: spaceSkills.key,
        slug: spaceSkills.slug,
        sourceType: spaceSkills.sourceType,
        sourceLocator: spaceSkills.sourceLocator,
        trustLevel: spaceSkills.trustLevel,
        fileInventory: spaceSkills.fileInventory,
        metadata: spaceSkills.metadata,
      })
      .from(spaceSkills)
      .where(and(eq(spaceSkills.spaceId, spaceId), eq(spaceSkills.sourceType, "local_path"),
        skillId ? eq(spaceSkills.id, skillId) : undefined));
    const skills = rows.map((row) => ({
      ...row,
      sourceType: row.sourceType as SpaceSkillSourceType,
      trustLevel: row.trustLevel as SpaceSkillTrustLevel,
      fileInventory: normalizeFileInventory(row),
      metadata: isPlainRecord(row.metadata) ? row.metadata : null,
    }));
    const missingIds = new Set(await findMissingLocalSkillIds(skills));

    for (const skill of skills) {
      if (skill.sourceType !== "local_path") continue;
      if (asString(skill.metadata?.sourceKind) === "managed_local") continue;
      if (isOutpostBundledSkillKey(skill.key) || asString(skill.metadata?.sourceKind) === "outpost_bundled") continue;

      if (!missingIds.has(skill.id)) {
        const metadata = getMissingSourceMarker(skill.metadata)
          ? withoutMissingSourceMarker(skill.metadata)
          : skill.metadata;
        const sourceLocator = asString(skill.sourceLocator);
        const nextInventory = sourceLocator
          ? await collectLocalSkillInventory(sourceLocator, inferLocalSkillInventoryMode(skill)).catch(() => null)
          : null;
        const nextTrustLevel = nextInventory ? deriveTrustLevel(nextInventory) : skill.trustLevel;
        const inventoryChanged = nextInventory ? !inventoryEntriesEqual(skill.fileInventory, nextInventory) : false;
        const metadataChanged = !stableJsonEqual(metadata ?? {}, skill.metadata ?? {});
        if (inventoryChanged || metadataChanged || nextTrustLevel !== skill.trustLevel) {
          await db
            .update(spaceSkills)
            .set({
              ...(nextInventory ? { fileInventory: serializeFileInventory(nextInventory) } : {}),
              trustLevel: nextTrustLevel,
              metadata,
              updatedAt: new Date(),
            })
            .where(eq(spaceSkills.id, skill.id));
        }
        continue;
      }

      const usedByAgents = await usage(spaceId, skill.key);
      if (usedByAgents.length > 0) {
        const metadata = withMissingSourceMarker(
          skill.metadata,
          buildMissingLocalSourceMarker(skill),
        );
        if (!stableJsonEqual(metadata, skill.metadata ?? {})) {
          await db
            .update(spaceSkills)
            .set({ metadata, updatedAt: new Date() })
            .where(eq(spaceSkills.id, skill.id));
        }
        continue;
      }

      await removeRuntimeSkillCache(resolveManagedSkillsRoot(spaceId), skill.id, async () => {
        await fs.rm(resolveRuntimeSkillMaterializedPath(spaceId, skill), { recursive: true, force: true });
        await db.transaction(async tx => {
          await notifyDeliveryWork(tx, DELIVERY_QUEUES.skillPackages);
          await notifySkillVersionRetention(tx, spaceId);
          await tx.delete(spaceSkills).where(eq(spaceSkills.id, skill.id));
        });
      });
    }
  }

  async function ensureSkillInventoryCurrent(spaceId: string) {
    // Denied reads must not perform the lazy bundled-skill reconciliation.
    if (!visibility().canReadSpace(spaceId)) return;
    const existingRefresh = skillInventoryRefreshPromises.get(spaceId);
    if (existingRefresh) {
      await measureRunPhase("skills.inventory.wait", () => existingRefresh);
      return;
    }

    const refreshPromise = (async () => {
      const spaceExists = await db
        .select({ id: spaces.id })
        .from(spaces)
        .where(eq(spaces.id, spaceId))
        .then((rows) => rows.length > 0);
      if (!spaceExists) {
        throw notFound("Outpost not found");
      }
      const bundledSkills = await measureRunPhase("skills.inventory.bundled", () => ensureBundledSkills(spaceId));
      await measureRunPhase("skills.inventory.releases", () => ensureBundledSkillReleases(spaceId, bundledSkills));
      await measureRunPhase("skills.inventory.folders", () => reconcileOutpostSkillFolders(spaceId));
      await measureRunPhase("skills.inventory.local_sources", () => reconcileLocalPathSkillSources(spaceId));
    })();

    skillInventoryRefreshPromises.set(spaceId, refreshPromise);
    try {
      await refreshPromise;
    } finally {
      if (skillInventoryRefreshPromises.get(spaceId) === refreshPromise) {
        skillInventoryRefreshPromises.delete(spaceId);
      }
    }
  }

  async function list(spaceId: string, query: SpaceSkillListQuery = {}): Promise<SpaceSkillListItem[]> {
    if (!visibility().canReadSpace(spaceId)) return [];
    await ensureSkillInventoryCurrent(spaceId);
    const [dbRows, folderListing] = await Promise.all([db
      .select({
        id: spaceSkills.id,
        spaceId: spaceSkills.spaceId,
        folderId: spaceSkills.folderId,
        key: spaceSkills.key,
        slug: spaceSkills.slug,
        name: spaceSkills.name,
        description: spaceSkills.description,
        sourceType: spaceSkills.sourceType,
        sourceLocator: spaceSkills.sourceLocator,
        sourceRef: spaceSkills.sourceRef,
        trustLevel: spaceSkills.trustLevel,
        compatibility: spaceSkills.compatibility,
        fileInventory: spaceSkills.fileInventory,
        iconUrl: spaceSkills.iconUrl,
        color: spaceSkills.color,
        tagline: spaceSkills.tagline,
        authorName: spaceSkills.authorName,
        homepageUrl: spaceSkills.homepageUrl,
        categories: spaceSkills.categories,
        accessSourceId: spaceSkills.accessSourceId,
        sharingScope: spaceSkills.sharingScope,
        publicShareToken: spaceSkills.publicShareToken,
        forkedFromSkillId: spaceSkills.forkedFromSkillId,
        forkedFromSpaceId: spaceSkills.forkedFromSpaceId,
        starCount: spaceSkills.starCount,
        installCount: spaceSkills.installCount,
        forkCount: spaceSkills.forkCount,
        currentVersionId: spaceSkills.currentVersionId,
        metadata: spaceSkills.metadata,
        createdAt: spaceSkills.createdAt,
        updatedAt: spaceSkills.updatedAt,
      })
      .from(spaceSkills)
      .where(and(eq(spaceSkills.spaceId, spaceId), await visibility().condition(spaceId)))
      .orderBy(asc(spaceSkills.name), asc(spaceSkills.key))
      .then((entries) => entries.map((entry) => toSpaceSkillListRow(entry as SpaceSkillListDbRow))),
      folderSvc.list(spaceId, "skill"),
    ]);
    const folderPaths = new Map(folderListing.folders.map((folder) => [folder.id, folder.path]));
    const rows = dbRows.map((skill) => ({
      ...skill,
      folderPath: skill.folderId ? folderPaths.get(skill.folderId) ?? null : null,
    }));
    let selectedFolderIds: Set<string> | null = null;
    if (query.folderId) {
      await folderSvc.validateSkillFolder(spaceId, query.folderId, { allowBundled: true });
      selectedFolderIds = query.includeSubtree
        ? await folderSvc.descendantIds(spaceId, "skill", query.folderId)
        : new Set([query.folderId]);
    }
    const agentRows = await db.select({
      desiredSkills: sql<unknown>`${agentsTable.adapterConfig}->'outpostSkillSync'->'desiredSkills'`,
    }).from(agentsTable).where(and(eq(agentsTable.spaceId, spaceId), ne(agentsTable.status, "terminated")));
    const attachedAgentCounts = new Map<string, number>();
    for (const agent of agentRows) {
      for (const key of resolveDesiredSkillKeys(rows, { outpostSkillSync: { desiredSkills: agent.desiredSkills } })) {
        attachedAgentCounts.set(key, (attachedAgentCounts.get(key) ?? 0) + 1);
      }
    }
    const q = query.q?.trim().toLowerCase() ?? "";
    const categories = new Set(
      (query.categories ?? [])
        .map(normalizeCategoryName)
        .filter((value): value is string => Boolean(value))
        .map(categoryLookupKey),
    );
    const filtered = rows.filter((skill) => {
      if (query.scope && skill.sharingScope !== query.scope) return false;
      if (!q && selectedFolderIds && (!skill.folderId || !selectedFolderIds.has(skill.folderId))) return false;
      if (categories.size > 0 && !skill.categories.some((category) => categories.has(categoryLookupKey(category)))) return false;
      if (q) {
        const haystack = [
          skill.name,
          skill.slug,
          skill.key,
          skill.description,
          skill.tagline,
          skill.authorName,
          ...skill.categories,
        ].filter(Boolean).join("\n").toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    const items = filtered.map((skill) => toSpaceSkillListItem(skill, attachedAgentCounts.get(skill.key) ?? 0));
    const sort = query.sort ?? "alphabetical";
    items.sort((left, right) => {
      if (sort === "recent") return right.updatedAt.getTime() - left.updatedAt.getTime() || left.name.localeCompare(right.name);
      if (sort === "installs") return right.installCount - left.installCount || left.name.localeCompare(right.name);
      if (sort === "stars") return right.starCount - left.starCount || left.name.localeCompare(right.name);
      if (sort === "agents") return right.attachedAgentCount - left.attachedAgentCount || left.name.localeCompare(right.name);
      if (sort === "forks") return right.forkCount - left.forkCount || left.name.localeCompare(right.name);
      return left.name.localeCompare(right.name) || left.key.localeCompare(right.key);
    });
    if (query.include?.includes("lastEditor")) {
      const lastEditors = await listLastEditorsBySkillId(db, spaceId, items.map((item) => item.id));
      return items.map((item) => ({
        ...item,
        lastEditor: lastEditors.get(item.id) ?? null,
      }));
    }
    return items;
  }

  async function listFull(spaceId: string): Promise<SpaceSkill[]> {
    if (!visibility().canReadSpace(spaceId)) return [];
    await ensureSkillInventoryCurrent(spaceId);
    return readFullSkillRows(spaceId);
  }

  async function readFullSkillRows(spaceId: string, keys?: Set<string>, unrestrictedOnly = false): Promise<SpaceSkill[]> {
    if (!visibility().canReadSpace(spaceId) || keys?.size === 0) return [];
    const rows = await db
      .select(selectSpaceSkillColumns())
      .from(spaceSkills)
      .where(and(eq(spaceSkills.spaceId, spaceId), keys ? inArray(spaceSkills.key, [...keys]) : undefined, unrestrictedOnly ? isNull(spaceSkills.accessSourceId) : await visibility().condition(spaceId)))
      .orderBy(asc(spaceSkills.name), asc(spaceSkills.key));
    return rows.map((row) => toSpaceSkill(row));
  }

  async function categoryCounts(spaceId: string): Promise<SpaceSkillCategoryCount[]> {
    const rows = await listFull(spaceId);
    const counts = new Map<string, number>();
    for (const skill of rows) {
      for (const category of skill.categories) {
        counts.set(category, (counts.get(category) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([slug, count]) => ({ slug, count }))
      .sort((left, right) => right.count - left.count || left.slug.localeCompare(right.slug));
  }

  async function listReferenceTargets(spaceId: string, database: DbOrTransaction = db): Promise<SkillReferenceTarget[]> {
    const rows = await database
      .select({
        id: spaceSkills.id,
        key: spaceSkills.key,
        slug: spaceSkills.slug,
      })
      .from(spaceSkills)
      .where(and(eq(spaceSkills.spaceId, spaceId), await visibility(database).condition(spaceId)));
    return rows as SpaceSkillReferenceRow[];
  }

  async function getById(spaceId: string, id: string, database: DbOrTransaction = db) {
    const row = await database
      .select(selectSpaceSkillColumns())
      .from(spaceSkills)
      .where(and(eq(spaceSkills.spaceId, spaceId), eq(spaceSkills.id, id), await visibility(database).condition(spaceId)))
      .then((rows) => rows[0] ?? null);
    return row ? enrichFolderPath(spaceId, toSpaceSkill(row), database) : null;
  }

  async function getByKey(
    spaceId: string,
    key: string,
    database: DbOrTransaction = db,
    options: { includeFolderPath?: boolean } = {},
  ) {
    const row = await database
      .select(selectSpaceSkillColumns())
      .from(spaceSkills)
      .where(and(eq(spaceSkills.spaceId, spaceId), eq(spaceSkills.key, key), await visibility(database).condition(spaceId)))
      .then((rows) => rows[0] ?? null);
    if (!row) return null;
    const skill = toSpaceSkill(row);
    return options.includeFolderPath === false ? skill : enrichFolderPath(spaceId, skill);
  }

  async function getBySlugIfUnique(spaceId: string, slug: string) {
    const rows = await db
      .select(selectSpaceSkillColumns())
      .from(spaceSkills)
      .where(and(eq(spaceSkills.spaceId, spaceId), eq(spaceSkills.slug, slug), await visibility().condition(spaceId)));
    return rows.length === 1 ? enrichFolderPath(spaceId, toSpaceSkill(rows[0]!)) : null;
  }

  async function enrichFolderPath(spaceId: string, skill: SpaceSkill, database: DbOrTransaction = db): Promise<SpaceSkill> {
    if (!skill.folderId) return { ...skill, folderPath: null };
    const folder = await folderService(database as Db).getFolder(spaceId, skill.folderId);
    return { ...skill, folderPath: folder?.kind === "skill" ? folder.path : null };
  }

  async function getByRouteRef(spaceId: string, ref: string) {
    return (isUuidLike(ref) ? await getById(spaceId, ref) : null)
      ?? await getBySlugIfUnique(spaceId, ref)
      ?? await getByKey(spaceId, ref);
  }

  async function readVersionMetadata(spaceId: string, skillId: string, versionId: string): Promise<StoredSkillVersion | null> {
    if (db === packageDb) return packages.version(spaceId, skillId, versionId);
    const [row] = await db.select(skillVersionMetadataColumns).from(spaceSkillVersions).where(and(
      eq(spaceSkillVersions.spaceId, spaceId), eq(spaceSkillVersions.spaceSkillId, skillId), eq(spaceSkillVersions.id, versionId)));
    return row ?? null;
  }

  async function getVersion(spaceId: string, skillId: string, versionId: string): Promise<SpaceSkillVersion | null> {
    if (!await getById(spaceId, skillId)) return null;
    const row = await readVersionMetadata(spaceId, skillId, versionId);
    return row ? toSpaceSkillVersion({ ...row, fileInventory: await packageReader.versionFiles(row) }) : null;
  }

  async function versionSummary(row: StoredSkillVersion): Promise<SpaceSkillVersionSummary> {
    return { ...toSpaceSkillVersion(row), fileInventory: await packageReader.versionInventory(row) };
  }
  async function getVersionSummary(spaceId: string, skillId: string, versionId: string) {
    if (!await getById(spaceId, skillId)) return null;
    const row = await readVersionMetadata(spaceId, skillId, versionId);
    return row ? versionSummary(row) : null;
  }
  async function getCurrentVersion(skill: SpaceSkill): Promise<SpaceSkillVersionSummary | null> {
    return skill.currentVersionId ? getVersionSummary(skill.spaceId, skill.id, skill.currentVersionId) : null;
  }

  async function isStarredByActor(spaceId: string, skillId: string, actor: SkillActor | null | undefined) {
    if (!actor || actor.type === "system") return false;
    const clause = actor.type === "agent" && actor.agentId
      ? eq(spaceSkillStars.agentId, actor.agentId)
      : actor.type === "user" && actor.userId
        ? eq(spaceSkillStars.userId, actor.userId)
        : null;
    if (!clause) return false;
    const row = await db
      .select({ id: spaceSkillStars.id })
      .from(spaceSkillStars)
      .where(and(
        eq(spaceSkillStars.spaceId, spaceId),
        eq(spaceSkillStars.spaceSkillId, skillId),
        clause,
      ))
      .then((rows) => rows[0] ?? null);
    return Boolean(row);
  }

  async function updateSkillMetadata(
    skill: SpaceSkill,
    metadataPatch: Record<string, unknown>,
  ): Promise<SpaceSkill> {
    const row = await db
      .update(spaceSkills)
      .set({ metadata: sql`coalesce(${spaceSkills.metadata}, '{}'::jsonb) || ${JSON.stringify(metadataPatch)}::jsonb`, updatedAt: new Date() })
      .where(and(eq(spaceSkills.id, skill.id), eq(spaceSkills.spaceId, skill.spaceId),
        skill.currentVersionId ? eq(spaceSkills.currentVersionId, skill.currentVersionId) : isNull(spaceSkills.currentVersionId)))
      .returning()
      .then((rows) => rows[0] ?? null);
    if (!row) throw conflict("Skill changed while its metadata was being prepared. Retry the operation.");
    return toSpaceSkill(row);
  }

  async function persistAuditMetadata(skill: SpaceSkill, audit: SpaceSkillAuditResult): Promise<SpaceSkill> {
    const userModifiedAt = audit.originHash && audit.installedHash !== audit.originHash
      ? asString(getSkillMeta(skill).userModifiedAt) ?? audit.scannedAt
      : null;
    const updateHoldReason: SpaceSkillUpdateHoldReason | null = audit.verdict === "fail"
      ? "audit_hard_stop"
      : userModifiedAt ? "local_modifications" : null;
    return updateSkillMetadata(skill, {
      installedHash: audit.installedHash,
      userModifiedAt,
      updateHoldReason,
      auditVerdict: audit.verdict,
      auditCodes: audit.codes,
      auditScannedAt: audit.scannedAt,
      auditScanVersion: audit.scanVersion,
    });
  }

  async function auditSkillContents(skill: SpaceSkill): Promise<SpaceSkillAuditResult> {
    const spaceId = skill.spaceId;
    if (skill.currentVersionId && (skill.sourceType !== "local_path" || skill.metadata?.skillSourceId || skill.metadata?.sourceKind === "outpost_bundled")) {
      const versionId = skill.currentVersionId;
      return withSkillVersionCacheLock(db, spaceId, async () => {
        const version = await readVersionMetadata(spaceId, skill.id, versionId);
        if (!version) throw unprocessable("Installed skill version is unavailable.");
        const sourceLocator = await materializeVersionSnapshot(spaceId, skill, version);
        return auditInstalledSkillBytes({
          ...skill,
          sourceType: "local_path",
          sourceLocator,
          fileInventory: version.repositorySnapshotId || version.packageSnapshotId
            ? await packageRuntime.inventory(version) : await packages.versionFiles(version),
        });
      });
    }
    if (skill.sourceType !== "catalog" && skill.sourceType !== "local_path") {
      throw unprocessable("Only local-path space skills support audit.");
    }
    return auditInstalledSkillBytes(skill);
  }

  async function auditSkill(spaceId: string, skillId: string): Promise<SpaceSkillAuditResult | null> {
    await ensureSkillInventoryCurrent(spaceId);
    const skill = await getById(spaceId, skillId);
    if (!skill) return null;
    const audit = await auditSkillContents(skill);
    await persistAuditMetadata(skill, audit);
    return audit;
  }

  async function usage(spaceId: string, key: string, database: DbOrTransaction = db): Promise<SpaceSkillUsageAgent[]> {
    const skills = await listReferenceTargets(spaceId, database);
    const agentRows = await agentService(database as Db).list(spaceId);
    const desiredAgents = agentRows.flatMap((agent) => {
      const desiredEntries = resolveDesiredSkillEntries(skills, agent.adapterConfig as Record<string, unknown>);
      const desiredEntry = desiredEntries.find((entry) => entry.key === key);
      return desiredEntry ? [{ agent, desiredEntry }] : [];
    });

    return desiredAgents.map(({ agent, desiredEntry }) => ({
      id: agent.id,
      name: agent.name,
      urlKey: agent.urlKey,
      adapterType: agent.adapterType,
      desired: true,
      // Runtime adapter state is intentionally omitted from this bounded metadata read.
      actualState: null,
      versionId: desiredEntry.versionId ?? null,
    }));
  }

  async function versionCount(spaceId: string, skillId: string) {
    const [{ value }] = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(spaceSkillVersions)
      .where(and(eq(spaceSkillVersions.spaceId, spaceId), eq(spaceSkillVersions.spaceSkillId, skillId)));
    return Number(value ?? 0);
  }

  async function existingForkSummaries(
    spaceId: string,
    sourceSkillId: string,
    actor?: SkillActor | null,
  ): Promise<SpaceSkillForkSummary[]> {
    const rows = await db
      .select(selectSpaceSkillColumns())
      .from(spaceSkills)
      .where(and(eq(spaceSkills.spaceId, spaceId), eq(spaceSkills.forkedFromSkillId, sourceSkillId)))
      .orderBy(desc(spaceSkills.updatedAt), asc(spaceSkills.name));
    const summaries: SpaceSkillForkSummary[] = [];
    for (const row of rows) {
      const skill = toSpaceSkill(row);
      summaries.push(summarizeForkSkill(skill, actor, await versionCount(spaceId, skill.id)));
    }
    return summaries;
  }

  async function detail(spaceId: string, id: string, actor?: SkillActor | null): Promise<SpaceSkillDetail | null> {
    let skill = await getByRouteRef(spaceId, id);
    if (!skill) {
      await ensureSkillInventoryCurrent(spaceId);
      skill = await getByRouteRef(spaceId, id);
    }
    if (!skill) return null;
    if (skill.sourceType === "local_path") {
      await reconcileLocalPathSkillSources(spaceId, skill.id);
      skill = await getById(spaceId, skill.id);
      if (!skill) return null;
    }
    const usedByAgents = await usage(spaceId, skill.key);
    const existingForks = await existingForkSummaries(spaceId, skill.id, actor);
    const currentVersion = await getCurrentVersion(skill);
    const repositoryInventory = currentVersion?.repositorySnapshotId
      ? await packageRuntime.inventory((await readVersionMetadata(spaceId, skill.id, currentVersion.id))!) : null;
    return enrichSkill(
      repositoryInventory ? { ...skill, fileInventory: repositoryInventory.map(({ path, kind }) => ({ path, kind })) } : skill,
      usedByAgents.length,
      usedByAgents,
      currentVersion,
      await isStarredByActor(spaceId, skill.id, actor),
      existingForks,
    );
  }

  async function forkPrecheck(
    spaceId: string,
    skillId: string,
    actor?: SkillActor | null,
  ): Promise<SpaceSkillForkPrecheckResult | null> {
    await ensureSkillInventoryCurrent(spaceId);
    const skill = await getById(spaceId, skillId);
    if (!skill) return null;
    const usedByAgents = await usage(spaceId, skill.key);
    return {
      skillId: skill.id,
      original: summarizeOriginalSkill(skill),
      agentUsageCount: usedByAgents.length,
      usedByAgents,
      existingForks: await existingForkSummaries(spaceId, skill.id, actor),
    };
  }

  async function collectVersionFileInventory(
    spaceId: string,
    skill: SpaceSkill,
  ): Promise<SpaceSkillVersionFileInventoryEntry[]> {
    if (skill.currentVersionId && (skill.sourceType !== "local_path" || skill.metadata?.skillSourceId || skill.metadata?.sourceKind === "outpost_bundled")) {
      const version = await getCurrentVersion(skill);
      if (!version) throw notFound("Skill version not found");
      return runtimeVersionInventory(spaceId, version);
    }
    if (skill.sourceType === "local_path" && skill.sourceLocator) {
      skill = { ...skill, fileInventory: await collectLocalSkillInventory(skill.sourceLocator, inferLocalSkillInventoryMode(skill)) };
    }
    const out: SpaceSkillVersionFileInventoryEntry[] = [];
    for (const entry of skill.fileInventory) {
      const detail = await readLoadedSkillFile(skill, entry.path);
      if (!detail) continue;
      out.push({
        path: detail.path,
        kind: detail.kind,
        content: detail.content,
        ...(detail.encoding ? { encoding: detail.encoding } : {}),
        ...(detail.executable ? { executable: true } : {}),
      });
    }
    return out;
  }

  async function listVersions(spaceId: string, skillId: string): Promise<SpaceSkillVersionSummary[]> {
    const skill = await getById(spaceId, skillId);
    if (!skill) throw notFound("Skill not found");
    const rows = await db
      .select(skillVersionMetadataColumns)
      .from(spaceSkillVersions)
      .where(and(eq(spaceSkillVersions.spaceId, spaceId), eq(spaceSkillVersions.spaceSkillId, skillId)))
      .orderBy(desc(spaceSkillVersions.revisionNumber));
    const result: SpaceSkillVersionSummary[] = [];
    for (const row of rows) result.push(await versionSummary(row));
    return result;
  }

  async function createVersion(
    spaceId: string,
    skillId: string,
    input: SpaceSkillVersionCreateRequest = {},
    actor: SkillActor | null = null,
    options: CreateVersionOptions = {},
  ): Promise<SpaceSkillVersion> {
    if (!options.skipInventoryRefresh) await ensureSkillInventoryCurrent(spaceId);
    const skill = options.skill ?? await getById(spaceId, skillId, options.database);
    if (!skill) throw notFound("Skill not found");
    if (skill.sourceType === "managed" && !options.database && !options.release) {
      const selectedId = input.sourceVersionId ?? skill.currentVersionId;
      if (!selectedId) throw unprocessable("Managed skill has no committed version.");
      const { files } = await managedContent.read(spaceId, skillId, selectedId);
      const inventory = options.fileInventory ?? files;
      const candidate = await managedContent.prepare(spaceId, inventory);
      const markdown = inventory.find(file => file.path === "SKILL.md")!.content;
      const parsed = parseFrontmatterMarkdown(markdown);
      const saved = await managedContent.publish(skill, candidate, {
        markdown, name: asString(parsed.frontmatter.name) ?? skill.name,
        description: asString(parsed.frontmatter.description) ?? skill.description,
        fileInventory: serializeFileInventory(inventory), trustLevel: deriveTrustLevel(inventory),
        ...readSkillStoreMetadata(parsed.frontmatter, skill.metadata),
      }, actor, { ...options.publication, expectedVersionId: input.expectedVersionId, label: input.label,
        validate: async tx => {
          await visibility(tx).assertSkill(spaceId, skillId);
          await options.publication?.validate?.(tx);
        },
      });
      return { ...toSpaceSkillVersion(saved.version), fileInventory: inventory };
    }
    if (input.sourceVersionId) throw unprocessable("Only Outpost-managed skills can restore a saved version.");
    const fileInventory = serializeVersionFileInventory(
      options.fileInventory ?? await collectVersionFileInventory(spaceId, skill),
    );
    const previousVersion = options.fileInventory === undefined && skill.currentVersionId ? await readVersionMetadata(spaceId, skill.id, skill.currentVersionId) : null;
    // Shipped release rows retain their existing validation contract. All user
    // snapshots use the package store; source imports prepare before their transaction.
    let packageFileMap = options.packageFileMap ?? null;
    const preparePackage = async (store: ReturnType<typeof skillPackageStore>) => {
      const id = await store.prepare(spaceId, fileInventory);
      packageFileMap = skillVersionFileMap(fileInventory);
      return id;
    };
    const packageSnapshotId = options.packageSnapshotId ?? (options.release || !skillPackageStorageEnabled() ? null : options.database
      ? await withDedicatedDbConnection(packageDb, connection => preparePackage(skillPackageStore(connection)))
      : await preparePackage(packages));
    if (options.packageSnapshotId) {
      const metadata = new Map(fileInventory.map(file => [file.path, file]));
      packageFileMap = (packageFileMap ?? fileInventory.map(file => ({ path: file.path, kind: file.kind, sourcePath: file.path })))
        .map(file => ({ ...file, encoding: metadata.get(file.path)?.encoding ?? "utf8" }));
    }
    const persist = async (tx: DbOrTransaction) => {
      await notifyDeliveryWork(tx, DELIVERY_QUEUES.skillPackages);
      await notifySkillVersionRetention(tx, spaceId);
      await tx.execute(sql`
        select ${spaceSkills.id}
        from ${spaceSkills}
        where ${spaceSkills.id} = ${skillId}
          and ${spaceSkills.spaceId} = ${spaceId}
        for update
      `);
      // File edits already own the skill lock when a dedicated connection saves
      // their package. Never hold a package lock while waiting for that skill.
      if (packageSnapshotId) {
        const [saved] = await tx.select({ storage: spaceSkillRepositorySnapshots.storage })
          .from(spaceSkillRepositorySnapshots).where(and(eq(spaceSkillRepositorySnapshots.spaceId, spaceId),
            eq(spaceSkillRepositorySnapshots.id, packageSnapshotId))).for("update");
        if (!saved?.storage) throw conflict("Skill package changed during publication; retry the operation.");
      }
      const [{ nextRevision }] = await tx
        .select({
          nextRevision: sql<number>`coalesce(max(${spaceSkillVersions.revisionNumber}), 0) + 1`,
        })
        .from(spaceSkillVersions)
        .where(and(eq(spaceSkillVersions.spaceId, spaceId), eq(spaceSkillVersions.spaceSkillId, skillId)));
      const row = await tx
        .insert(spaceSkillVersions)
        .values({
          spaceId,
          spaceSkillId: skillId,
          repositorySnapshotId: options.repositorySnapshotId ?? previousVersion?.repositorySnapshotId ?? null,
          repositorySkillPath: options.repositorySkillPath ?? previousVersion?.repositorySkillPath ?? null,
          packageSnapshotId,
          migrationAt: packageSnapshotId || options.release ? null : new Date(),
          packageFileMap,
          revisionNumber: Number(nextRevision ?? 1),
          label: input.label?.trim() || null,
          releaseId: options.release?.id ?? null,
          releaseName: options.release?.name ?? null,
          releasedAt: options.release?.releasedAt ?? null,
          fileInventory: packageSnapshotId ? [] : fileInventory,
          authorAgentId: actor?.type === "agent" ? actor.agentId ?? null : null,
          authorUserId: actor?.type === "user" ? actor.userId ?? null : null,
        })
        .returning()
        .then((rows) => rows[0] ?? null);
      if (!row) return null;
      if (options.updateCurrentVersion !== false) {
        await tx
          .update(spaceSkills)
          .set({ currentVersionId: row.id, updatedAt: new Date() })
          .where(and(eq(spaceSkills.id, skillId), eq(spaceSkills.spaceId, spaceId)));
      }
      return row;
    };
    const versionRow = options.database ? await persist(options.database) : await db.transaction(persist);
    if (!versionRow) throw notFound("Failed to persist skill version");
    return toSpaceSkillVersion({ ...versionRow, fileInventory });
  }

  async function refreshStarCount(spaceId: string, skillId: string) {
    const [{ value }] = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(spaceSkillStars)
      .where(and(eq(spaceSkillStars.spaceId, spaceId), eq(spaceSkillStars.spaceSkillId, skillId)));
    const starCount = Number(value ?? 0);
    await db
      .update(spaceSkills)
      .set({ starCount, updatedAt: new Date() })
      .where(and(eq(spaceSkills.id, skillId), eq(spaceSkills.spaceId, spaceId)));
    return starCount;
  }

  function actorStarClause(actor: SkillActor) {
    if (actor.type === "agent" && actor.agentId) return eq(spaceSkillStars.agentId, actor.agentId);
    if (actor.type === "user" && actor.userId) return eq(spaceSkillStars.userId, actor.userId);
    throw unprocessable("Skill stars require an agent or operator user actor.");
  }

  async function starSkill(spaceId: string, skillId: string, actor: SkillActor) {
    const skill = await getById(spaceId, skillId);
    if (!skill) throw notFound("Skill not found");
    const existing = await db
      .select({ id: spaceSkillStars.id })
      .from(spaceSkillStars)
      .where(and(eq(spaceSkillStars.spaceId, spaceId), eq(spaceSkillStars.spaceSkillId, skillId), actorStarClause(actor)))
      .then((rows) => rows[0] ?? null);
    if (!existing) {
      await db.insert(spaceSkillStars).values({
        spaceId,
        spaceSkillId: skillId,
        agentId: actor.type === "agent" ? actor.agentId ?? null : null,
        userId: actor.type === "user" ? actor.userId ?? null : null,
      });
    }
    return { skillId, starred: true, starCount: await refreshStarCount(spaceId, skillId) };
  }

  async function unstarSkill(spaceId: string, skillId: string, actor: SkillActor) {
    const skill = await getById(spaceId, skillId);
    if (!skill) throw notFound("Skill not found");
    await db
      .delete(spaceSkillStars)
      .where(and(eq(spaceSkillStars.spaceId, spaceId), eq(spaceSkillStars.spaceSkillId, skillId), actorStarClause(actor)));
    return { skillId, starred: false, starCount: await refreshStarCount(spaceId, skillId) };
  }

  async function listComments(spaceId: string, skillId: string): Promise<SpaceSkillComment[]> {
    const skill = await getById(spaceId, skillId);
    if (!skill) throw notFound("Skill not found");
    const rows = await db
      .select()
      .from(spaceSkillComments)
      .where(and(
        eq(spaceSkillComments.spaceId, spaceId),
        eq(spaceSkillComments.spaceSkillId, skillId),
        isNull(spaceSkillComments.deletedAt),
      ))
      .orderBy(asc(spaceSkillComments.createdAt));
    return rows.map((row) => toSpaceSkillComment(row));
  }

  async function createComment(
    spaceId: string,
    skillId: string,
    input: SpaceSkillCommentCreateRequest,
    actor: SkillActor,
  ): Promise<SpaceSkillComment> {
    const skill = await getById(spaceId, skillId);
    if (!skill) throw notFound("Skill not found");
    if (input.parentCommentId) {
      const parent = await db
        .select({ id: spaceSkillComments.id })
        .from(spaceSkillComments)
        .where(and(
          eq(spaceSkillComments.spaceId, spaceId),
          eq(spaceSkillComments.spaceSkillId, skillId),
          eq(spaceSkillComments.id, input.parentCommentId),
          isNull(spaceSkillComments.deletedAt),
        ))
        .then((rows) => rows[0] ?? null);
      if (!parent) throw notFound("Parent comment not found");
    }
    const row = await db
      .insert(spaceSkillComments)
      .values({
        spaceId,
        spaceSkillId: skillId,
        parentCommentId: input.parentCommentId ?? null,
        authorAgentId: actor.type === "agent" ? actor.agentId ?? null : null,
        authorUserId: actor.type === "user" ? actor.userId ?? null : null,
        body: input.body,
      })
      .returning()
      .then((rows) => rows[0] ?? null);
    if (!row) throw notFound("Failed to persist skill comment");
    return toSpaceSkillComment(row);
  }

  function assertCanMutateComment(comment: SpaceSkillComment, actor: SkillActor) {
    if (actor.type === "user") return;
    if (actor.type === "agent" && actor.agentId && comment.authorAgentId === actor.agentId) return;
    throw unprocessable("Only the comment author or an operator user can modify this skill comment.");
  }

  async function updateComment(
    spaceId: string,
    skillId: string,
    commentId: string,
    input: SpaceSkillCommentUpdateRequest,
    actor: SkillActor,
  ): Promise<SpaceSkillComment> {
    const existing = await db
      .select()
      .from(spaceSkillComments)
      .where(and(
        eq(spaceSkillComments.spaceId, spaceId),
        eq(spaceSkillComments.spaceSkillId, skillId),
        eq(spaceSkillComments.id, commentId),
        isNull(spaceSkillComments.deletedAt),
      ))
      .then((rows) => rows[0] ?? null);
    if (!existing) throw notFound("Skill comment not found");
    const comment = toSpaceSkillComment(existing);
    assertCanMutateComment(comment, actor);
    const row = await db
      .update(spaceSkillComments)
      .set({ body: input.body, updatedAt: new Date() })
      .where(and(
        eq(spaceSkillComments.spaceId, spaceId),
        eq(spaceSkillComments.spaceSkillId, skillId),
        eq(spaceSkillComments.id, commentId),
        isNull(spaceSkillComments.deletedAt),
      ))
      .returning()
      .then((rows) => rows[0] ?? null);
    if (!row) throw notFound("Skill comment not found");
    return toSpaceSkillComment(row);
  }

  async function deleteComment(
    spaceId: string,
    skillId: string,
    commentId: string,
    actor: SkillActor,
  ): Promise<SpaceSkillComment> {
    const existing = await db
      .select()
      .from(spaceSkillComments)
      .where(and(
        eq(spaceSkillComments.spaceId, spaceId),
        eq(spaceSkillComments.spaceSkillId, skillId),
        eq(spaceSkillComments.id, commentId),
        isNull(spaceSkillComments.deletedAt),
      ))
      .then((rows) => rows[0] ?? null);
    if (!existing) throw notFound("Skill comment not found");
    const comment = toSpaceSkillComment(existing);
    assertCanMutateComment(comment, actor);
    const row = await db
      .update(spaceSkillComments)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(spaceSkillComments.spaceId, spaceId),
        eq(spaceSkillComments.spaceSkillId, skillId),
        eq(spaceSkillComments.id, commentId),
        isNull(spaceSkillComments.deletedAt),
      ))
      .returning()
      .then((rows) => rows[0] ?? null);
    if (!row) throw notFound("Skill comment not found");
    return toSpaceSkillComment(row);
  }

  async function planSkillReassignments(
    spaceId: string,
    source: SpaceSkill,
    forkKey: string,
    reassignAgentIds: string[] | undefined,
  ): Promise<PlannedSkillReassignment[]> {
    const requestedAgentIds = Array.from(new Set(reassignAgentIds ?? []));
    if (requestedAgentIds.length === 0) return [];

    const skills = await listReferenceTargets(spaceId);
    const agentRows = await agents.list(spaceId, { includeTerminated: true });
    const byId = new Map(agentRows.map((agent) => [agent.id, agent]));
    const missingAgentIds = requestedAgentIds.filter((agentId) => !byId.has(agentId));
    if (missingAgentIds.length > 0) {
      throw notFound(`Agent not found for skill reassignment: ${missingAgentIds.join(", ")}`);
    }

    return requestedAgentIds.map((agentId) => {
      const agent = byId.get(agentId)!;
      if (agent.spaceId !== spaceId) {
        throw unprocessable("Cannot reassign a skill for an agent in another space.", { agentId });
      }
      const adapterConfig = agent.adapterConfig as Record<string, unknown>;
      const desiredEntries = resolveDesiredSkillEntries(skills, adapterConfig);
      const hasSource = desiredEntries.some((entry) => entry.key === source.key);
      if (!hasSource) {
        throw unprocessable(`Agent "${agent.name}" does not currently use skill "${source.name}".`, {
          agentId,
          skillId: source.id,
          skillKey: source.key,
        });
      }
      return {
        agentId,
        reassignment: {
          agentId,
          previousSkillKey: source.key,
          nextSkillKey: forkKey,
        },
      };
    });
  }

  async function applySkillReassignments(
    spaceId: string,
    source: SpaceSkill,
    forkKey: string,
    planned: PlannedSkillReassignment[],
    database: Db = db,
  ): Promise<SpaceSkillForkReassignment[]> {
    if (planned.length === 0) return [];
    const skills = await listReferenceTargets(spaceId, database);
    await database.transaction(async (tx) => {
      for (const item of [...planned].sort((a, b) => a.agentId.localeCompare(b.agentId))) {
        const row = await tx
          .select({
            id: agentsTable.id,
            name: agentsTable.name,
            adapterConfig: agentsTable.adapterConfig,
          })
          .from(agentsTable)
          .where(and(eq(agentsTable.spaceId, spaceId), eq(agentsTable.id, item.agentId)))
          .for("update")
          .then((rows) => rows[0] ?? null);
        if (!row) throw notFound(`Agent not found for skill reassignment: ${item.agentId}`);
        const adapterConfig = row.adapterConfig as Record<string, unknown>;
        const desiredEntries = resolveDesiredSkillEntries(skills, adapterConfig);
        const hasSource = desiredEntries.some((entry) => entry.key === source.key);
        if (!hasSource) {
          throw unprocessable(`Agent "${row.name}" does not currently use skill "${source.name}".`, {
            agentId: item.agentId,
            skillId: source.id,
            skillKey: source.key,
          });
        }
        const nextEntries = desiredEntries.map((entry) =>
          entry.key === source.key
            ? { key: forkKey, versionId: null }
            : entry
        );
        const updated = await updateAgentConfigurationInTransaction(tx as unknown as Db, item.agentId, {
          adapterConfig: writeOutpostSkillSyncPreference(adapterConfig, nextEntries),
        }, { allowPendingApprovalConfigUpdate: true });
        if (!updated) throw notFound(`Agent not found for skill reassignment: ${item.agentId}`);
      }
    });
    return planned.map((item) => item.reassignment);
  }

  async function forkSkill(
    spaceId: string,
    skillId: string,
    input: SpaceSkillForkRequest = {},
    actor: SkillActor | null = null,
    publication: SkillContentPublication = {},
  ): Promise<SpaceSkillForkResult> {
    await ensureSkillInventoryCurrent(spaceId);
    const source = await getById(spaceId, skillId);
    if (!source) throw notFound("Skill not found");
    if (source.accessSourceId && input.sharingScope === "public_link") throw forbidden("Project skills cannot be published through a public link.");
    const existing = await db.select({ slug: spaceSkills.slug }).from(spaceSkills)
      .where(eq(spaceSkills.spaceId, spaceId));
    const usedSlugs = new Set(existing.map((skill) => normalizeSkillSlug(skill.slug) ?? skill.slug));
    const forkSlug = uniqueSkillSlug(normalizeSkillSlug(input.slug ?? `${source.slug}-fork`) ?? `${source.slug}-fork`, usedSlugs);
    const forkName = input.name?.trim() || `${source.name} Fork`;
    const forkKey = `space/${spaceId}/${forkSlug}`;
    const plannedReassignments = await planSkillReassignments(spaceId, source, forkKey, input.reassignAgentIds);
    let reassignments: SpaceSkillForkReassignment[] = [];
    const forked = await createLocalSkill(spaceId, {
      name: forkName, slug: forkSlug, forkedFromSkillId: source.id, sharingScope: input.sharingScope ?? "space",
    }, actor, { ...publication, afterPublish: async (tx, row, version) => {
      reassignments = await applySkillReassignments(spaceId, source, forkKey, plannedReassignments, tx as unknown as Db);
      await publication.afterPublish?.(tx, row, version);
    } });
    return { skill: forked, original: summarizeOriginalSkill(source), reassignments };
  }

  async function renameSkill(
    spaceId: string,
    skillId: string,
    input: SpaceSkillRenameRequest,
    publication: SkillContentPublication = {},
  ): Promise<SpaceSkillRenameResult> {
    await ensureSkillInventoryCurrent(spaceId);
    const base = await getById(spaceId, skillId);
    if (!base) throw notFound("Skill not found");
    if (base.sourceType === "managed") {
      if (!base.currentVersionId) throw unprocessable("Managed skill has no committed version.");
      const newName = input.name.trim();
      const newSlug = normalizeSkillSlug(input.slug ?? null) ?? normalizeSkillSlug(newName);
      if (!newName || !newSlug) throw unprocessable("Skill name must contain at least one letter or number.");
      const newKey = `space/${spaceId}/${newSlug}`;
      const { files } = await managedContent.read(spaceId, skillId, base.currentVersionId);
      const markdown = rewriteFrontmatterName(files.find(file => file.path === "SKILL.md")!.content, newName);
      const candidate = await managedContent.prepare(spaceId,
        files.map(file => file.path === "SKILL.md" ? { ...file, content: markdown } : file));
      const references = await listReferenceTargets(spaceId);
      const reassignments: SpaceSkillForkReassignment[] = [];
      const saved = await managedContent.publish(base, candidate, {
        name: newName, slug: newSlug, key: newKey, markdown,
      }, null, { ...publication, expectedVersionId: input.expectedVersionId, reuseCurrentVersion: true,
        validate: async tx => {
          await visibility(tx).assertSkill(spaceId, skillId);
          await publication.validate?.(tx);
          const [collision] = await tx.select({ id: spaceSkills.id, slug: spaceSkills.slug }).from(spaceSkills).where(and(
            eq(spaceSkills.spaceId, spaceId), or(eq(spaceSkills.slug, newSlug), eq(spaceSkills.key, newKey)), ne(spaceSkills.id, skillId)));
          if (collision) throw conflict(`A space skill with slug "${newSlug}" already exists.`,
            collision.slug === newSlug ? { conflict: "slug", slug: newSlug } : { conflict: "key", key: newKey });
        },
        afterPublish: async (tx, row, version) => {
          const rows = await tx.select({ id: agentsTable.id, adapterConfig: agentsTable.adapterConfig }).from(agentsTable)
            .where(eq(agentsTable.spaceId, spaceId)).orderBy(asc(agentsTable.id)).for("update");
          for (const row of rows) {
            const config = row.adapterConfig as Record<string, unknown>;
            const entries = resolveDesiredSkillEntries(references, config);
            if (!entries.some(entry => entry.key === base.key)) continue;
            const next = entries.map(entry => entry.key === base.key ? { ...entry, key: newKey } : entry);
            await updateAgentConfigurationInTransaction(tx as unknown as Db, row.id, {
              adapterConfig: writeOutpostSkillSyncPreference(config, next),
            }, { allowPendingApprovalConfigUpdate: true });
            reassignments.push({ agentId: row.id, previousSkillKey: base.key, nextSkillKey: newKey });
          }
          await publication.afterPublish?.(tx, row, version);
        },
      });
      return { skill: toSpaceSkill(saved.skill), previousName: base.name, previousSlug: base.slug, previousKey: base.key, reassignments };
    }
    const managedRoot = resolveManagedSkillsRoot(spaceId);
    let result: SpaceSkillRenameResult | undefined;
    let restoreSource: (() => Promise<void>) | undefined;
    // Cache lifecycle locks always precede name locks, as in deletion.
    await removeRuntimeSkillCache(managedRoot, skillId, async () => {
      try {
        result = await withSkillFileMutation(spaceId, skillId, async (skill, tx) => {
          if (!isOutpostManagedRenameTarget(skill)) {
            throw unprocessable(
              "Only Outpost-managed skills can be renamed. Catalog, external, project-scanned, and unmanaged local skills are read-only.",
              { skillId: skill.id, sourceType: skill.sourceType, sourceKind: getSkillMeta(skill).sourceKind ?? null },
            );
          }

          const newName = input.name.trim();
          if (!newName) throw unprocessable("Skill name is required.");
          const newSlug = normalizeSkillSlug(input.slug ?? null) ?? normalizeSkillSlug(newName);
          if (!newSlug) {
            throw unprocessable("Skill name must contain at least one letter or number to derive a slug.");
          }
          const newKey = `space/${spaceId}/${newSlug}`;

          const previousName = skill.name;
          const previousSlug = skill.slug;
          const previousKey = skill.key;

          // Normalized no-op: nothing changes, so skip all filesystem/DB work.
          if (newName === previousName && newSlug === previousSlug && newKey === previousKey) {
            return { skill, previousName, previousSlug, previousKey, reassignments: [] };
          }

          // Authoritative conflict detection against slug and key within the space.
          if (newSlug !== previousSlug || newKey !== previousKey) {
            const existing = await listFull(spaceId);
            for (const other of existing) {
              if (other.id === skill.id) continue;
              if ((normalizeSkillSlug(other.slug) ?? other.slug) === newSlug) {
                throw conflict(`A space skill with slug "${newSlug}" already exists.`, {
                  conflict: "slug",
                  slug: newSlug,
                });
              }
              if (other.key === newKey) {
                throw conflict(`A space skill with key "${newKey}" already exists.`, {
                  conflict: "key",
                  key: newKey,
                });
              }
            }
          }

          const oldDir = normalizeSkillDirectory(skill)!;
          const newDir = path.resolve(managedRoot, newSlug);
          const directoryMoved = newDir !== oldDir;

          if (directoryMoved && (await statPath(newDir))) {
            throw conflict(`A managed skill directory already exists at ${newDir}.`, { conflict: "directory" });
          }

          // Plan agent reassignments from the old key to the new key, preserving each
          // pinned versionId. Resolve against the pre-rename reference targets so the
          // old key still maps cleanly.
          const referenceSkills = await listReferenceTargets(spaceId);
          const agentRows = await agents.list(spaceId, { includeTerminated: true });
          const plannedReassignments: SpaceSkillForkReassignment[] = agentRows
            .filter((agent) =>
              resolveDesiredSkillEntries(referenceSkills, agent.adapterConfig as Record<string, unknown>)
                .some((entry) => entry.key === previousKey))
            .map((agent) => ({ agentId: agent.id, previousSkillKey: previousKey, nextSkillKey: newKey }));

          // Reversible filesystem stage: capture the original SKILL.md so a failed DB
          // transaction can be rolled back to the pre-rename on-disk state.
          const originalMarkdown = await fs.readFile(path.join(oldDir, "SKILL.md"), "utf8").catch(() => null);
          const rewrittenMarkdown = rewriteFrontmatterName(originalMarkdown ?? skill.markdown, newName);
          let movedDir = false;
          restoreSource = async () => {
            if (originalMarkdown !== null) {
              await fs.writeFile(path.join(movedDir ? newDir : oldDir, "SKILL.md"), originalMarkdown, "utf8").catch(() => {});
            }
            if (movedDir) await fs.rename(newDir, oldDir).catch(() => {});
            restoreSource = undefined;
          };
          try {
            if (directoryMoved) {
              await fs.mkdir(path.dirname(newDir), { recursive: true });
              await fs.rename(oldDir, newDir);
              movedDir = true;
            }
            if (originalMarkdown !== null) {
              if (rewrittenMarkdown !== originalMarkdown) {
                await fs.writeFile(path.join(newDir, "SKILL.md"), rewrittenMarkdown, "utf8");
              }
            }

            const updated = await tx
              .update(spaceSkills)
              .set({
                name: newName,
                slug: newSlug,
                key: newKey,
                sourceLocator: newDir,
                markdown: rewrittenMarkdown,
                updatedAt: new Date(),
              })
              .where(and(eq(spaceSkills.id, skill.id), eq(spaceSkills.spaceId, spaceId)))
              .returning({ id: spaceSkills.id })
              .then((rows) => rows[0] ?? null);
            if (!updated) throw notFound("Skill not found");

            for (const item of plannedReassignments) {
              const row = await tx
                .select({ id: agentsTable.id, adapterConfig: agentsTable.adapterConfig })
                .from(agentsTable)
                .where(and(eq(agentsTable.spaceId, spaceId), eq(agentsTable.id, item.agentId)))
                .for("update")
                .then((rows) => rows[0] ?? null);
              if (!row) continue;
              const adapterConfig = row.adapterConfig as Record<string, unknown>;
              const nextEntries = resolveDesiredSkillEntries(referenceSkills, adapterConfig).map((entry) =>
                entry.key === previousKey
                  ? { key: newKey, versionId: entry.versionId ?? null }
                  : entry);
              await updateAgentConfigurationInTransaction(tx as unknown as Db, item.agentId, {
                adapterConfig: writeOutpostSkillSyncPreference(adapterConfig, nextEntries),
              }, { allowPendingApprovalConfigUpdate: true });
            }
          } catch (error) {
            // Restore while the name locks are still held.
            await restoreSource?.();
            throw error;
          }

          const renamed = await getById(spaceId, skill.id, tx);
          if (!renamed) throw notFound("Renamed skill not found");
          return { skill: renamed, previousName, previousSlug, previousKey, reassignments: plannedReassignments };
        }, [normalizeSkillSlug(input.slug ?? null) ?? normalizeSkillSlug(input.name) ?? ""]);
      } catch (error) {
        await restoreSource?.();
        throw error;
      }
      restoreSource = undefined;
      // Database commit is complete; do not report cache cleanup as a failed rename.
      if (result) {
        await fs.rm(path.resolve(managedRoot, "__runtime__", buildSkillRuntimeName(result.previousKey, result.previousSlug)),
          { recursive: true, force: true }).catch((error) => {
          logger.warn({ err: error, spaceId, skillId }, "Skill renamed; obsolete runtime cache cleanup failed");
        });
      }
    });
    return result!;
  }

  async function updateStatus(spaceId: string, skillId: string): Promise<SpaceSkillUpdateStatus | null> {
    await ensureSkillInventoryCurrent(spaceId);
    const skill = await getById(spaceId, skillId);
    if (!skill) return null;
    const audit = skill.sourceType === "catalog" || skill.sourceType === "local_path"
      ? await auditInstalledSkillBytes(skill)
      : null;
    const metadata = getSkillMeta(skill);
    const statusMeta = {
      installedHash: audit?.installedHash ?? asString(metadata.installedHash),
      originHash: audit?.originHash ?? asString(metadata.originHash),
      userModifiedAt: audit && audit.originHash && audit.installedHash !== audit.originHash
        ? asString(metadata.userModifiedAt) ?? audit.scannedAt
        : audit && audit.originHash
          ? null
        : asString(metadata.userModifiedAt),
      updateHoldReason: (audit?.verdict === "fail"
        ? "audit_hard_stop"
        : audit && audit.originHash && audit.installedHash !== audit.originHash
          ? "local_modifications"
          : audit && audit.originHash
            ? null
          : asString(metadata.updateHoldReason)) as SpaceSkillUpdateHoldReason | null,
      auditVerdict: audit?.verdict ?? (asString(metadata.auditVerdict) as SpaceSkillAuditVerdict | null),
      auditCodes: audit?.codes ?? (Array.isArray(metadata.auditCodes) ? metadata.auditCodes.map(String) : []),
    };

    if (skill.sourceType === "catalog") {
      return {
        supported: false,
        reason: "The public skill catalog has been retired. Re-import this skill from a local path or GitHub source.",
        trackingRef: null,
        currentRef: skill.sourceRef ?? statusMeta.originHash,
        latestRef: null,
        hasUpdate: false,
        ...statusMeta,
      };
    }

    if (skill.sourceType !== "github" && skill.sourceType !== "skills_sh") {
      return {
        supported: false,
        reason: "Only GitHub-managed skills support update checks.",
        trackingRef: null,
        currentRef: skill.sourceRef ?? null,
        latestRef: null,
        hasUpdate: false,
        ...statusMeta,
      };
    }

    const owner = asString(metadata.owner);
    const repo = asString(metadata.repo);
    const trackingRef = asString(metadata.trackingRef) ?? asString(metadata.ref);
    if (!owner || !repo || !trackingRef) {
      return {
        supported: false,
        reason: "This GitHub skill does not have enough metadata to track updates.",
        trackingRef: trackingRef ?? null,
        currentRef: skill.sourceRef ?? null,
        latestRef: null,
        hasUpdate: false,
        ...statusMeta,
      };
    }

    const hostname = asString(metadata.hostname) || "github.com";
    const apiBase = gitHubApiBase(hostname);
    const latestRef = await resolveGitHubCommitSha(owner, repo, trackingRef, apiBase);
    return {
      supported: true,
      reason: null,
      trackingRef,
      currentRef: skill.sourceRef ?? null,
      latestRef,
      hasUpdate: latestRef !== (skill.sourceRef ?? null),
      ...statusMeta,
    };
  }

  async function readFile(spaceId: string, skillId: string, relativePath: string): Promise<SpaceSkillFileDetail | null> {
    await ensureSkillInventoryCurrent(spaceId);
    const skill = await getById(spaceId, skillId);
    if (!skill) return null;

    return readLoadedSkillFile(skill, relativePath);
  }

  async function readLoadedSkillFile(skill: SpaceSkill, relativePath: string): Promise<SpaceSkillFileDetail> {
    const normalizedPath = normalizePortablePath(relativePath || "SKILL.md");
    if (skill.currentVersionId && (skill.sourceType !== "local_path" || skill.metadata?.skillSourceId || skill.metadata?.sourceKind === "outpost_bundled")) {
      const version = await readVersionMetadata(skill.spaceId, skill.id, skill.currentVersionId);
      let file: SpaceSkillVersionFileInventoryEntry | undefined;
      if (version) {
        file = await packageReader.readVersionFile(version, normalizedPath);
        if (!file && version.repositorySnapshotId && version.repositorySkillPath) {
          file = (await runtimeVersionInventory(skill.spaceId, toSpaceSkillVersion(version))).find(file => file.path === normalizedPath);
        }
      }
      if (!file) throw notFound("Installed skill snapshot is missing a file.");
      return { ...file, skillId: skill.id, versionId: skill.currentVersionId,
        language: file.encoding === "base64" ? null : inferLanguageFromPath(normalizedPath),
        markdown: file.encoding !== "base64" && isMarkdownPath(normalizedPath),
        editable: deriveSkillSourceInfo(skill).editable && file.encoding !== "base64" };
    }
    if (skill.sourceType === "managed") throw unprocessable("Managed skill has no committed version.");
    const fileEntry = skill.fileInventory.find((entry) => entry.path === normalizedPath);
    if (!fileEntry) throw notFound("Skill file not found");
    const source = deriveSkillSourceInfo(skill);
    let content = "";

    if (skill.sourceType === "local_path" || skill.sourceType === "catalog") {
      const absolutePath = resolveLocalSkillFilePath(skill, normalizedPath);
      const diskBytes = absolutePath ? await fs.readFile(absolutePath).catch(() => null) : null;
      if (diskBytes !== null) {
        const file = snapshotFile(normalizedPath, fileEntry.kind, diskBytes, Boolean((await fs.stat(absolutePath!)).mode & 0o111));
        return { ...file, skillId: skill.id, versionId: skill.currentVersionId, language: file.encoding === "base64" ? null : inferLanguageFromPath(normalizedPath),
          markdown: file.encoding !== "base64" && isMarkdownPath(normalizedPath), editable: source.editable && file.encoding !== "base64" };
      } else if (normalizedPath === "SKILL.md") {
        content = skill.markdown;
      } else {
        throw notFound("Skill file is unavailable: the skill source directory is missing.");
      }
    } else if (skill.sourceType === "github" || skill.sourceType === "skills_sh") {
      const metadata = getSkillMeta(skill);
      const owner = asString(metadata.owner);
      const repo = asString(metadata.repo);
      const hostname = asString(metadata.hostname) || "github.com";
      const ref = skill.sourceRef ?? asString(metadata.ref) ?? "main";
      const rawRepoSkillDir = typeof metadata.repoSkillDir === "string" ? metadata.repoSkillDir.trim() : null;
      // An explicit "."/"" repoSkillDir means SKILL.md lives at the repo root;
      // only fall back to the slug subdirectory when metadata is absent.
      const repoSkillDir = typeof metadata.repoSkillDir === "string"
        ? normalizeGitHubSkillDirectory(rawRepoSkillDir, "")
        : normalizeGitHubSkillDirectory(rawRepoSkillDir, skill.slug);
      if (!owner || !repo) {
        throw unprocessable("Skill source metadata is incomplete.");
      }
      const repoPath = normalizePortablePath(path.posix.join(repoSkillDir, normalizedPath));
      try {
        content = await fetchText(resolveRawGitHubUrl(hostname, owner, repo, ref, repoPath));
      } catch (error) {
        if (normalizedPath === "SKILL.md" && skill.markdown) {
          content = skill.markdown;
        } else {
          throw error;
        }
      }
    } else if (skill.sourceType === "url") {
      if (normalizedPath !== "SKILL.md") {
        throw notFound("This skill source only exposes SKILL.md");
      }
      content = skill.markdown;
    } else {
      throw unprocessable("Unsupported skill source.");
    }

    return {
      skillId: skill.id,
      versionId: skill.currentVersionId,
      path: normalizedPath,
      kind: fileEntry.kind,
      content,
      language: inferLanguageFromPath(normalizedPath),
      markdown: isMarkdownPath(normalizedPath),
      editable: source.editable,
    };
  }

  async function updateSkill(
    spaceId: string,
    skillId: string,
    input: SpaceSkillUpdateRequest = {},
  ): Promise<SpaceSkill> {
    await ensureSkillInventoryCurrent(spaceId);
    const skill = await getById(spaceId, skillId);
    if (!skill) throw notFound("Skill not found");

    if (skill.accessSourceId && input.sharingScope === "public_link") throw forbidden("Project skills cannot be published through a public link.");
    const sharingScope = Object.prototype.hasOwnProperty.call(input, "sharingScope")
      ? normalizeMutableSharingScope(input.sharingScope)
      : null;
    const values: Partial<typeof spaceSkills.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (Object.prototype.hasOwnProperty.call(input, "description")) {
      values.description = normalizeStoreText(input.description, 2000);
    }
    if (Object.prototype.hasOwnProperty.call(input, "iconUrl")) {
      values.iconUrl = normalizeStoreText(input.iconUrl, 2000);
    }
    if (Object.prototype.hasOwnProperty.call(input, "color")) {
      values.color = normalizeStoreText(input.color, 64);
    }
    if (Object.prototype.hasOwnProperty.call(input, "tagline")) {
      values.tagline = normalizeStoreText(input.tagline, 120);
    }
    if (Object.prototype.hasOwnProperty.call(input, "authorName")) {
      values.authorName = normalizeStoreText(input.authorName, 200);
    }
    if (Object.prototype.hasOwnProperty.call(input, "homepageUrl")) {
      values.homepageUrl = normalizeStoreText(input.homepageUrl, 2000);
    }
    if (Object.prototype.hasOwnProperty.call(input, "categories")) {
      values.categories = normalizeCategoryList(input.categories);
    }
    if (sharingScope) {
      values.sharingScope = sharingScope;
      values.publicShareToken = null;
    }

    const row = await db
      .update(spaceSkills)
      .set(values)
      .where(and(eq(spaceSkills.id, skillId), eq(spaceSkills.spaceId, spaceId)))
      .returning()
      .then((rows) => rows[0] ?? null);
    if (!row) throw notFound("Skill not found");
    return toSpaceSkill(row);
  }

  async function createLocalSkill(
    spaceId: string,
    input: SpaceSkillCreateRequest,
    actor: SkillActor | null = null,
    publication: SkillContentPublication = {},
  ): Promise<SpaceSkill> {
    if (input.folderId) await folderSvc.validateSkillFolder(spaceId, input.folderId);
    const slug = normalizeSkillSlug(input.slug ?? input.name) ?? "skill";
    const key = `space/${spaceId}/${slug}`;
    const forkSource = input.forkedFromSkillId ? await getById(spaceId, input.forkedFromSkillId) : null;
    if (input.forkedFromSkillId && !forkSource) throw notFound("Fork source skill not found");
    if (forkSource?.accessSourceId && input.sharingScope === "public_link") {
      throw forbidden("Project skills cannot be published through a public link.");
    }
    const files = forkSource ? await collectVersionFileInventory(spaceId, forkSource) : [];
    const fallbackMarkdown = ["---", stringifyFrontmatter({ name: input.name,
      ...(input.description?.trim() ? { description: input.description.trim() } : {}) }),
      "---", "", `# ${input.name}`, "", input.description?.trim() || "Describe what this skill does.", ""].join("\n");
    const markdown = input.markdown?.trim().length ? input.markdown
      : files.find(file => file.path === "SKILL.md")?.content ?? fallbackMarkdown;
    const inventory = [...files.filter(file => file.path !== "SKILL.md"),
      { path: "SKILL.md", kind: "skill" as const, content: markdown }];
    const candidate = await managedContent.prepare(spaceId, inventory);
    const parsed = parseFrontmatterMarkdown(markdown);
    const store = readSkillStoreMetadata(parsed.frontmatter, forkSource?.metadata ?? null);
    const values: typeof spaceSkills.$inferInsert = {
      spaceId, key, slug, name: asString(parsed.frontmatter.name) ?? input.name,
      description: asString(parsed.frontmatter.description) ?? input.description?.trim() ?? forkSource?.description ?? null,
      markdown, sourceType: "managed", sourceLocator: null, sourceRef: null,
      trustLevel: deriveTrustLevel(inventory), compatibility: forkSource?.compatibility ?? "compatible",
      fileInventory: serializeFileInventory(inventory),
      iconUrl: normalizeStoreText(input.iconUrl, 2000) ?? forkSource?.iconUrl ?? store.iconUrl,
      color: normalizeStoreText(input.color, 64) ?? forkSource?.color ?? store.color,
      tagline: normalizeStoreText(input.tagline, 120) ?? forkSource?.tagline ?? store.tagline,
      authorName: normalizeStoreText(input.authorName, 200) ?? forkSource?.authorName ?? store.authorName,
      homepageUrl: normalizeStoreText(input.homepageUrl, 2000) ?? forkSource?.homepageUrl ?? store.homepageUrl,
      categories: input.categories ? normalizeCategoryList(input.categories) : forkSource?.categories ?? store.categories,
      folderId: input.folderId ?? null, sharingScope: normalizeMutableSharingScope(input.sharingScope) ?? "space",
      forkedFromSkillId: forkSource?.id ?? null, forkedFromSpaceId: forkSource?.spaceId ?? null,
      metadata: { sourceKind: "managed", ...(forkSource ? {
        forkedFromSkillId: forkSource.id, forkedFromSpaceId: forkSource.spaceId,
        forkedByAgentId: actor?.type === "agent" ? actor.agentId ?? null : null,
        forkedByUserId: actor?.type === "user" ? actor.userId ?? null : null,
      } : {}) },
    };
    const result = await managedContent.create(values, candidate, actor, {
      ...publication, label: publication.label ?? "Initial version",
      validate: async tx => {
        await publication.validate?.(tx);
        if (input.folderId) await folderService(tx as unknown as Db).validateSkillFolder(spaceId, input.folderId);
        if (forkSource) {
          await visibility(tx).assertSkill(spaceId, forkSource.id);
          const [currentSource] = await tx.select({ accessSourceId: spaceSkills.accessSourceId }).from(spaceSkills)
            .where(and(eq(spaceSkills.spaceId, spaceId), eq(spaceSkills.id, forkSource.id))).for("update");
          if (!currentSource || currentSource.accessSourceId !== (forkSource.accessSourceId ?? null)) {
            throw conflict("Fork source access changed. Reload before retrying.");
          }
          values.accessSourceId = await retainProjectSkillAccess(tx as unknown as Db, spaceId, currentSource.accessSourceId);
        }
      },
      afterPublish: async (tx, skill, version) => {
        if (forkSource) await tx.update(spaceSkills).set({
          forkCount: sql`${spaceSkills.forkCount} + 1`, installCount: sql`${spaceSkills.installCount} + 1`,
        }).where(and(eq(spaceSkills.id, forkSource.id), eq(spaceSkills.spaceId, spaceId)));
        await publication.afterPublish?.(tx, skill, version);
      },
    });
    return toSpaceSkill(result.skill);
  }

  async function withSkillFileMutation<T>(
    spaceId: string,
    skillId: string,
    mutate: (skill: SpaceSkill, tx: DbOrTransaction) => Promise<T>,
    additionalSlugs: string[] = [],
  ): Promise<T> {
    await ensureSkillInventoryCurrent(spaceId);
    const initial = await getById(spaceId, skillId);
    if (!initial) throw notFound("Skill not found");
    return db.transaction(async (tx) => {
      // Share the creation/deletion name lock. The identity must be checked
      // again after waiting: a new skill can now own the same source folder.
      for (const slug of [...new Set([initial.slug, ...additionalSlugs])].filter(Boolean).sort()) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${spaceId}:${slug}`}, 0))`);
      }
      await tx.execute(sql`
        select ${spaceSkills.id} from ${spaceSkills}
        where ${spaceSkills.id} = ${skillId} and ${spaceSkills.spaceId} = ${spaceId}
        for update
      `);
      const skill = await getById(spaceId, skillId, tx);
      if (!skill) throw notFound("Skill not found");
      if (skill.slug !== initial.slug) throw conflict("Skill was renamed. Retry the operation.");
      return mutate(skill, tx);
    });
  }

  async function refreshEditedSkillInventory(skill: SpaceSkill, tx: DbOrTransaction) {
    const entries = await collectLocalSkillInventory(normalizeSkillDirectory(skill)!, inferLocalSkillInventoryMode(skill));
    const inventory = await Promise.all(entries.map(async (entry) => ({
      ...snapshotFile(entry.path, entry.kind, await fs.readFile(path.join(normalizeSkillDirectory(skill)!, entry.path)), Boolean((await fs.stat(path.join(normalizeSkillDirectory(skill)!, entry.path))).mode & 0o111)),
    })));
    await tx.update(spaceSkills).set({
      fileInventory: serializeFileInventory(inventory),
      trustLevel: deriveTrustLevel(inventory),
    })
      .where(and(eq(spaceSkills.spaceId, skill.spaceId), eq(spaceSkills.id, skill.id)));
    return inventory;
  }

  async function updateFile(
    spaceId: string,
    skillId: string,
    relativePath: string,
    content: string,
    actor: SkillActor | null = null,
    format: { encoding?: "utf8" | "base64"; executable?: boolean; expectedVersionId?: string | null;
      publication?: SkillContentPublication;
      afterUpdate?: (versionId: string | null) => Promise<void>;
      onRollback?: (restore: () => Promise<void>, versionId: string | null) => void } = {},
  ): Promise<SpaceSkillFileDetail> {
    const base = await getById(spaceId, skillId);
    if (!base) throw notFound("Skill not found");
    if (base.sourceType === "managed") {
      if (!base.currentVersionId) throw unprocessable("Managed skill has no committed version.");
      if (format.expectedVersionId !== undefined && format.expectedVersionId !== base.currentVersionId) {
        throw conflict("Skill version changed. Read the current version before retrying.");
      }
      const normalizedPath = normalizePortablePath(relativePath);
      try { assertSkillSnapshotPath(normalizedPath); } catch { throw unprocessable("Invalid skill file path."); }
      if (normalizedPath === "SKILL.md" && format.encoding === "base64") throw unprocessable("SKILL.md must be UTF-8 text.");
      const bytes = skillFileBytes({ content, encoding: format.encoding });
      if (format.encoding === "base64" && bytes.toString("base64") !== content) {
        throw unprocessable("Binary files must use canonical base64 encoding.");
      }
      const { files } = await managedContent.read(spaceId, skillId, base.currentVersionId);
      const previous = files.find(file => file.path === normalizedPath);
      const updated = snapshotFile(normalizedPath, classifyInventoryKind(normalizedPath), bytes,
        format.executable ?? previous?.executable ?? false);
      const inventory = [...files.filter(file => file.path !== normalizedPath), updated];
      const candidate = await managedContent.prepare(spaceId, inventory);
      const parsed = normalizedPath === "SKILL.md" ? parseFrontmatterMarkdown(content) : null;
      const saved = await managedContent.publish(base, candidate, {
        fileInventory: serializeFileInventory(inventory), trustLevel: deriveTrustLevel(inventory),
        ...(parsed ? { markdown: content, name: asString(parsed.frontmatter.name) ?? base.name,
          description: asString(parsed.frontmatter.description) ?? base.description,
          ...readSkillStoreMetadata(parsed.frontmatter, base.metadata) } : {}),
      }, actor, {
        ...format.publication, expectedVersionId: format.expectedVersionId, reuseCurrentVersion: true,
        validate: async tx => {
          await visibility(tx).assertSkill(spaceId, skillId);
          await format.publication?.validate?.(tx);
        },
        afterPublish: async (tx, skill, version) => {
          await format.publication?.afterPublish?.(tx, skill, version);
          await format.afterUpdate?.(version.id);
        },
      });
      return { ...updated, skillId, versionId: saved.version.id,
        language: updated.encoding === "base64" ? null : inferLanguageFromPath(normalizedPath),
        markdown: updated.encoding !== "base64" && isMarkdownPath(normalizedPath), editable: updated.encoding !== "base64" };
    }
    return withSkillFileMutation(spaceId, skillId, async (skill, tx) => {

      if (format.expectedVersionId !== undefined && skill.currentVersionId !== format.expectedVersionId) {
        throw conflict("Skill version changed. Read the current version before retrying.");
      }

      const source = deriveSkillSourceInfo(skill);
      if (!source.editable || skill.sourceType !== "local_path") {
        throw unprocessable(source.editableReason ?? "This skill cannot be edited.");
      }

      const normalizedPath = normalizePortablePath(relativePath);
      const absolutePath = resolveLocalSkillFilePath(skill, normalizedPath);
      if (!absolutePath) throw notFound("Skill file not found");

      if (normalizedPath === "SKILL.md" && format.encoding === "base64") throw unprocessable("SKILL.md must be UTF-8 text.");
      const bytes = skillFileBytes({ content, encoding: format.encoding });
      if (format.encoding === "base64" && bytes.toString("base64") !== content) {
        throw unprocessable("Binary files must use canonical base64 encoding.");
      }
      const previousContent = await fs.readFile(absolutePath).catch(() => null);
      const previousMode = (await fs.stat(absolutePath).catch(() => null))?.mode ?? 0o644;
      const restore = async () => {
        if (previousContent === null) await fs.rm(absolutePath, { force: true });
        else {
          await fs.writeFile(absolutePath, previousContent);
          await fs.chmod(absolutePath, previousMode);
        }
      };
      format.onRollback?.(restore, skill.currentVersionId);
      const mode = (format.executable ?? Boolean(previousMode & 0o111)) ? 0o755 : 0o644;
      try {
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, bytes);
        await fs.chmod(absolutePath, mode);

        if (normalizedPath === "SKILL.md") {
          const parsed = parseFrontmatterMarkdown(content);
          await tx
            .update(spaceSkills)
            .set({
              name: asString(parsed.frontmatter.name) ?? skill.name,
              description: asString(parsed.frontmatter.description) ?? skill.description,
              markdown: content,
              ...readSkillStoreMetadata(parsed.frontmatter, skill.metadata),
              updatedAt: new Date(),
            })
            .where(eq(spaceSkills.id, skill.id));
        } else {
          await tx
            .update(spaceSkills)
            .set({ updatedAt: new Date() })
            .where(eq(spaceSkills.id, skill.id));
        }

        const inventory = await refreshEditedSkillInventory(skill, tx);
        if (!previousContent?.equals(bytes) || Boolean(previousMode & 0o111) !== Boolean(mode & 0o111)) {
          await createVersion(spaceId, skillId, {}, actor, {
            database: tx, skipInventoryRefresh: true, skill, fileInventory: inventory,
          });
        }

        const updated = await getById(spaceId, skillId, tx);
        const detail = updated ? await readLoadedSkillFile(updated, normalizedPath) : null;
        if (!detail) throw notFound("Skill file not found");
        await format.afterUpdate?.(updated?.currentVersionId ?? null);
        return detail;
      } catch (error) {
        await restore();
        throw error;
      }
    });
  }

  async function deleteFile(
    spaceId: string,
    skillId: string,
    input: SpaceSkillFileDeleteRequest,
    actor: SkillActor | null = null,
    publication: SkillContentPublication = {},
  ): Promise<SpaceSkillFileDeleteResult> {
    const base = await getById(spaceId, skillId);
    if (!base) throw notFound("Skill not found");
    if (base.sourceType === "managed") {
      if (!base.currentVersionId) throw unprocessable("Managed skill has no committed version.");
      if (input.expectedVersionId !== undefined && input.expectedVersionId !== base.currentVersionId) {
        throw conflict("Skill version changed. Read the current version before retrying.");
      }
      const normalizedPath = normalizePortablePath(input.path);
      if (!normalizedPath) throw unprocessable("Skill file path is required.");
      const { files } = await managedContent.read(spaceId, skillId, base.currentVersionId);
      const matches = (file: SpaceSkillVersionFileInventoryEntry) => input.target === "folder"
        ? file.path.startsWith(`${normalizedPath}/`) : file.path === normalizedPath;
      const deletedPaths = files.filter(matches).map(file => file.path);
      if (!deletedPaths.length) throw notFound(input.target === "folder" ? "Skill folder not found" : "Skill file not found");
      if (deletedPaths.includes("SKILL.md")) throw unprocessable("SKILL.md cannot be deleted.");
      const inventory = files.filter(file => !matches(file));
      const candidate = await managedContent.prepare(spaceId, inventory);
      const saved = await managedContent.publish(base, candidate, {
        fileInventory: serializeFileInventory(inventory), trustLevel: deriveTrustLevel(inventory),
      }, actor, { ...publication, expectedVersionId: input.expectedVersionId,
        label: `Deleted ${normalizedPath}${input.target === "folder" ? "/" : ""}`,
        validate: async tx => {
          await visibility(tx).assertSkill(spaceId, skillId);
          await publication.validate?.(tx);
        },
      });
      return { skillId, path: normalizedPath, target: input.target, deletedPaths, versionId: saved.version.id };
    }
    let backup: { directory: string; source: string; copy: string } | undefined;
    let mutation: { slug: string; sourceLocator: string | null; previousVersionId: string | null; savedVersionId?: string } | undefined;
    let needsRestore = false;
    async function restore() {
      if (!backup || !needsRestore) return;
      await fs.cp(backup.copy, backup.source, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true });
      needsRestore = false;
    }
    try {
      const result = await withSkillFileMutation(spaceId, skillId, async (skill, tx) => {
        const source = deriveSkillSourceInfo(skill);
        if (!source.editable || skill.sourceType !== "local_path") {
          throw unprocessable(source.editableReason ?? "This skill cannot be edited.");
        }

        const normalizedPath = normalizePortablePath(input.path);
        if (!normalizedPath) {
          throw unprocessable("Skill file path is required.");
        }

        const deletedPaths = input.target === "folder"
          ? skill.fileInventory
            .map((entry) => normalizePortablePath(entry.path))
            .filter((entryPath) => entryPath.startsWith(`${normalizedPath}/`))
          : skill.fileInventory
            .map((entry) => normalizePortablePath(entry.path))
            .filter((entryPath) => entryPath === normalizedPath);

        if (deletedPaths.length === 0) {
          throw notFound(input.target === "folder" ? "Skill folder not found" : "Skill file not found");
        }
        if (deletedPaths.includes("SKILL.md")) {
          throw unprocessable("SKILL.md cannot be deleted.");
        }

        const absolutePath = resolveLocalSkillFilePath(skill, normalizedPath);
        if (!absolutePath) throw notFound("Skill file not found");

        // Keep the entire subtree, including unlisted files and empty folders.
        // A temporary directory outside the skill also supports imported roots
        // on other filesystems without adding the backup to its inventory.
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), "outpost-skill-delete-"));
        backup = { directory, source: absolutePath, copy: path.join(directory, "source") };
        mutation = { slug: skill.slug, sourceLocator: skill.sourceLocator, previousVersionId: skill.currentVersionId };
        await fs.cp(absolutePath, backup.copy, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true })
          .catch((error) => {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
              throw notFound(input.target === "folder" ? "Skill folder not found" : "Skill file not found");
            }
            throw error;
          });

        try {
          needsRestore = true;
          await fs.rm(absolutePath, { recursive: input.target === "folder", force: false }).catch(error => {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
              throw notFound(input.target === "folder" ? "Skill folder not found" : "Skill file not found");
            }
            throw error;
          });
          await tx
            .update(spaceSkills)
            .set({ updatedAt: new Date() })
            .where(eq(spaceSkills.id, skill.id));

          const inventory = await refreshEditedSkillInventory(skill, tx);
          const version = await createVersion(spaceId, skillId, {
            label: input.target === "folder" ? `Deleted ${normalizedPath}/` : `Deleted ${normalizedPath}`,
          }, actor, { database: tx, skipInventoryRefresh: true, skill, fileInventory: inventory });
          mutation.savedVersionId = version.id;

          return { skillId: skill.id, path: normalizedPath, target: input.target, deletedPaths };
        } catch (error) {
          // Restore before releasing the mutation lock so a queued edit cannot
          // observe missing files or be overwritten by rollback.
          await restore();
          throw error;
        }
      });
      needsRestore = false;
      return result;
    } catch (error) {
      if (needsRestore && mutation) {
        const attempted = mutation;
        try {
          // A lost commit reply does not prove rollback. Reacquire the same
          // locks before checking its outcome or touching the source again.
          await db.transaction(async tx => {
            await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${spaceId}:${attempted.slug}`}, 0))`);
            const [current] = await tx.select({ slug: spaceSkills.slug, sourceLocator: spaceSkills.sourceLocator,
              currentVersionId: spaceSkills.currentVersionId }).from(spaceSkills)
              .where(and(eq(spaceSkills.spaceId, spaceId), eq(spaceSkills.id, skillId))).for("update");
            if (current?.slug !== attempted.slug || current.sourceLocator !== attempted.sourceLocator) return;
            if (current.currentVersionId === attempted.savedVersionId) needsRestore = false;
            else if (current.currentVersionId === attempted.previousVersionId) await restore();
          });
        } catch (recoveryError) {
          logger.warn({ err: recoveryError, spaceId, skillId }, "Skill deletion transaction outcome could not be checked");
        }
        if (needsRestore) {
          logger.warn({ spaceId, skillId, backupDirectory: backup?.directory }, "Skill deletion backup retained; outcome is unknown or skill changed");
        }
      }
      throw error;
    } finally {
      if (backup && !needsRestore) {
        await fs.rm(backup.directory, { recursive: true, force: true }).catch(error => {
          logger.warn({ err: error, spaceId, skillId }, "Skill file deletion backup cleanup failed");
        });
      }
    }
  }

  async function installUpdate(spaceId: string, skillId: string, options: { force?: boolean; expectedVersionId?: string | null } = {}, publication: SkillContentPublication = {}): Promise<SpaceSkill | null> {
    await ensureSkillInventoryCurrent(spaceId);
    const skill = await getById(spaceId, skillId);
    if (!skill) return null;
    if (options.expectedVersionId !== undefined && options.expectedVersionId !== skill.currentVersionId) throw conflict("Skill version changed. Read the current version before retrying.");

    const status = await updateStatus(spaceId, skillId);
    if (!status?.supported) {
      throw unprocessable(status?.reason ?? "This skill does not support updates.");
    }
    if (skill.sourceType === "local_path") {
      const audit = await auditInstalledSkillBytes(skill);
      await persistAuditMetadata(skill, audit);
      if (audit.verdict === "fail") {
        throw unprocessable("Skill update is blocked by hard-stop audit findings.", {
          updateHoldReason: "audit_hard_stop",
          audit,
        });
      }
      if (audit.originHash && audit.installedHash !== audit.originHash && !options.force) {
        throw unprocessable("Skill update is held because local modifications were detected; rerun with --force to discard them.", {
          updateHoldReason: "local_modifications",
          audit,
        });
      }
    }

    if (!skill.sourceLocator) {
      throw unprocessable("Skill source locator is missing.");
    }

    const result = await readUrlSkillImports(spaceId, skill.sourceLocator, skill.slug);
    const matching = result.skills.find((entry) => entry.key === skill.key) ?? result.skills[0] ?? null;
    if (!matching) {
      throw unprocessable(`Skill ${skill.key} could not be re-imported from its source.`);
    }
    const imported = await upsertImportedSkills(spaceId, [matching], db, {
      snapshots: await snapshotRemoteImports([matching]), bases: new Map([[matching.key, skill]]), publication,
    });
    return imported[0] ?? null;
  }

  async function browseProjectWorkspace(
    spaceId: string,
    input: SpaceSkillProjectBrowseRequest,
  ): Promise<SpaceSkillProjectBrowseResult> {
    const project = (await projects.listByIds(spaceId, [input.projectId]))[0];
    if (!project) throw notFound("Project not found");
    const workspace = project.workspaces.find((entry) => entry.id === input.workspaceId);
    if (!workspace) throw notFound("Project workspace not found");
    const workspaceCwd = asString(workspace.cwd);
    if (!workspaceCwd || workspace.sourceType === "remote_managed") {
      throw unprocessable("Project workspace is not available for local browsing.");
    }

    const normalizedPath = input.path?.trim() ? normalizeProjectScanSelectionPath(input.path) : ".";
    if (!normalizedPath) throw unprocessable("Project workspace path is invalid.");
    const workspaceRoot = await fs.realpath(path.resolve(workspaceCwd)).catch(() => null);
    if (!workspaceRoot) throw unprocessable("Project workspace is not available locally.");
    const targetPath = await fs.realpath(path.resolve(workspaceRoot, normalizedPath)).catch(() => null);
    if (!targetPath) throw notFound("Project workspace folder not found");
    const relativeTarget = path.relative(workspaceRoot, targetPath);
    if (relativeTarget === ".." || relativeTarget.startsWith(`..${path.sep}`) || path.isAbsolute(relativeTarget)) {
      throw forbidden("Project workspace path is outside the workspace.");
    }
    const targetStat = await fs.stat(targetPath);
    if (!targetStat.isDirectory()) throw unprocessable("Project workspace path must be a folder.");

    const directoryEntries = await fs.readdir(targetPath, { withFileTypes: true });
    const visibleDirectoryEntries = directoryEntries.filter((entry) => (
      !entry.isSymbolicLink()
      && entry.name !== ".git"
      && entry.name !== "node_modules"
      && (entry.isDirectory() || entry.isFile())
    ));
    const entries: SpaceSkillProjectBrowseResult["entries"] = [];
    for (const entry of visibleDirectoryEntries.slice(0, 250)) {
      const entryPath = normalizedPath === "." ? entry.name : `${normalizedPath}/${entry.name}`;
      entries.push({
        name: entry.name,
        path: entryPath,
        kind: entry.isDirectory() ? "directory" : "file",
        isSkill: entry.isDirectory()
          ? await hasExactSkillFile(path.join(targetPath, entry.name))
          : entry.name === "SKILL.md",
      });
    }
    entries.sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
    return {
      projectId: project.id,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      path: normalizedPath,
      parentPath: normalizedPath === "." ? null : path.posix.dirname(normalizedPath) || ".",
      entries,
      truncated: visibleDirectoryEntries.length > 250,
    };
  }

  async function scanProjectWorkspaces(
    spaceId: string,
    input: SpaceSkillProjectScanRequest = {},
  ): Promise<SpaceSkillProjectScanResult> {
    await ensureSkillInventoryCurrent(spaceId);
    const mode = input.mode ?? "import";
    const selectiveImport = mode === "import" && input.selection !== undefined;
    const projectRows = input.projectIds?.length
      ? await projects.listByIds(spaceId, input.projectIds)
      : await projects.list(spaceId);
    const workspaceFilter = new Set(input.workspaceIds ?? []);
    const skipped: SpaceSkillProjectScanSkipped[] = [];
    const conflicts: SpaceSkillProjectScanConflict[] = [];
    const candidates: SpaceSkillProjectScanCandidate[] = [];
    const warnings: string[] = [];
    const imported: SpaceSkill[] = [];
    const updated: SpaceSkill[] = [];
    const availableSkills = await listFull(spaceId);
    const acceptedSkills = [...availableSkills];
    const acceptedByKey = new Map(acceptedSkills.map((skill) => [skill.key, skill]));
    const scanTargets: ProjectSkillScanTarget[] = [];
    const workspaceContexts = new Map<string, {
      projectId: string;
      projectName: string;
      workspaceId: string;
      workspaceName: string;
    }>();
    const selectedPaths = new Map<string, { workspaceId: string; path: string; slug?: string }>();
    const invalidSelections: Array<{ workspaceId: string; path: string; slug?: string }> = [];
    const rediscoveredSelections = new Set<string>();
    const scannedProjectIds = new Set<string>();
    let discovered = 0;

    for (const selection of input.selection ?? []) {
      const normalizedPath = normalizeProjectScanSelectionPath(selection.path);
      if (!normalizedPath) {
        invalidSelections.push(selection);
        continue;
      }
      const renamedSlug = selection.slug === undefined
        ? undefined
        : normalizeSkillSlug(selection.slug);
      if (selection.slug !== undefined && !renamedSlug) {
        invalidSelections.push(selection);
        continue;
      }
      selectedPaths.set(projectScanSelectionKey(selection.workspaceId, normalizedPath), {
        workspaceId: selection.workspaceId,
        path: normalizedPath,
        ...(renamedSlug ? { slug: renamedSlug } : {}),
      });
    }
    const selectedWorkspaceIds = new Set(
      Array.from(selectedPaths.values()).map((selection) => selection.workspaceId),
    );

    const trackWarning = (message: string) => {
      warnings.push(message);
      return message;
    };
    const upsertAcceptedSkill = (skill: SpaceSkill) => {
      const nextIndex = acceptedSkills.findIndex((entry) => entry.id === skill.id || entry.key === skill.key);
      if (nextIndex >= 0) acceptedSkills[nextIndex] = skill;
      else acceptedSkills.push(skill);
      acceptedByKey.set(skill.key, skill);
    };

    for (const project of projectRows) {
      for (const workspace of project.workspaces) {
        workspaceContexts.set(workspace.id, {
          projectId: project.id,
          projectName: project.name,
          workspaceId: workspace.id,
          workspaceName: workspace.name,
        });
        if (workspaceFilter.size > 0 && !workspaceFilter.has(workspace.id)) continue;
        if (selectiveImport && !selectedWorkspaceIds.has(workspace.id)) continue;
        const workspaceCwd = asString(workspace.cwd);
        if (!workspaceCwd) {
          skipped.push({
            projectId: project.id,
            projectName: project.name,
            workspaceId: workspace.id,
            workspaceName: workspace.name,
            path: null,
            reason: trackWarning(`Skipped ${project.name} / ${workspace.name}: no local workspace path is configured.`),
          });
          continue;
        }

        const workspaceStat = await statPath(workspaceCwd);
        if (!workspaceStat?.isDirectory()) {
          skipped.push({
            projectId: project.id,
            projectName: project.name,
            workspaceId: workspace.id,
            workspaceName: workspace.name,
            path: workspaceCwd,
            reason: trackWarning(`Skipped ${project.name} / ${workspace.name}: local workspace path is not available at ${workspaceCwd}.`),
          });
          continue;
        }

        scanTargets.push({
          projectId: project.id,
          projectName: project.name,
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          workspaceCwd,
        });
      }
    }

    for (const target of scanTargets) {
      scannedProjectIds.add(target.projectId);
      const explicitPaths = Array.from(selectedPaths.values())
        .filter((selection) => selection.workspaceId === target.workspaceId)
        .map((selection) => selection.path);
      const directories = await discoverProjectWorkspaceSkillDirectories(target, explicitPaths);

      for (const directory of directories) {
        discovered += 1;
        const selectionKey = projectScanSelectionKey(target.workspaceId, directory.relativePath);
        const selected = !selectiveImport || selectedPaths.has(selectionKey);
        const selectedRename = selectedPaths.get(selectionKey)?.slug;
        if (selectedPaths.has(selectionKey)) rediscoveredSelections.add(selectionKey);
        if (selectiveImport && !selected) continue;

        let nextSkill: ImportedSkill;
        try {
          nextSkill = await readLocalSkillImportFromDirectory(spaceId, directory.skillDir, {
            inventoryMode: directory.inventoryMode,
            metadata: {
              sourceKind: "project_scan",
              projectId: target.projectId,
              projectName: target.projectName,
              workspaceId: target.workspaceId,
              workspaceName: target.workspaceName,
              workspaceCwd: target.workspaceCwd,
            },
            workspaceRoot: target.workspaceCwd,
          });
        } catch (error) {
          const message = projectSkillImportFailureReason(error);
          candidates.push({
            slug: path.basename(directory.skillDir),
            name: path.basename(directory.skillDir),
            description: null,
            workspaceId: target.workspaceId,
            workspaceName: target.workspaceName,
            projectId: target.projectId,
            projectName: target.projectName,
            directoryRoot: directory.directoryRoot,
            relativePath: directory.relativePath,
            status: "skipped",
            reason: message,
          });
          skipped.push({
            projectId: target.projectId,
            projectName: target.projectName,
            workspaceId: target.workspaceId,
            workspaceName: target.workspaceName,
            path: directory.skillDir,
            reason: trackWarning(
              `Skipped ${target.projectName} / ${target.workspaceName} / ${directory.relativePath}: ${message}`,
            ),
          });
          continue;
        }

        const normalizedSourceDir = normalizeSourceLocatorDirectory(nextSkill.sourceLocator);
        const existingBySource = normalizedSourceDir
          ? acceptedSkills.find((skill) => normalizeSkillDirectory(skill) === normalizedSourceDir) ?? null
          : null;
        if (existingBySource) {
          candidates.push({
            slug: nextSkill.slug,
            name: nextSkill.name,
            description: nextSkill.description,
            workspaceId: target.workspaceId,
            workspaceName: target.workspaceName,
            projectId: target.projectId,
            projectName: target.projectName,
            directoryRoot: directory.directoryRoot,
            relativePath: directory.relativePath,
            status: "already_imported",
            existingSkillId: existingBySource.id,
            reason: "This skill is already installed from the same path.",
          });
          if (mode === "preview" || !selected) continue;
          const persisted = (await upsertImportedSkills(spaceId, [{
            ...nextSkill,
            key: existingBySource.key,
            slug: existingBySource.slug,
          }]))[0];
          if (!persisted) continue;
          updated.push(persisted);
          upsertAcceptedSkill(persisted);
          continue;
        }

        const existingBundledBySlug = acceptedSkills.find((skill) => (
          skill.slug === nextSkill.slug
          && (isOutpostBundledSkillKey(skill.key) || asString(skill.metadata?.sourceKind) === "outpost_bundled")
        )) ?? null;
        if (existingBundledBySlug) {
          candidates.push({
            slug: nextSkill.slug,
            name: nextSkill.name,
            description: nextSkill.description,
            workspaceId: target.workspaceId,
            workspaceName: target.workspaceName,
            projectId: target.projectId,
            projectName: target.projectName,
            directoryRoot: directory.directoryRoot,
            relativePath: directory.relativePath,
            status: "already_imported",
            existingSkillId: existingBundledBySlug.id,
            reason: "This skill is already available as a built-in.",
          });
          continue;
        }

        if (selectedRename) {
          const renamedKey = `local/${hashSkillValue(path.resolve(nextSkill.sourceLocator ?? directory.skillDir))}/${selectedRename}`;
          nextSkill = {
            ...nextSkill,
            key: renamedKey,
            slug: selectedRename,
            metadata: {
              ...(isPlainRecord(nextSkill.metadata) ? nextSkill.metadata : {}),
              skillKey: renamedKey,
            },
          };
        }

        const existingByKey = acceptedByKey.get(nextSkill.key) ?? null;
        if (existingByKey) {
          const existingSourceDir = normalizeSkillDirectory(existingByKey);
          if (
            existingByKey.sourceType !== "local_path"
            || !existingSourceDir
            || !normalizedSourceDir
            || existingSourceDir !== normalizedSourceDir
          ) {
            const reason = `Skill key ${nextSkill.key} already points at ${existingByKey.sourceLocator ?? "another source"}.`;
            conflicts.push({
              slug: nextSkill.slug,
              key: nextSkill.key,
              projectId: target.projectId,
              projectName: target.projectName,
              workspaceId: target.workspaceId,
              workspaceName: target.workspaceName,
              path: directory.skillDir,
              existingSkillId: existingByKey.id,
              existingSkillKey: existingByKey.key,
              existingSourceLocator: existingByKey.sourceLocator,
              reason,
            });
            candidates.push({
              slug: nextSkill.slug,
              name: nextSkill.name,
              description: nextSkill.description,
              workspaceId: target.workspaceId,
              workspaceName: target.workspaceName,
              projectId: target.projectId,
              projectName: target.projectName,
              directoryRoot: directory.directoryRoot,
              relativePath: directory.relativePath,
              status: "conflict",
              existingSkillId: existingByKey.id,
              reason,
            });
            continue;
          }

          candidates.push({
            slug: nextSkill.slug,
            name: nextSkill.name,
            description: nextSkill.description,
            workspaceId: target.workspaceId,
            workspaceName: target.workspaceName,
            projectId: target.projectId,
            projectName: target.projectName,
            directoryRoot: directory.directoryRoot,
            relativePath: directory.relativePath,
            status: "already_imported",
            existingSkillId: existingByKey.id,
            ...(selectiveImport && !selected ? { reason: "Not selected for import." } : {}),
          });
          if (mode === "preview" || !selected) continue;
          const persisted = (await upsertImportedSkills(spaceId, [nextSkill]))[0];
          if (!persisted) continue;
          updated.push(persisted);
          upsertAcceptedSkill(persisted);
          continue;
        }

        const slugConflict = acceptedSkills.find((skill) => {
          if (skill.slug !== nextSkill.slug) return false;
          return normalizeSkillDirectory(skill) !== normalizedSourceDir;
        });
        if (slugConflict) {
          const reason = `Slug ${nextSkill.slug} is already in use by ${slugConflict.sourceLocator ?? slugConflict.key}.`;
          conflicts.push({
            slug: nextSkill.slug,
            key: nextSkill.key,
            projectId: target.projectId,
            projectName: target.projectName,
            workspaceId: target.workspaceId,
            workspaceName: target.workspaceName,
            path: directory.skillDir,
            existingSkillId: slugConflict.id,
            existingSkillKey: slugConflict.key,
            existingSourceLocator: slugConflict.sourceLocator,
            reason,
          });
          candidates.push({
            slug: nextSkill.slug,
            name: nextSkill.name,
            description: nextSkill.description,
            workspaceId: target.workspaceId,
            workspaceName: target.workspaceName,
            projectId: target.projectId,
            projectName: target.projectName,
            directoryRoot: directory.directoryRoot,
            relativePath: directory.relativePath,
            status: "conflict",
            existingSkillId: slugConflict.id,
            reason,
          });
          continue;
        }

        candidates.push({
          slug: nextSkill.slug,
          name: nextSkill.name,
          description: nextSkill.description,
          workspaceId: target.workspaceId,
          workspaceName: target.workspaceName,
          projectId: target.projectId,
          projectName: target.projectName,
          directoryRoot: directory.directoryRoot,
          relativePath: directory.relativePath,
          status: selected ? "new" : "skipped",
          ...(!selected ? { reason: "Not selected for import." } : {}),
        });
        if (mode === "preview" || !selected) continue;
        const persisted = (await upsertImportedSkills(spaceId, [nextSkill]))[0];
        if (!persisted) continue;
        imported.push(persisted);
        upsertAcceptedSkill(persisted);
      }
    }

    if (selectiveImport) {
      const unmatchedSelections = [
        ...invalidSelections,
        ...Array.from(selectedPaths.entries())
          .filter(([key]) => !rediscoveredSelections.has(key))
          .map(([, selection]) => selection),
      ];
      for (const selection of unmatchedSelections) {
        const context = workspaceContexts.get(selection.workspaceId) ?? null;
        skipped.push({
          projectId: context?.projectId ?? null,
          projectName: context?.projectName ?? null,
          workspaceId: selection.workspaceId,
          workspaceName: context?.workspaceName ?? null,
          path: selection.path,
          reason: trackWarning(
            `Skipped selection ${selection.workspaceId}:${selection.path}: the path was not rediscovered in the project workspace scan.`,
          ),
        });
      }
    }

    return {
      scannedProjects: scannedProjectIds.size,
      scannedWorkspaces: scanTargets.length,
      discovered,
      imported,
      updated,
      skipped,
      conflicts,
      candidates,
      warnings,
    };
  }

  async function createDirectoryReplacement(targetDir: string) {
    const parentDir = path.dirname(targetDir);
    const baseName = path.basename(targetDir);
    await fs.mkdir(parentDir, { recursive: true });
    const stagingDir = path.join(parentDir, `.${baseName}.tmp-${randomUUID()}`);
    const previousDir = path.join(parentDir, `.${baseName}.old-${randomUUID()}`);
    await fs.rm(stagingDir, { recursive: true, force: true });
    await fs.mkdir(stagingDir, { recursive: true });

    return {
      stagingDir,
      async commit() {
        let hasPrevious = false;
        try {
          await fs.rename(targetDir, previousDir);
          hasPrevious = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }

        try {
          await fs.rename(stagingDir, targetDir);
        } catch (error) {
          if (hasPrevious) {
            await fs.rename(previousDir, targetDir).catch(() => undefined);
          }
          throw error;
        }

        if (hasPrevious) {
          await fs.rm(previousDir, { recursive: true, force: true });
        }
      },
      async cleanup() {
        await fs.rm(stagingDir, { recursive: true, force: true });
      },
    };
  }

  async function materializeRuntimeSkillFiles(spaceId: string, skill: SpaceSkill) {
    const runtimeRoot = path.resolve(resolveManagedSkillsRoot(spaceId), "__runtime__");
    const skillDir = path.resolve(runtimeRoot, buildSkillRuntimeName(skill.key, skill.slug));
    await fs.rm(skillDir, { recursive: true, force: true });
    await fs.mkdir(skillDir, { recursive: true });

    let wroteSkillFile = false;
    for (const entry of skill.fileInventory) {
      const normalizedPath = normalizePortablePath(entry.path);
      const detail = await readLoadedSkillFile(skill, normalizedPath);
      const content = detail?.content ?? (normalizedPath === "SKILL.md" ? skill.markdown : null);
      if (content === null) throw unprocessable("Declared skill file is unavailable");
      const resolved = resolveVersionSnapshotPath(skillDir, entry.path);
      if (!resolved) throw unprocessable("Invalid skill file path");
      const targetPath = resolved.targetPath;
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, content, "utf8");
      if (normalizedPath === "SKILL.md") wroteSkillFile = true;
    }

    if (!wroteSkillFile) {
      await fs.rm(skillDir, { recursive: true, force: true });
      throw unprocessable("Outpost skill could not be materialized because its stored SKILL.md copy is missing.");
    }

    return skillDir;
  }

  function resolveVersionSnapshotPath(skillDir: string, relativePath: string) {
    const normalizedPath = normalizePortablePath(relativePath);
    if (!normalizedPath) return null;
    const targetPath = path.resolve(skillDir, normalizedPath);
    if (targetPath !== skillDir && !targetPath.startsWith(`${skillDir}${path.sep}`)) {
      throw unprocessable(`Skill version file path is invalid: ${relativePath}`);
    }
    return { normalizedPath, targetPath };
  }

  async function runtimeVersionInventory(spaceId: string, version: SpaceSkillVersionSummary) {
    if (!version.repositorySnapshotId) {
      const row = (await readVersionMetadata(spaceId, version.spaceSkillId, version.id))!;
      return packageReader.versionFiles(row);
    }
    if (!version.repositorySkillPath) throw unprocessable("Installed repository snapshot is unavailable.");
    return repositorySkillProjection(await packageReader.files(spaceId, version.repositorySnapshotId, true), version.repositorySkillPath);
  }

  async function materializeVersionSnapshot(spaceId: string, skill: SpaceSkill, version: StoredSkillVersion): Promise<string> {
    return executionContent.withReadableVersion({ spaceId, skillId: skill.id, versionId: version.id }, async directory => directory);
  }

  function resolveRuntimeSkillMaterializedPath(spaceId: string, skill: Pick<SpaceSkill, "key" | "slug">) {
    const runtimeRoot = path.resolve(resolveManagedSkillsRoot(spaceId), "__runtime__");
    return path.resolve(runtimeRoot, buildSkillRuntimeName(skill.key, skill.slug));
  }

  async function resolveRuntimeSkillSource(
    spaceId: string,
    skill: SpaceSkill,
    options: RuntimeSkillEntryOptions,
  ): Promise<RuntimeSkillSourceResolution | null> {
    const selectedVersionId = options.versionSelections?.get(skill.key)
      ?? (options.snapshotLatest || skill.sourceType !== "local_path" || skill.metadata?.sourceKind === "outpost_bundled" || (skill.metadata?.skillSourceId && skill.metadata?.snapshotHash) || skill.accessSourceId ? skill.currentVersionId : null);
    if (selectedVersionId) {
      const versionPath = path.resolve(resolveManagedSkillsRoot(spaceId), "__versions__", skill.id, selectedVersionId);
      const version = await measureRunPhase("skills.version.read", () => readVersionMetadata(spaceId, skill.id, selectedVersionId));
      if (!version) {
        return {
          status: "missing",
          source: versionPath,
          detail: "The selected skill version no longer exists.",
        };
      }
      // A failed snapshot materialization must surface as a "missing" entry
      // with the real cause — a silent drop makes the skill vanish from the
      // runtime while the library still shows it installed.
      try {
        if (options.materializeMissing === false && !options.snapshotLatest) {
          // Agent settings enumerate the library, including unselected skills.
          // Execution, rather than browsing, validates the repository bytes.
          try {
            await ensureSkillCacheDirectory(versionPath);
            const entrypoint = await fs.lstat(path.join(versionPath, "SKILL.md"));
            if (!entrypoint.isFile() || entrypoint.isSymbolicLink()) throw unprocessable("Unsafe skill cache entrypoint.");
            return { status: "available", source: versionPath };
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            return { status: "missing", source: versionPath,
              detail: "The selected skill version will be materialized on the next run." };
          }
        }
        const versionSource = await measureRunPhase("skills.version.materialize", () => materializeVersionSnapshot(spaceId, skill, version));
        if (versionSource) return { status: "available", source: versionSource };
        return { status: "missing", source: versionPath, detail: "The selected skill version produced no files." };
      } catch (error) {
        return {
          status: "missing",
          source: versionPath,
          detail: `Failed to materialize the selected skill version: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    if (skill.sourceType !== "local_path" || skill.metadata?.sourceKind === "outpost_bundled") {
      return { status: "missing", source: resolveRuntimeSkillMaterializedPath(spaceId, skill),
        detail: "This installation has no committed version. Complete legacy conversion before execution." };
    }
    const source = await resolveExistingSkillDirectory(normalizeSkillDirectory(skill));
    if (source) return { status: "available", source };

    try {
      const cache = runtimeSkillCacheSpec(resolveManagedSkillsRoot(spaceId), skill);
      if (cache) {
        const cachedSource = await resolveRuntimeSkillCache(cache,
          async (relativePath) => (await readLoadedSkillFile(skill, relativePath)).content,
          options.materializeMissing !== false,
          async () => (await getById(spaceId, skill.id))?.key === skill.key);
        return cachedSource
          ? { status: "available", source: cachedSource }
          : { status: "missing", source: path.join(cache.entry, "files"), detail: buildMissingRuntimeSourceDetail(skill) };
      }
    } catch (error) {
      return {
        status: "missing", source: resolveRuntimeSkillMaterializedPath(spaceId, skill),
        detail: `Failed to materialize skill files: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    if (options.materializeMissing === false) {
      const materializedPath = resolveRuntimeSkillMaterializedPath(spaceId, skill);
      const materializedSource = await resolveExistingSkillDirectory(materializedPath);
      if (materializedSource) return { status: "available", source: materializedSource };
      return {
        status: "missing",
        source: materializedPath,
        detail: buildMissingRuntimeSourceDetail(skill),
      };
    }

    // Same contract as above: a materialization failure becomes a structured
    // "missing" resolution carrying the underlying error, so snapshots and the
    // UI can show the skill as broken instead of pretending it does not exist.
    try {
      const materializedSource = await materializeRuntimeSkillFiles(spaceId, skill);
      if (materializedSource) return { status: "available", source: materializedSource };
      return {
        status: "missing",
        source: resolveRuntimeSkillMaterializedPath(spaceId, skill),
        detail: buildMissingRuntimeSourceDetail(skill),
      };
    } catch (error) {
      return {
        status: "missing",
        source: resolveRuntimeSkillMaterializedPath(spaceId, skill),
        detail: `Failed to materialize skill files: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async function listRuntimeSkillEntries(
    spaceId: string,
    options: RuntimeSkillEntryOptions = {},
  ): Promise<OutpostSkillEntry[]> {
    return withRuntimeSkillEntries(spaceId, options, entries => entries);
  }

  async function withRuntimeSkillEntries<T>(
    spaceId: string,
    options: RuntimeSkillEntryOptions,
    consume: (entries: OutpostSkillEntry[]) => T | Promise<T>,
  ): Promise<T> {
    if (options.onlyKeys?.size === 0 || (!options.onlyKeys && options.selectionConfig && !options.includeLegacy
      && readOutpostSkillSyncPreference(options.selectionConfig).desiredSkills.length === 0)) {
      await options.selectVersions?.([]);
      return consume([]);
    }
    // Probe only the selected metadata. Public selections avoid scanning
    // unrelated source permissions; restricted selections still authorize now.
    const requested = options.onlyKeys ?? (options.selectionConfig && !options.includeLegacy
      ? new Set(readOutpostSkillSyncPreference(options.selectionConfig).desiredSkills) : null);
    const columns = { key: spaceSkills.key, slug: spaceSkills.slug, sourceLocator: spaceSkills.sourceLocator,
      sourceKind: sql<string>`${spaceSkills.metadata}->>'sourceKind'`, accessSourceId: spaceSkills.accessSourceId };
    let installed = requested?.size && visibility().canReadSpace(spaceId) ? await db.select(columns)
      .from(spaceSkills).where(and(eq(spaceSkills.spaceId, spaceId), inArray(spaceSkills.key, [...requested]))) : [];
    if (requested && installed.some(skill => skill.accessSourceId !== null)) {
      installed = await db.select(columns).from(spaceSkills).where(and(eq(spaceSkills.spaceId, spaceId),
        inArray(spaceSkills.key, [...requested]), await visibility().condition(spaceId)));
    }
    const preparedSelection = requested && installed.length === requested.size;
    if (!preparedSelection) {
      await measureRunPhase("skills.inventory", () => ensureSkillInventoryCurrent(spaceId));
    }
    return withSkillPackageReadScope(db, () => withSkillVersionCacheLock(db, spaceId, async () => {
      // Recheck scope on the full row read: a public-to-project change between
      // the probe and consumption must fail closed.
      const runtimeOptions = preparedSelection ? { ...options, onlyKeys: requested } : options;
      const entries = await listRuntimeSkillEntriesLocked(spaceId, runtimeOptions,
        Boolean(preparedSelection && installed.every(skill => skill.accessSourceId === null)));
      return measureRunPhase("skills.consume", () => consume(entries));
    }));
  }

  async function listRuntimeSkillEntriesLocked(
    spaceId: string,
    options: RuntimeSkillEntryOptions,
    unrestrictedOnly = false,
  ): Promise<OutpostSkillEntry[]> {
    const references = !options.onlyKeys && options.selectionConfig ? await listReferenceTargets(spaceId) : [];
    const selectedKeys = options.onlyKeys ?? (options.selectionConfig ? new Set(
      (options.includeLegacy ? resolveLegacyOutpostDesiredSkillNames : resolveOutpostDesiredSkillNames)(
        options.selectionConfig, references.map(skill => ({ key: skill.key, runtimeName: buildSkillRuntimeName(skill.key, skill.slug) }))),
    ) : undefined);
    let skills = await measureRunPhase("skills.rows", () => readFullSkillRows(spaceId, selectedKeys, unrestrictedOnly));
    for (const [key, versionId] of options.versionSelections ?? []) {
      if (!versionId || (selectedKeys && !selectedKeys.has(key))) continue;
      const [version] = await db.select({ skillId: spaceSkillVersions.spaceSkillId }).from(spaceSkillVersions)
        .where(and(eq(spaceSkillVersions.spaceId, spaceId), eq(spaceSkillVersions.id, versionId)));
      // A saved JSONB selection map has a different key order from the fresh
      // name/key query. Replace existing rows in place so pinning versions does
      // not reorder the server-produced preference (and its session fingerprint).
      const index = skills.findIndex(skill => skill.key === key);
      if (index !== -1) skills.splice(index, 1);
      const owner = version ? await getById(spaceId, version.skillId) : null;
      if (owner) skills.splice(index === -1 ? skills.length : index, 0,
        { ...owner, key, slug: owner.key === key ? owner.slug : key.split("/").at(-1)! });
    }
    await packages.prefetch(spaceId, skills.flatMap(skill => {
      const id = options.versionSelections?.get(skill.key) ?? skill.currentVersionId;
      return id ? [id] : [];
    }));

    const selected: Array<{ skill: SpaceSkill; selection: RuntimeSkillVersionSelection; installedResolution: RuntimeSkillSourceResolution | null }> = [];
    for (let skill of skills) {
      if (selectedKeys && !selectedKeys.has(skill.key)) continue;
      let installedResolution: RuntimeSkillSourceResolution | null = null;
      const unpinned = !options.versionSelections?.get(skill.key);
      const installedDirectory = options.snapshotLatest && unpinned && skill.sourceType === "local_path"
        && skill.metadata?.sourceKind !== "outpost_bundled"
        ? await resolveExistingSkillDirectory(normalizeSkillDirectory(skill)) : null;
      const installedVersion = installedDirectory && skill.currentVersionId
        ? await readVersionMetadata(spaceId, skill.id, skill.currentVersionId) : null;
      const installedManifest = installedVersion?.packageSnapshotId
        ? await packages.manifest(spaceId, installedVersion.packageSnapshotId) : null;
      const installedUnchanged = installedDirectory && installedVersion && installedManifest
        && skillVersionUsesWholePackage(installedVersion, installedManifest)
        ? await verifyFileManifest(installedDirectory, installedManifest.files)
        : false;
      if (skill.sourceType === "local_path" && skill.metadata?.sourceKind !== "outpost_bundled"
        && !installedUnchanged && options.snapshotLatest && unpinned && (!skill.currentVersionId || installedDirectory)) {
        // Capture installed bytes only. Older remote imports can have no
        // version yet; execution must not fetch their missing files upstream.
        const installed: RuntimeSkillSourceResolution | null = installedDirectory ? { status: "available", source: installedDirectory }
          : await resolveRuntimeSkillSource(spaceId, skill, { ...options, snapshotLatest: false, materializeMissing: false });
        const inventory = installed?.status === "available"
          ? await collectVersionFileInventoryFromDirectory(installed.source)
          : skill.fileInventory.length === 1 && skill.fileInventory[0]?.path === "SKILL.md" && skill.markdown
            ? [{ path: "SKILL.md", kind: "skill" as const, content: skill.markdown }] : null;
        if (inventory) {
          const previous = installedVersion ?? (skill.currentVersionId ? await readVersionMetadata(spaceId, skill.id, skill.currentVersionId) : null);
          const previousHash = previous?.packageSnapshotId && skillVersionUsesWholePackage(previous,
            installedManifest ?? await packages.manifest(spaceId, previous.packageSnapshotId))
            ? (await packages.descriptor(spaceId, previous.packageSnapshotId)).contentHash
            : previous ? skillSnapshotHash(await packages.versionFiles(previous)) : null;
          if (previousHash !== skillSnapshotHash(inventory)) {
            const version = await createVersion(spaceId, skill.id, { label: "Execution snapshot" }, { type: "system" },
              { skipInventoryRefresh: true, skill, fileInventory: inventory });
            skill = { ...skill, currentVersionId: version.id };
          }
        } else installedResolution = installed;
      }
      const versionId = options.versionSelections?.get(skill.key)
        ?? (options.snapshotLatest || skill.sourceType !== "local_path" || skill.metadata?.sourceKind === "outpost_bundled" || skill.accessSourceId ? skill.currentVersionId : null);
      if (skill.sourceType === "managed" && !versionId) throw unprocessable("Managed skill has no committed version.");
      selected.push({ skill, installedResolution, selection: {
        spaceId, skillId: skill.id, key: skill.key, runtimeName: buildSkillRuntimeName(skill.key, skill.slug),
        versionId, currentVersionId: skill.currentVersionId,
      } });
    }
    const admitted = await options.selectVersions?.(selected.map(item => item.selection));
    const out: OutpostSkillEntry[] = [];
    for (const { skill, selection, installedResolution } of selected) {
      if (admitted && !admitted.has(selection.key)) continue;
      const sourceResolution = installedResolution ?? await resolveRuntimeSkillSource(spaceId, skill, {
        ...options, ...(options.snapshotLatest ? { materializeMissing: false } : {}),
        versionSelections: new Map([[selection.key, selection.versionId]]),
      });
      if (!sourceResolution) continue;
      out.push({ key: selection.key, runtimeName: selection.runtimeName, versionId: selection.versionId,
        currentVersionId: selection.currentVersionId, source: sourceResolution.source,
        sourceStatus: sourceResolution.status,
        missingDetail: sourceResolution.status === "missing" ? sourceResolution.detail : null });
    }
    out.sort((left, right) => left.key.localeCompare(right.key));
    return out;
  }

  async function importPackageFiles(
    spaceId: string,
    files: Record<string, string>,
    options?: {
      onConflict?: PackageSkillConflictStrategy;
      /** Managed plugin namespaces may share a slug while retaining separate canonical records. */
      allowSlugCollision?: boolean;
    },
  ): Promise<ImportPackageSkillResult[]> {
    await ensureSkillInventoryCurrent(spaceId);
    const normalizedFiles = normalizePackageFileMap(files);
    const importedSkills = readInlineSkillImports(spaceId, normalizedFiles);
    if (importedSkills.length === 0) return [];

    // Conflict handling must never bypass source and reserved-key checks. In
    // particular, the safe default "skip" path still validates the incoming
    // package before returning the existing skill.
    for (const skill of importedSkills) {
      assertImportedSkillKeyAllowed(skill);
      assertImportedSkillSourceAllowed(skill);
    }

    const conflictStrategy = options?.onConflict ?? "skip";
    const existingSkills = await listFull(spaceId);
    const existingByKey = new Map(existingSkills.map((skill) => [skill.key, skill]));
    const existingBySlug = new Map(
      existingSkills.map((skill) => [normalizeSkillSlug(skill.slug) ?? skill.slug, skill]),
    );
    const usedSlugs = new Set(existingBySlug.keys());
    const usedKeys = new Set(existingByKey.keys());

    const toPersist: ImportedSkill[] = [];
    const prepared: Array<{
      skill: ImportedSkill;
      originalKey: string;
      originalSlug: string;
      actionHint: "created" | "renamed" | "replaced";
      reason: string | null;
    }> = [];
    const out: ImportPackageSkillResult[] = [];

    for (const importedSkill of importedSkills) {
      const originalKey = importedSkill.key;
      const originalSlug = importedSkill.slug;
      const normalizedSlug = normalizeSkillSlug(importedSkill.slug) ?? importedSkill.slug;
      const existingByIncomingKey = existingByKey.get(importedSkill.key) ?? null;
      const existingByIncomingSlug = existingBySlug.get(normalizedSlug) ?? null;
      const conflict = existingByIncomingKey ?? (options?.allowSlugCollision ? null : existingByIncomingSlug);

      if (!conflict || conflictStrategy === "replace") {
        const skillToPersist = conflict && conflict.key !== importedSkill.key
          ? {
              ...importedSkill,
              key: conflict.key,
              slug: conflict.slug,
              metadata: {
                ...(importedSkill.metadata ?? {}),
                skillKey: conflict.key,
                importedFromSkillKey: originalKey,
                importedFromSkillSlug: originalSlug,
              },
            }
          : importedSkill;
        toPersist.push(skillToPersist);
        prepared.push({
          skill: skillToPersist,
          originalKey,
          originalSlug,
          actionHint: conflict ? "replaced" : "created",
          reason: conflict ? "Existing skill matched; explicit replace strategy." : null,
        });
        usedSlugs.add(normalizeSkillSlug(skillToPersist.slug) ?? skillToPersist.slug);
        usedKeys.add(skillToPersist.key);
        continue;
      }

      if (conflictStrategy === "skip") {
        out.push({
          skill: conflict,
          action: "skipped",
          originalKey,
          originalSlug,
          requestedRefs: Array.from(new Set([originalKey, originalSlug])),
          reason: "Existing skill matched; skip strategy.",
        });
        continue;
      }

      const renamedSlug = uniqueSkillSlug(normalizedSlug || "skill", usedSlugs);
      const renamedKey = uniqueImportedSkillKey(spaceId, renamedSlug, usedKeys);
      const renamedSkill: ImportedSkill = {
        ...importedSkill,
        slug: renamedSlug,
        key: renamedKey,
        metadata: {
          ...(importedSkill.metadata ?? {}),
          skillKey: renamedKey,
          importedFromSkillKey: originalKey,
          importedFromSkillSlug: originalSlug,
        },
      };
      toPersist.push(renamedSkill);
      prepared.push({
        skill: renamedSkill,
        originalKey,
        originalSlug,
        actionHint: "renamed",
        reason: `Existing skill matched; renamed to ${renamedSlug}.`,
      });
      usedSlugs.add(renamedSlug);
      usedKeys.add(renamedKey);
    }

    if (toPersist.length === 0) return out;

    const snapshots = new Map<string, SpaceSkillVersionFileInventoryEntry[]>();
    for (const skill of toPersist) {
      const prefix = skill.packageDir ? `${skill.packageDir}/` : "";
      snapshots.set(skill.key, skill.fileInventory.map(entry => {
        const sourcePath = entry.path === "SKILL.md"
          ? Object.keys(normalizedFiles).find(name => name.toLowerCase() === `${prefix}SKILL.md`.toLowerCase())
          : `${prefix}${entry.path}`;
        const content = sourcePath ? normalizedFiles[sourcePath] : undefined;
        if (content === undefined) throw unprocessable("Imported package is missing a declared skill file.");
        return { ...entry, content };
      }));
    }
    const persisted = await upsertImportedSkills(spaceId, toPersist, db, { snapshots });
    for (let index = 0; index < prepared.length; index += 1) {
      const persistedSkill = persisted[index];
      const preparedSkill = prepared[index];
      if (!persistedSkill || !preparedSkill) continue;
      out.push({
        skill: persistedSkill,
        action: preparedSkill.actionHint,
        originalKey: preparedSkill.originalKey,
        originalSlug: preparedSkill.originalSlug,
        requestedRefs: Array.from(new Set([preparedSkill.originalKey, preparedSkill.originalSlug])),
        reason: preparedSkill.reason,
      });
    }

    return out;
  }

  async function upsertImportedSkills(
    spaceId: string,
    imported: ImportedSkill[],
    database: DbOrTransaction = db,
    options: { includeFolderPath?: boolean; snapshots?: Map<string, SpaceSkillVersionFileInventoryEntry[]>;
      bases?: Map<string, SpaceSkill>; publication?: SkillContentPublication } = {},
  ): Promise<SpaceSkill[]> {
    const out: SpaceSkill[] = [];
    const bundledFolders = new Map<string, Awaited<ReturnType<typeof folderSvc.ensureBundledCategory>>>();
    for (const skill of imported) {
      assertImportedSkillKeyAllowed(skill);
      assertImportedSkillSourceAllowed(skill);
      const existing = options.bases?.get(skill.key) ?? await getByKey(spaceId, skill.key, database, options);
      const existingMeta = existing ? getSkillMeta(existing) : {};
      const incomingMeta = skill.metadata && isPlainRecord(skill.metadata) ? skill.metadata : {};
      const incomingOwner = asString(incomingMeta.owner);
      const incomingRepo = asString(incomingMeta.repo);
      const incomingKind = asString(incomingMeta.sourceKind);
      if (
        existing
        && existingMeta.sourceKind === "outpost_bundled"
        && incomingKind === "github"
        && incomingOwner === "outpost"
        && incomingRepo === "outpost"
      ) {
        out.push(existing);
        continue;
      }

      const metadata = {
        ...(skill.metadata ?? {}),
        skillKey: skill.key,
      };
      const parsed = parseFrontmatterMarkdown(skill.markdown);
      const storeMetadata = readSkillStoreMetadata(parsed.frontmatter, metadata);
      const bundledCategory = outpostBundledFolderCategory(skill.key, incomingMeta);
      let bundledFolder = bundledCategory ? bundledFolders.get(bundledCategory) : undefined;
      if (bundledCategory && !bundledFolder) {
        bundledFolder = await folderSvc.ensureBundledCategory(spaceId, bundledFolderLabel(bundledCategory));
        bundledFolders.set(bundledCategory, bundledFolder);
      }
      const projectId = asString(incomingMeta.projectId);
      const projectName = asString(incomingMeta.projectName);
      const projectFolder = !existing && incomingKind === "project_scan" && projectId && projectName
        ? await folderSvc.ensureProjectFolder(spaceId, projectId, projectName)
        : null;
      const values: ImportedSkillPersistValues = {
        spaceId,
        folderId: bundledFolder?.id ?? projectFolder?.id ?? existing?.folderId ?? null,
        key: skill.key,
        slug: skill.slug,
        name: skill.name,
        description: skill.description,
        markdown: skill.markdown,
        accessSourceId: typeof skill.metadata?.accessSourceId === "string" ? skill.metadata.accessSourceId : existing?.accessSourceId ?? null,
        sourceType: skill.sourceType,
        sourceLocator: skill.sourceLocator,
        sourceRef: skill.sourceRef,
        trustLevel: skill.trustLevel,
        compatibility: skill.compatibility,
        fileInventory: serializeFileInventory(skill.fileInventory),
        iconUrl: storeMetadata.iconUrl ?? existing?.iconUrl ?? null,
        color: storeMetadata.color ?? existing?.color ?? null,
        tagline: storeMetadata.tagline ?? existing?.tagline ?? null,
        authorName: storeMetadata.authorName ?? existing?.authorName ?? null,
        homepageUrl: storeMetadata.homepageUrl ?? existing?.homepageUrl ?? null,
        categories: storeMetadata.categories.length > 0 ? storeMetadata.categories : existing?.categories ?? [],
        sharingScope: existing?.sharingScope ?? "space",
        installCount: existing?.installCount ?? 1,
        metadata,
        updatedAt: new Date(),
      };
      const files = options.snapshots?.get(skill.key) ?? (incomingKind === "outpost_bundled" && skill.sourceLocator
        ? await collectVersionFileInventoryFromDirectory(normalizeSourceLocatorDirectory(skill.sourceLocator)!) : undefined);
      if (files) {
        const candidate = await managedContent.prepare(spaceId, files);
        if (existing && incomingKind === "outpost_bundled" && existing.currentVersionId
          && importedSkillPersistValuesMatchExisting(existing, values)) {
          const installedVersion = await packages.version(spaceId, existing.id, existing.currentVersionId);
          if (installedVersion
            && skillSnapshotHash(await packages.versionFiles(installedVersion)) === candidate.contentHash) {
            out.push(existing);
            continue;
          }
        }
        const saved = existing
          ? await managedContent.publish(existing, candidate, values, { type: "system" }, {
            ...options.publication, reuseCurrentVersion: true, validate: async tx => {
              await visibility(tx).assertSkill(spaceId, existing.id);
              await options.publication?.validate?.(tx);
            },
          })
          : await managedContent.create(values, candidate, { type: "system" }, options.publication);
        out.push(toSpaceSkill(saved.skill));
        continue;
      }
      if (existing && importedSkillPersistValuesMatchExisting(existing, values)) {
        out.push(existing);
        continue;
      }
      const row = existing
        ? await database
          .update(spaceSkills)
          .set(values)
          .where(eq(spaceSkills.id, existing.id))
          .returning()
          .then((rows) => rows[0] ?? null)
        : await database
          .insert(spaceSkills)
          .values(values)
          .returning()
          .then((rows) => rows[0] ?? null);
      if (!row) throw notFound("Failed to persist space skill");
      out.push(toSpaceSkill(row));
    }
    return out;
  }

  async function snapshotRemoteImports(imported: ImportedSkill[]) {
    const snapshots = new Map<string, SpaceSkillVersionFileInventoryEntry[]>();
    for (const skill of imported) {
      assertImportedSkillSourceAllowed(skill);
      const files: SpaceSkillVersionFileInventoryEntry[] = [];
      let bytes = Buffer.byteLength(skill.markdown);
      if (skill.fileInventory.length > MAX_SKILL_SNAPSHOT_FILES || bytes > MAX_SKILL_SNAPSHOT_BYTES) {
        throw unprocessable("Skill exceeds package limits.");
      }
      for (const entry of skill.fileInventory) {
        assertSkillSnapshotPath(entry.path);
        if (entry.path === "SKILL.md") { files.push({ ...entry, content: skill.markdown }); continue; }
        if (skill.sourceType !== "github" && skill.sourceType !== "skills_sh") throw unprocessable("Source has no complete immutable file inventory.");
        const metadata = skill.metadata ?? {};
        const owner = asString(metadata.owner);
        const repo = asString(metadata.repo);
        if (!owner || !repo || !isPinnedCommitRef(skill.sourceRef)) throw unprocessable("Repository revision is not pinned.");
        const dir = typeof metadata.repoSkillDir === "string" ? normalizeGitHubSkillDirectory(metadata.repoSkillDir, "") : skill.slug;
        const url = resolveRawGitHubUrl(asString(metadata.hostname) ?? "github.com", owner, repo, skill.sourceRef!, path.posix.join(dir, entry.path));
        const response = await ghFetch(url);
        if (!response.ok) throw unprocessable(`Could not acquire installed file ${entry.path}: ${response.status}`);
        if (!response.body) throw unprocessable("Installed file response has no body.");
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            bytes += part.value.byteLength;
            if (bytes > MAX_SKILL_SNAPSHOT_BYTES) throw unprocessable("Skill exceeds package limits.");
            chunks.push(part.value);
          }
        } finally { await reader.cancel(); reader.releaseLock(); }
        files.push(snapshotFile(entry.path, entry.kind, Buffer.concat(chunks)));
      }
      snapshots.set(skill.key, files);
    }
    return snapshots;
  }

  async function captureLegacyInstallation(spaceId: string, skillId: string) {
    const skill = await getById(spaceId, skillId);
    if (!skill) throw notFound("Skill not found");
    if (skill.sourceType !== "github" && skill.sourceType !== "skills_sh" && skill.sourceType !== "url") {
      throw unprocessable("Legacy installation has no exact remote source.");
    }
    if (skill.sourceType !== "url" && !isPinnedCommitRef(skill.sourceRef)) {
      throw unprocessable("Legacy repository revision is not pinned.");
    }
    return (await snapshotRemoteImports([skill])).get(skill.key)!;
  }

  async function importFromSource(spaceId: string, source: string): Promise<SpaceSkillImportResult> {
    await ensureSkillInventoryCurrent(spaceId);
    const parsed = parseSkillImportSourceInput(source);
    const local = !/^https?:\/\//i.test(parsed.resolvedSource);
    if (local) {
      await assertLocalImportSourceAllowed(spaceId, parsed.resolvedSource);
    }
    const { skills, warnings } = local
      ? {
        skills: (await readLocalSkillImports(spaceId, parsed.resolvedSource))
          .filter((skill) => !parsed.requestedSkillSlug || skill.slug === parsed.requestedSkillSlug),
        warnings: parsed.warnings,
      }
      : await readUrlSkillImports(spaceId, parsed.resolvedSource, parsed.requestedSkillSlug)
        .then((result) => ({
          skills: result.skills,
          warnings: [...parsed.warnings, ...result.warnings],
        }));
    const filteredSkills = parsed.requestedSkillSlug
      ? skills.filter((skill) => skill.slug === parsed.requestedSkillSlug)
      : skills;
    if (filteredSkills.length === 0) {
      throw unprocessable(
        parsed.requestedSkillSlug
          ? `Skill ${parsed.requestedSkillSlug} was not found in the provided source.`
          : "No skills were found in the provided source.",
      );
    }
    // Override sourceType/sourceLocator for skills imported via skills.sh
    if (parsed.originalSkillsShUrl) {
      for (const skill of filteredSkills) {
        skill.sourceType = "skills_sh";
        skill.sourceLocator = parsed.originalSkillsShUrl;
        if (skill.metadata) {
          (skill.metadata as Record<string, unknown>).sourceKind = "skills_sh";
        }
        skill.key = deriveCanonicalSkillKey(spaceId, skill);
      }
    }
    const imported = await upsertImportedSkills(spaceId, filteredSkills, db,
      local ? {} : { snapshots: await snapshotRemoteImports(filteredSkills) });
    return { imported, warnings };
  }

  async function listTestInputs(spaceId: string, skillId: string): Promise<SpaceSkillTestInput[]> {
    const skill = await getById(spaceId, skillId);
    if (!skill) throw notFound("Skill not found");
    const rows = await db
      .select()
      .from(spaceSkillTestInputs)
      .where(and(
        eq(spaceSkillTestInputs.spaceId, spaceId),
        eq(spaceSkillTestInputs.skillId, skillId),
        isNull(spaceSkillTestInputs.deletedAt),
      ))
      .orderBy(asc(spaceSkillTestInputs.name), asc(spaceSkillTestInputs.createdAt));
    return rows.map(toSpaceSkillTestInput);
  }

  async function createTestInput(
    spaceId: string,
    skillId: string,
    input: SpaceSkillTestInputCreateRequest,
    actor: SkillActor | null = null,
  ): Promise<SpaceSkillTestInput> {
    const skill = await getById(spaceId, skillId);
    if (!skill) throw notFound("Skill not found");
    const row = await db
      .insert(spaceSkillTestInputs)
      .values({
        spaceId,
        skillId,
        name: input.name.trim(),
        content: input.content,
        createdBy: actor?.type === "agent"
          ? actor.agentId ?? null
          : actor?.type === "user"
            ? actor.userId ?? null
            : null,
      })
      .returning()
      .then((rows) => rows[0] ?? null);
    if (!row) throw notFound("Failed to persist test input");
    return toSpaceSkillTestInput(row);
  }

  async function updateTestInput(
    spaceId: string,
    skillId: string,
    inputId: string,
    input: SpaceSkillTestInputUpdateRequest,
  ): Promise<SpaceSkillTestInput | null> {
    const patch: Partial<typeof spaceSkillTestInputs.$inferInsert> = { updatedAt: new Date() };
    if (input.name !== undefined) patch.name = input.name.trim();
    if (input.content !== undefined) patch.content = input.content;
    const row = await db
      .update(spaceSkillTestInputs)
      .set(patch)
      .where(and(
        eq(spaceSkillTestInputs.spaceId, spaceId),
        eq(spaceSkillTestInputs.skillId, skillId),
        eq(spaceSkillTestInputs.id, inputId),
        isNull(spaceSkillTestInputs.deletedAt),
      ))
      .returning()
      .then((rows) => rows[0] ?? null);
    return row ? toSpaceSkillTestInput(row) : null;
  }

  async function deleteTestInput(spaceId: string, skillId: string, inputId: string): Promise<SpaceSkillTestInput | null> {
    const row = await db
      .update(spaceSkillTestInputs)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(spaceSkillTestInputs.spaceId, spaceId),
        eq(spaceSkillTestInputs.skillId, skillId),
        eq(spaceSkillTestInputs.id, inputId),
        isNull(spaceSkillTestInputs.deletedAt),
      ))
      .returning()
      .then((rows) => rows[0] ?? null);
    return row ? toSpaceSkillTestInput(row) : null;
  }

  async function listTestRunTemplates(spaceId: string): Promise<SpaceSkillTestRunTemplate[]> {
    const rows = await db
      .select()
      .from(spaceSkillTestRunTemplates)
      .where(and(eq(spaceSkillTestRunTemplates.spaceId, spaceId), isNull(spaceSkillTestRunTemplates.deletedAt)))
      .orderBy(asc(spaceSkillTestRunTemplates.name), asc(spaceSkillTestRunTemplates.createdAt));
    return [
      builtInSkillTestRunTemplate(spaceId),
      ...rows.map(toSpaceSkillTestRunTemplate),
    ];
  }

  async function createTestRunTemplate(
    spaceId: string,
    input: SpaceSkillTestRunTemplateCreateRequest,
    actor: SkillActor | null = null,
  ): Promise<SpaceSkillTestRunTemplate> {
    validateSkillTestTemplatePlaceholders(input.body);
    const row = await db
      .insert(spaceSkillTestRunTemplates)
      .values({
        spaceId,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        body: input.body,
        createdByAgentId: actor?.type === "agent" ? actor.agentId ?? null : null,
        createdByUserId: actor?.type === "user" ? actor.userId ?? null : null,
        updatedByAgentId: actor?.type === "agent" ? actor.agentId ?? null : null,
        updatedByUserId: actor?.type === "user" ? actor.userId ?? null : null,
      })
      .returning()
      .then((rows) => rows[0] ?? null);
    if (!row) throw notFound("Failed to persist test run template");
    return toSpaceSkillTestRunTemplate(row);
  }

  async function updateTestRunTemplate(
    spaceId: string,
    templateId: string,
    input: SpaceSkillTestRunTemplateUpdateRequest,
    actor: SkillActor | null = null,
  ): Promise<SpaceSkillTestRunTemplate | null> {
    if (templateId === BUILT_IN_SKILL_TEST_RUN_TEMPLATE_ID) {
      throw unprocessable("Built-in test run templates are read-only.");
    }
    if (input.body !== undefined) {
      validateSkillTestTemplatePlaceholders(input.body);
    }
    const patch: Partial<typeof spaceSkillTestRunTemplates.$inferInsert> = {
      updatedAt: new Date(),
      updatedByAgentId: actor?.type === "agent" ? actor.agentId ?? null : null,
      updatedByUserId: actor?.type === "user" ? actor.userId ?? null : null,
    };
    if (input.name !== undefined) patch.name = input.name.trim();
    if (input.description !== undefined) patch.description = input.description?.trim() || null;
    if (input.body !== undefined) patch.body = input.body;
    const row = await db
      .update(spaceSkillTestRunTemplates)
      .set(patch)
      .where(and(
        eq(spaceSkillTestRunTemplates.spaceId, spaceId),
        eq(spaceSkillTestRunTemplates.id, templateId),
        isNull(spaceSkillTestRunTemplates.deletedAt),
      ))
      .returning()
      .then((rows) => rows[0] ?? null);
    return row ? toSpaceSkillTestRunTemplate(row) : null;
  }

  async function deleteTestRunTemplate(spaceId: string, templateId: string): Promise<SpaceSkillTestRunTemplate | null> {
    if (templateId === BUILT_IN_SKILL_TEST_RUN_TEMPLATE_ID) {
      throw unprocessable("Built-in test run templates are read-only.");
    }
    const row = await db
      .update(spaceSkillTestRunTemplates)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(spaceSkillTestRunTemplates.spaceId, spaceId),
        eq(spaceSkillTestRunTemplates.id, templateId),
        isNull(spaceSkillTestRunTemplates.deletedAt),
      ))
      .returning()
      .then((rows) => rows[0] ?? null);
    return row ? toSpaceSkillTestRunTemplate(row) : null;
  }

  async function resolveTestRunTemplateSnapshot(
    spaceId: string,
    input: SpaceSkillTestRunCreateRequest,
  ): Promise<SpaceSkillTestRunTemplateSnapshot | null> {
    if (input.templateSnapshot !== undefined) {
      const snapshot = input.templateSnapshot;
      if (!snapshot || snapshot.templateId === null) return null;
      validateSkillTestTemplatePlaceholders(snapshot.templateBody ?? "");
      return {
        templateId: snapshot.templateId,
        templateName: snapshot.templateName,
        templateBody: snapshot.templateBody,
      };
    }

    const templateId = input.templateId === undefined ? BUILT_IN_SKILL_TEST_RUN_TEMPLATE_ID : input.templateId;
    if (templateId === null) return null;
    if (templateId === BUILT_IN_SKILL_TEST_RUN_TEMPLATE_ID) {
      const template = builtInSkillTestRunTemplate(spaceId);
      return {
        templateId: template.id,
        templateName: template.name,
        templateBody: template.body,
      };
    }
    const row = await db
      .select()
      .from(spaceSkillTestRunTemplates)
      .where(and(
        eq(spaceSkillTestRunTemplates.spaceId, spaceId),
        eq(spaceSkillTestRunTemplates.id, templateId),
        isNull(spaceSkillTestRunTemplates.deletedAt),
      ))
      .then((rows) => rows[0] ?? null);
    if (!row) throw notFound("Test run template not found");
    return {
      templateId: row.id,
      templateName: row.name,
      templateBody: row.body,
    };
  }

  async function ensureRunSkillVersion(
    spaceId: string,
    skill: SpaceSkill,
    actor: SkillActor | null,
  ): Promise<SpaceSkillVersion> {
    const currentSnapshot = serializeVersionFileInventory(await collectVersionFileInventory(spaceId, skill));
    if (currentSnapshot.length === 0) {
      throw unprocessable("Cannot run a skill test for a skill with zero files.");
    }

    const currentVersion = skill.currentVersionId ? await getVersion(spaceId, skill.id, skill.currentVersionId) : null;
    if (!currentVersion || !versionInventorySnapshotEqual(currentVersion.fileInventory, currentSnapshot)) {
      return createVersion(spaceId, skill.id, { label: "Auto version for test run" }, actor);
    }
    return currentVersion;
  }

  function snapshotAgentConfig(agent: Awaited<ReturnType<typeof agents.getById>>) {
    if (!agent) return {};
    const adapterConfig = isPlainRecord(agent.adapterConfig) ? agent.adapterConfig : {};
    const runtimeConfig = isPlainRecord(agent.runtimeConfig) ? agent.runtimeConfig : {};
    return {
      agentId: agent.id,
      name: agent.name,
      role: agent.role,
      adapterType: agent.adapterType,
      model: asString(adapterConfig.model) ?? asString(runtimeConfig.model) ?? null,
      adapterConfig,
      runtimeConfig,
      assignedSkills: isPlainRecord(adapterConfig.outpostSkillSync)
        ? adapterConfig.outpostSkillSync
        : null,
      instructionsRef:
        asString(adapterConfig.instructionsFilePath) ??
        asString(adapterConfig.instructionsPath) ??
        asString(adapterConfig.instructionsRef) ??
        null,
    };
  }

  async function testRunCostByIssueIds(spaceId: string, issueIds: string[]) {
    if (issueIds.length === 0) return new Map<string, ReturnType<typeof emptyTestRunCost>>();
    const rows = await db
      .select({
        issueId: costEvents.issueId,
        costCents: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::double precision`,
        inputTokens: sql<number>`coalesce(sum(${costEvents.inputTokens}), 0)::int`,
        cachedInputTokens: sql<number>`coalesce(sum(${costEvents.cachedInputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${costEvents.outputTokens}), 0)::int`,
      })
      .from(costEvents)
      .where(and(eq(costEvents.spaceId, spaceId), inArray(costEvents.issueId, issueIds)))
      .groupBy(costEvents.issueId);
    return new Map(rows.flatMap((row) => row.issueId
      ? [[row.issueId, {
        costCents: Number(row.costCents ?? 0),
        inputTokens: Number(row.inputTokens ?? 0),
        cachedInputTokens: Number(row.cachedInputTokens ?? 0),
        outputTokens: Number(row.outputTokens ?? 0),
      }]]
      : []));
  }

  async function hydrateTestRuns(spaceId: string, rows: SpaceSkillTestRunRow[]): Promise<SpaceSkillTestRun[]> {
    const costByIssueId = await testRunCostByIssueIds(spaceId, rows.map((row) => row.issueId));
    return rows.map((row) => toSpaceSkillTestRun(
      row,
      costByIssueId.get(row.issueId) ?? emptyTestRunCost(),
      Boolean(row.harnessIssueDeletedAt),
    ));
  }

  async function createTestRun(
    spaceId: string,
    skillId: string,
    input: SpaceSkillTestRunCreateRequest,
    actor: SkillActor | null,
    deps: {
      createHarnessIssue: (issue: {
        id: string;
        title: string;
        description: string;
        assigneeAgentId: string;
        harnessKind: "skill_test";
        workMode: "skill_test";
        status: "todo";
        originKind: "skill_test";
        originId: string;
        originFingerprint: string;
      }) => Promise<{ id: string }>;
      wakeHarnessIssue: (issueId: string, agentId: string) => Promise<unknown>;
      cleanupHarnessIssue?: (issueId: string) => Promise<unknown>;
      retentionDays?: number;
    },
  ): Promise<SpaceSkillTestRun> {
    const skill = await getById(spaceId, skillId);
    if (!skill) throw notFound("Skill not found");
    const agent = await agents.getById(input.agentId);
    if (!agent || agent.spaceId !== spaceId) throw notFound("Agent not found");
    if (agent.status === "paused") throw unprocessable("Paused agents cannot run skill tests.");

    const sourceInput = input.inputId
      ? await db
        .select()
        .from(spaceSkillTestInputs)
        .where(and(
          eq(spaceSkillTestInputs.spaceId, spaceId),
          eq(spaceSkillTestInputs.skillId, skillId),
          eq(spaceSkillTestInputs.id, input.inputId),
          isNull(spaceSkillTestInputs.deletedAt),
        ))
        .then((rows) => rows[0] ?? null)
      : null;
    if (input.inputId && !sourceInput) throw notFound("Test input not found");
    const inputSnapshot = (sourceInput?.content ?? input.content ?? "").trim();
    if (!inputSnapshot) throw unprocessable("Test input content cannot be empty.");

    // Re-run pins the viewed run's version so the new run reproduces the same
    // snapshots; a plain run auto-snapshots the live head.
    const version = input.skillVersionId
      ? await getVersion(spaceId, skillId, input.skillVersionId)
      : await ensureRunSkillVersion(spaceId, skill, actor);
    if (!version) throw notFound("Skill version not found");
    const runId = randomUUID();
    const issueId = randomUUID();
    const outputDocumentKey = "output";
    const templateSnapshot = await resolveTestRunTemplateSnapshot(spaceId, input);
    const renderedTemplateBody = templateSnapshot?.templateBody
      ? renderSkillTestTemplate(templateSnapshot.templateBody, {
        skillName: skill.name,
        skillKey: skill.key,
        skillInvocation: skill.key,
        skillVersion: String(version.revisionNumber),
        runId,
        issueId,
        outputDocumentKey,
      }).trim()
      : null;
    const harnessIssueDescription = buildHarnessIssueDescription(inputSnapshot, renderedTemplateBody);
    await deps.createHarnessIssue({
      id: issueId,
      title: `Skill test: ${skill.name}`,
      description: harnessIssueDescription,
      assigneeAgentId: agent.id,
      harnessKind: "skill_test",
      workMode: "skill_test",
      status: "todo",
      originKind: "skill_test",
      originId: runId,
      originFingerprint: `skill_test:${runId}`,
    });

    const now = new Date();
    const retentionDays = Math.max(0, deps.retentionDays ?? 7);
    const previousExpiresAt = new Date(now.getTime() + retentionDays * 24 * 60 * 60 * 1000);
    const cleanupCreatedHarnessIssue = async () => {
      await deps.cleanupHarnessIssue?.(issueId).catch(() => {});
    };
    const row = await db.transaction(async (tx) => {
      await tx
        .update(spaceSkillTestRuns)
        .set({
          supersededAt: now,
          status: sql`
            case when ${spaceSkillTestRuns.status} in ('queued', 'running')
              then 'cancelled'
              else ${spaceSkillTestRuns.status}
            end
          `,
          error: sql`
            case when ${spaceSkillTestRuns.status} in ('queued', 'running')
              then coalesce(${spaceSkillTestRuns.error}, 'Superseded by newer run')
              else ${spaceSkillTestRuns.error}
            end
          `,
          harnessIssueExpiresAt: previousExpiresAt,
          updatedAt: now,
        })
        .where(and(
          eq(spaceSkillTestRuns.spaceId, spaceId),
          eq(spaceSkillTestRuns.skillId, skillId),
          sourceInput?.id
            ? eq(spaceSkillTestRuns.inputId, sourceInput.id)
            : isNull(spaceSkillTestRuns.inputId),
          isNull(spaceSkillTestRuns.supersededAt),
        ));
      return await tx
        .insert(spaceSkillTestRuns)
        .values({
          id: runId,
          spaceId,
          skillId,
          inputId: sourceInput?.id ?? null,
          inputSnapshot,
          skillVersionId: version.id,
          agentId: agent.id,
          agentConfigSnapshot: snapshotAgentConfig(agent),
          issueId,
          templateId: templateSnapshot?.templateId ?? null,
          templateName: templateSnapshot?.templateName ?? null,
          templateBody: templateSnapshot?.templateBody ?? null,
          renderedTemplateBody,
          harnessIssueDescription,
          status: "queued",
          outputDocumentKey,
        })
        .returning()
        .then((rows) => rows[0] ?? null);
    }).catch(async (error) => {
      await cleanupCreatedHarnessIssue();
      throw error;
    });
    if (!row) {
      await cleanupCreatedHarnessIssue();
      throw notFound("Failed to persist skill test run");
    }
    await deps.wakeHarnessIssue(issueId, agent.id);
    return (await hydrateTestRuns(spaceId, [row]))[0]!;
  }

  async function listTestRuns(
    spaceId: string,
    skillId: string,
    query: SpaceSkillTestRunListQuery = {},
  ): Promise<SpaceSkillTestRun[]> {
    const skill = await getById(spaceId, skillId);
    if (!skill) throw notFound("Skill not found");
    const conditions = [
      eq(spaceSkillTestRuns.spaceId, spaceId),
      eq(spaceSkillTestRuns.skillId, skillId),
      isNull(spaceSkillTestRuns.deletedAt),
    ];
    if (query.inputId) conditions.push(eq(spaceSkillTestRuns.inputId, query.inputId));
    const rows = await db
      .select()
      .from(spaceSkillTestRuns)
      .where(and(...conditions))
      .orderBy(desc(spaceSkillTestRuns.createdAt), desc(spaceSkillTestRuns.id));
    return hydrateTestRuns(spaceId, rows);
  }

  async function getTestRunDetail(spaceId: string, skillId: string, runId: string): Promise<SpaceSkillTestRunDetail | null> {
    const row = await db
      .select()
      .from(spaceSkillTestRuns)
      .where(and(
        eq(spaceSkillTestRuns.spaceId, spaceId),
        eq(spaceSkillTestRuns.skillId, skillId),
        eq(spaceSkillTestRuns.id, runId),
        isNull(spaceSkillTestRuns.deletedAt),
      ))
      .then((rows) => rows[0] ?? null);
    if (!row) return null;
    const [run] = await hydrateTestRuns(spaceId, [row]);
    if (!run) return null;
    const harnessIssueGone = Boolean(row.harnessIssueDeletedAt);
    const [version, issue, documentRows, interactionRows, attachmentRows, workProductRows] = await Promise.all([
      getVersionSummary(spaceId, skillId, row.skillVersionId),
      harnessIssueGone
        ? Promise.resolve(null)
        : db
          .select({
            id: issues.id,
            identifier: issues.identifier,
            title: issues.title,
            status: issues.status,
            hiddenAt: issues.hiddenAt,
          })
          .from(issues)
          .where(and(eq(issues.spaceId, spaceId), eq(issues.id, row.issueId)))
          .then((rows) => rows[0] ?? null),
      harnessIssueGone
        ? Promise.resolve([])
        : db
          .select(issueDocumentSelect)
          .from(issueDocuments)
          .innerJoin(documents, eq(issueDocuments.documentId, documents.id))
          .where(and(eq(issueDocuments.spaceId, spaceId), eq(issueDocuments.issueId, row.issueId)))
          .orderBy(asc(issueDocuments.key)),
      harnessIssueGone
        ? Promise.resolve([])
        : db
          .select({
            id: issueThreadInteractions.id,
            kind: issueThreadInteractions.kind,
            status: issueThreadInteractions.status,
            title: issueThreadInteractions.title,
            createdAt: issueThreadInteractions.createdAt,
            updatedAt: issueThreadInteractions.updatedAt,
          })
          .from(issueThreadInteractions)
          .where(and(eq(issueThreadInteractions.spaceId, spaceId), eq(issueThreadInteractions.issueId, row.issueId)))
          .orderBy(desc(issueThreadInteractions.createdAt)),
      harnessIssueGone
        ? Promise.resolve([])
        : db
          .select({
            id: issueAttachments.id,
            spaceId: issueAttachments.spaceId,
            issueId: issueAttachments.issueId,
            issueCommentId: issueAttachments.issueCommentId,
            assetId: issueAttachments.assetId,
            provider: assets.provider,
            objectKey: assets.objectKey,
            contentType: assets.contentType,
            byteSize: assets.byteSize,
            sha256: assets.sha256,
            originalFilename: assets.originalFilename,
            createdByAgentId: assets.createdByAgentId,
            createdByUserId: assets.createdByUserId,
            createdAt: issueAttachments.createdAt,
            updatedAt: issueAttachments.updatedAt,
          })
          .from(issueAttachments)
          .innerJoin(assets, eq(issueAttachments.assetId, assets.id))
          .where(and(eq(issueAttachments.spaceId, spaceId), eq(issueAttachments.issueId, row.issueId)))
          .orderBy(desc(issueAttachments.createdAt)),
      harnessIssueGone
        ? Promise.resolve([])
        : db
          .select()
          .from(issueWorkProducts)
          .where(and(eq(issueWorkProducts.spaceId, spaceId), eq(issueWorkProducts.issueId, row.issueId)))
          .orderBy(desc(issueWorkProducts.isPrimary), desc(issueWorkProducts.updatedAt)),
    ]);
    if (!version) throw notFound("Skill version not found");
    const harnessAvailable = !harnessIssueGone && issue !== null;
    const harnessDocuments: IssueDocument[] = harnessAvailable
      ? documentRows.map((doc) => ({
        ...mapIssueDocumentRow(doc, false),
        format: doc.format as IssueDocument["format"],
        body: doc.latestBody,
      }))
      : [];
    const harnessAttachments: IssueAttachment[] = harnessAvailable
      ? attachmentRows.map((attachment) => ({
        ...attachment,
        contentPath: `/api/attachments/${attachment.id}/content`,
        openPath: `/api/attachments/${attachment.id}/content`,
        downloadPath: `/api/attachments/${attachment.id}/content?download=1`,
      }))
      : [];
    const harnessWorkProducts = harnessAvailable ? workProductRows.map(toIssueWorkProduct) : [];
    const harnessContent: SpaceSkillTestRunHarnessContent = {
      available: harnessAvailable,
      unavailableReason: harnessAvailable
        ? null
        : harnessIssueGone
          ? (row.harnessIssueExpiresAt && row.harnessIssueDeletedAt && row.harnessIssueExpiresAt <= row.harnessIssueDeletedAt
            ? "expired"
            : "deleted")
          : "missing",
      documents: harnessDocuments,
      attachments: harnessAttachments,
      workProducts: harnessWorkProducts,
    };
    return {
      ...run,
      skillVersion: version,
      outputBody: run.outputSnapshot,
      harnessContent,
      harnessIssue: issue ? {
        id: issue.id,
        identifier: issue.identifier ?? null,
        title: issue.title,
        status: issue.status,
        hiddenAt: issue.hiddenAt ?? null,
      } : null,
      documents: harnessDocuments.map((doc) => ({
        key: doc.key,
        title: doc.title ?? null,
        updatedAt: doc.updatedAt,
        body: doc.body,
      })),
      interactions: interactionRows.map((interaction) => ({
        id: interaction.id,
        kind: interaction.kind,
        status: interaction.status,
        title: interaction.title ?? interaction.kind,
        createdAt: interaction.createdAt,
        updatedAt: interaction.updatedAt,
      })),
      artifacts: [
        ...harnessAttachments.map((attachment) => ({
          id: attachment.id,
          kind: "attachment" as const,
          title: attachment.originalFilename ?? "Attachment",
          summary: null,
          createdAt: attachment.createdAt,
        })),
        ...harnessWorkProducts.map((product) => ({
          id: product.id,
          kind: "work_product" as const,
          title: product.title,
          summary: product.summary ?? null,
          createdAt: product.createdAt,
        })),
      ].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime()),
    };
  }

  async function completeTestRunForIssue(input: {
    spaceId: string;
    issueId: string;
    outcome: "succeeded" | "failed" | "cancelled";
    error?: string | null;
  }): Promise<SpaceSkillTestRun | null> {
    const row = await db
      .select()
      .from(spaceSkillTestRuns)
      .where(and(
        eq(spaceSkillTestRuns.spaceId, input.spaceId),
        eq(spaceSkillTestRuns.issueId, input.issueId),
        isNull(spaceSkillTestRuns.deletedAt),
        isNull(spaceSkillTestRuns.supersededAt),
      ))
      .then((rows) => rows[0] ?? null);
    if (!row || ["succeeded", "failed", "cancelled"].includes(row.status)) return row
      ? (await hydrateTestRuns(input.spaceId, [row]))[0] ?? null
      : null;

    const outputDocumentKey = row.outputDocumentKey || "output";
    const outputDocument = await db
      .select({ body: documents.latestBody })
      .from(issueDocuments)
      .innerJoin(documents, and(eq(issueDocuments.documentId, documents.id), eq(documents.spaceId, input.spaceId)))
      .where(and(
        eq(issueDocuments.spaceId, input.spaceId),
        eq(issueDocuments.issueId, input.issueId),
        eq(issueDocuments.key, outputDocumentKey),
      ))
      .then((rows) => rows[0] ?? null);
    const updated = await db
      .update(spaceSkillTestRuns)
      .set({
        status: input.outcome,
        outputSnapshot: outputDocument?.body ?? row.outputSnapshot ?? "",
        error: input.error ?? null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(spaceSkillTestRuns.spaceId, input.spaceId),
        eq(spaceSkillTestRuns.id, row.id),
        inArray(spaceSkillTestRuns.status, ["queued", "running"]),
        isNull(spaceSkillTestRuns.deletedAt),
        isNull(spaceSkillTestRuns.supersededAt),
      ))
      .returning()
      .then((rows) => rows[0] ?? null);
    return updated ? (await hydrateTestRuns(input.spaceId, [updated]))[0] ?? null : null;
  }

  async function markTestRunRunning(spaceId: string, issueId: string): Promise<SpaceSkillTestRun | null> {
    const row = await db
      .update(spaceSkillTestRuns)
      .set({ status: "running", updatedAt: new Date() })
      .where(and(
        eq(spaceSkillTestRuns.spaceId, spaceId),
        eq(spaceSkillTestRuns.issueId, issueId),
        eq(spaceSkillTestRuns.status, "queued"),
        isNull(spaceSkillTestRuns.deletedAt),
        isNull(spaceSkillTestRuns.supersededAt),
      ))
      .returning()
      .then((rows) => rows[0] ?? null);
    return row ? (await hydrateTestRuns(spaceId, [row]))[0] ?? null : null;
  }

  async function cancelTestRun(
    spaceId: string,
    skillId: string,
    runId: string,
    deps: { cancelHarnessIssue: (issueId: string) => Promise<unknown> },
  ): Promise<SpaceSkillTestRun | null> {
    const existing = await db
      .select()
      .from(spaceSkillTestRuns)
      .where(and(
        eq(spaceSkillTestRuns.spaceId, spaceId),
        eq(spaceSkillTestRuns.skillId, skillId),
        eq(spaceSkillTestRuns.id, runId),
        isNull(spaceSkillTestRuns.deletedAt),
        isNull(spaceSkillTestRuns.supersededAt),
      ))
      .then((rows) => rows[0] ?? null);
    if (!existing) return null;
    if (["succeeded", "failed", "cancelled"].includes(existing.status)) {
      return (await hydrateTestRuns(spaceId, [existing]))[0] ?? null;
    }
    await deps.cancelHarnessIssue(existing.issueId);
    return completeTestRunForIssue({
      spaceId,
      issueId: existing.issueId,
      outcome: "cancelled",
      error: "Cancelled by operator",
    });
  }

  async function deleteTestRun(
    spaceId: string,
    skillId: string,
    runId: string,
    deps: { hideHarnessIssue: (issueId: string) => Promise<unknown> },
  ): Promise<SpaceSkillTestRun | null> {
    const existing = await db
      .select()
      .from(spaceSkillTestRuns)
      .where(and(
        eq(spaceSkillTestRuns.spaceId, spaceId),
        eq(spaceSkillTestRuns.skillId, skillId),
        eq(spaceSkillTestRuns.id, runId),
        isNull(spaceSkillTestRuns.deletedAt),
      ))
      .then((rows) => rows[0] ?? null);
    if (!existing) return null;
    // Only terminal runs are deletable — an in-flight run must be cancelled first
    // so we never orphan a live harness task.
    if (!["succeeded", "failed", "cancelled"].includes(existing.status)) {
      throw unprocessable("Cancel the run before deleting it.");
    }
    const now = new Date();
    const updated = await db.transaction(async (tx) => {
      return await tx
        .update(spaceSkillTestRuns)
        .set({ deletedAt: now, harnessIssueDeletedAt: existing.harnessIssueDeletedAt ?? now, updatedAt: now })
        .where(and(
          eq(spaceSkillTestRuns.spaceId, spaceId),
          eq(spaceSkillTestRuns.id, runId),
        ))
        .returning()
        .then((rows) => rows[0] ?? null);
    });
    // Hide the (already-terminal) harness task so the deleted run leaves nothing
    // dangling on the operator; best-effort, run row is the source of truth.
    if (!existing.harnessIssueDeletedAt) {
      await deps.hideHarnessIssue(existing.issueId).catch(() => {});
    }
    return updated ? (await hydrateTestRuns(spaceId, [updated]))[0] ?? null : null;
  }

  async function pruneExpiredTestHarnessIssues(spaceId: string, now = new Date()): Promise<{ pruned: number }> {
    const rows = await db
      .select({
        id: spaceSkillTestRuns.id,
        issueId: spaceSkillTestRuns.issueId,
      })
      .from(spaceSkillTestRuns)
      .where(and(
        eq(spaceSkillTestRuns.spaceId, spaceId),
        lt(spaceSkillTestRuns.harnessIssueExpiresAt, now),
        isNull(spaceSkillTestRuns.harnessIssueDeletedAt),
      ));
    for (const row of rows) {
      await db.transaction(async (tx) => {
        await notifyDeliveryWork(tx, DELIVERY_QUEUES.agentTimers);
        await tx
          .update(issues)
          .set({ hiddenAt: now, updatedAt: now })
          .where(and(eq(issues.spaceId, spaceId), eq(issues.id, row.issueId), eq(issues.harnessKind, "skill_test")));
        await tx
          .update(spaceSkillTestRuns)
          .set({ harnessIssueDeletedAt: now, updatedAt: now })
          .where(and(eq(spaceSkillTestRuns.spaceId, spaceId), eq(spaceSkillTestRuns.id, row.id)));
      });
    }
    return { pruned: rows.length };
  }

  async function prepareImportedSkillEditable(spaceId: string, skillId: string) {
    const skill = await getById(spaceId, skillId);
    if (!skill) throw conflict("The imported skill changed. Reload the source before keeping editable copies.");
    const version = await getCurrentVersion(skill);
    const recovery = `Cannot keep "${skill.name}" because its saved files are incomplete. Refresh the source before keeping editable copies, or choose Delete skills.`;
    if (!version) throw unprocessable(recovery);
    const files = await runtimeVersionInventory(spaceId, version);
    const savedPaths = new Set(files.map(file => file.path));
    const savedSkillPath = (relativePath: string) => version.repositorySnapshotId && version.repositorySkillPath
      ? `${REPOSITORY_CONTENT_DIR}/${path.posix.join(path.posix.dirname(version.repositorySkillPath), relativePath)}`
      : relativePath;
    if (!savedPaths.has("SKILL.md") || skill.fileInventory.some(file => !savedPaths.has(savedSkillPath(file.path)))) {
      throw unprocessable(recovery);
    }
    return { skill, files, candidate: await managedContent.prepare(spaceId, files) };
  }

  async function makeImportedSkillEditable(
    prepared: Awaited<ReturnType<typeof prepareImportedSkillEditable>>,
    actor: SkillActor, folderId: string | null, database: DbOrTransaction,
  ) {
    const { skill, files, candidate } = prepared;
    return managedSkillContent(database as Db, packageDb).publish(skill, candidate, {
      sourceType: "managed", sourceLocator: null, sourceRef: null, folderId,
      markdown: files.find(file => file.path === "SKILL.md")!.content,
      fileInventory: serializeFileInventory(files), trustLevel: deriveTrustLevel(files),
      metadata: { sourceKind: "managed",
        copiedFromRepository: { url: skill.sourceLocator, ref: skill.sourceRef, path: skill.metadata?.skillSourcePath },
        forkedByUserId: actor.type === "user" ? actor.userId ?? null : null,
        forkedByAgentId: actor.type === "agent" ? actor.agentId ?? null : null,
      },
    }, actor, { label: "Editable copy", validate: tx => visibility(tx).assertSkill(skill.spaceId, skill.id) });
  }

  async function deleteSkills(
    spaceId: string, skillIds: string[],
    onDelete?: (tx: DbTransaction, deleted: SpaceSkill[]) => Promise<void>,
    beforeDelete?: (tx: DbTransaction) => Promise<void>,
  ): Promise<SpaceSkill[]> {
    const initial = (await Promise.all([...new Set(skillIds)].sort().map(id => getById(spaceId, id))))
      .filter((skill): skill is SpaceSkill => Boolean(skill));
    async function assertUnused(skill: SpaceSkill, database: DbOrTransaction = db) {
      const usedByAgents = await usage(spaceId, skill.key, database);
      const pins = await protectedVersions(database as Db, spaceId, { createdAt: skill.createdAt });
      const versions = await database.select({ id: spaceSkillVersions.id }).from(spaceSkillVersions).where(and(
        eq(spaceSkillVersions.spaceId, spaceId), eq(spaceSkillVersions.spaceSkillId, skill.id)));
      if (pins.versions === null || versions.some(version => pins.versions!.has(version.id))) {
        throw unprocessable(`Cannot delete skill "${skill.name}" while an active or recovering run may still need it.`,
          { skillId: skill.id, skillKey: skill.key });
      }
      if (usedByAgents.length === 0) return;
      throw unprocessable(
        `Cannot delete skill "${skill.name}" while it is still used by ${usedByAgents.map(agent => agent.name).sort().join(", ")}. Detach it from those agents first.`,
        { skillId: skill.id, skillKey: skill.key, usedByAgents: usedByAgents.map(({ id, name, urlKey, adapterType }) => ({ id, name, urlKey, adapterType })) },
      );
    }
    for (const skill of initial) await assertUnused(skill);
    const managedRoot = resolveManagedSkillsRoot(spaceId);
    const moved: Array<{ source: string; quarantine: string }> = [];
    async function restoreSources() {
      for (const item of moved.reverse()) await fs.rename(item.quarantine, item.source);
      moved.length = 0;
    }
    async function withCacheLocks(index: number): Promise<SpaceSkill[]> {
      if (index < initial.length) {
        if (initial[index]!.sourceType === "managed") return withCacheLocks(index + 1);
        let result: SpaceSkill[] = [];
        await removeRuntimeSkillCache(managedRoot, initial[index]!.id, async () => { result = await withCacheLocks(index + 1); });
        return result;
      }
      try {
        return await db.transaction(async tx => {
          await notifyDeliveryWork(tx, DELIVERY_QUEUES.skillPackages);
          if (initial.length) await notifySkillVersionRetention(tx, spaceId);
          await beforeDelete?.(tx);
          const deleted: SpaceSkill[] = [];
          for (const before of initial) {
            await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${spaceId}:${before.slug}`}, 0))`);
            const skill = await getById(spaceId, before.id, tx);
            if (!skill) continue;
            if (skill.slug !== before.slug) throw conflict("Skill changed during deletion. Retry the request.");
            await assertUnused(skill, tx);
            if (skill.sourceType !== "managed") {
              await fs.rm(resolveRuntimeSkillMaterializedPath(spaceId, skill), { recursive: true, force: true });
            }
            if (isOutpostManagedRenameTarget(skill)) {
              const source = normalizeSkillDirectory(skill)!;
              const stat = await fs.lstat(source).catch((error: NodeJS.ErrnoException) => {
                if (error.code === "ENOENT") return null;
                throw error;
              });
              if (stat) {
                const quarantineRoot = path.join(managedRoot, ".deleted");
                await fs.mkdir(quarantineRoot, { recursive: true });
                const quarantine = path.join(quarantineRoot, `${skill.id}-${randomUUID()}`);
                await fs.rename(source, quarantine);
                moved.push({ source, quarantine });
              }
            }
            await tx.delete(spaceSkills).where(and(eq(spaceSkills.id, skill.id), eq(spaceSkills.spaceId, spaceId)));
            deleted.push(skill);
          }
          await onDelete?.(tx, deleted);
          return deleted;
        });
      } catch (error) {
        await restoreSources();
        throw error;
      }
    }
    let deleted: SpaceSkill[];
    try { deleted = await withSkillVersionCacheLock(db, spaceId, () => withCacheLocks(0)); }
    catch (error) { await restoreSources(); throw error; }
    for (const item of moved) {
      await fs.rm(item.quarantine, { recursive: true, force: true }).catch(error => {
        logger.warn({ err: error, spaceId }, "Skill deleted; quarantined source cleanup failed");
      });
    }
    return deleted;
  }

  async function deleteSkill(spaceId: string, skillId: string,
    onDelete?: (tx: DbTransaction, deleted: SpaceSkill[]) => Promise<void>,
    beforeDelete?: (tx: DbTransaction) => Promise<void>): Promise<SpaceSkill | null> {
    return (await deleteSkills(spaceId, [skillId], onDelete, beforeDelete))[0] ?? null;
  }

  return {
    list,
    listFull,
    getById,
    getByKey,
    getByRouteRef,
    resolveRequestedSkillKeys: async (spaceId: string, requestedReferences: string[]) => {
      const skills = await listFull(spaceId);
      return resolveRequestedSkillKeysOrThrow(skills, requestedReferences);
    },
    resolveRequestedSkillEntries: async (
      spaceId: string,
      requestedSelections: Array<string | AgentDesiredSkillEntry>,
      options?: { tolerateUnknownReferences?: boolean },
    ) => {
      const skills = await listFull(spaceId);
      return resolveRequestedSkillEntriesOrThrow(db, spaceId, skills, requestedSelections, options);
    },
    categoryCounts,
    detail,
    forkPrecheck,
    listVersions,
    getVersion,
    createVersion,
    starSkill,
    unstarSkill,
    listComments,
    createComment,
    updateComment,
    deleteComment,
    forkSkill,
    renameSkill,
    updateStatus,
    readFile,
    updateSkill,
    updateFile,
    deleteFile,
    createLocalSkill,
    deleteSkill,
    deleteSkills,
    makeImportedSkillEditable,
    prepareImportedSkillEditable,
    listTestInputs,
    createTestInput,
    updateTestInput,
    deleteTestInput,
    listTestRunTemplates,
    createTestRunTemplate,
    updateTestRunTemplate,
    deleteTestRunTemplate,
    createTestRun,
    listTestRuns,
    getTestRunDetail,
    completeTestRunForIssue,
    markTestRunRunning,
    cancelTestRun,
    deleteTestRun,
    pruneExpiredTestHarnessIssues,
    importFromSource,
    captureLegacyInstallation,
    browseProjectWorkspace,
    scanProjectWorkspaces,
    importPackageFiles,
    auditSkill,
    installUpdate,
    listRuntimeSkillEntries,
    withRuntimeSkillEntries,
  };
}
