import path from "node:path";
const PATH_SEGMENT_RE = /^[a-zA-Z0-9_-]+$/;
const FRIENDLY_PATH_SEGMENT_RE = /[^a-zA-Z0-9._-]+/g;
import {
  expandHomePrefix,
  resolveDefaultBackupDir as resolveSharedDefaultBackupDir,
  resolveDefaultEmbeddedPostgresDir as resolveSharedDefaultEmbeddedPostgresDir,
  resolveDefaultLogsDir as resolveSharedDefaultLogsDir,
  resolveDefaultSecretsKeyFilePath as resolveSharedDefaultSecretsKeyFilePath,
  resolveDefaultStorageDir as resolveSharedDefaultStorageDir,
  resolveHomeAwarePath,
  resolveOutpostConfigPathForInstance,
  resolveOutpostHomeDir,
  resolveOutpostInstanceId,
  resolveOutpostInstanceRoot,
} from "@outpost/shared/home-paths";

export {
  expandHomePrefix,
  resolveHomeAwarePath,
  resolveOutpostHomeDir,
  resolveOutpostInstanceId,
  resolveOutpostInstanceRoot,
};

export function resolveDefaultConfigPath(): string {
  return resolveOutpostConfigPathForInstance();
}

export function resolveDefaultEmbeddedPostgresDir(): string {
  return resolveSharedDefaultEmbeddedPostgresDir();
}

export function resolveDefaultLogsDir(): string {
  return resolveSharedDefaultLogsDir();
}

export function resolveDefaultSecretsKeyFilePath(): string {
  return resolveSharedDefaultSecretsKeyFilePath();
}

export function resolveDefaultStorageDir(): string {
  return resolveSharedDefaultStorageDir();
}

export function resolveDefaultBackupDir(): string {
  return resolveSharedDefaultBackupDir();
}

export function resolveDefaultAgentWorkspaceDir(agentId: string): string {
  const trimmed = agentId.trim();
  if (!PATH_SEGMENT_RE.test(trimmed)) {
    throw new Error(`Invalid agent id for workspace path '${agentId}'.`);
  }
  return path.resolve(resolveOutpostInstanceRoot(), "workspaces", trimmed);
}

function sanitizeFriendlyPathSegment(value: string | null | undefined, fallback = "_default"): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return fallback;
  const sanitized = trimmed
    .replace(FRIENDLY_PATH_SEGMENT_RE, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized || fallback;
}

/**
 * Resolve the managed checkout directory for one project:
 * `<instanceRoot>/projects/<spaceId>/<projectId>/<repoName|_default>`.
 *
 * Per-project directory isolation invariant: the `projectId` is a distinct path segment, so two
 * different projects always resolve to sibling directories under `<spaceId>/`. One project's
 * directory can never nest inside, or be a path prefix of, another project's directory. A run that
 * materializes several referenced projects can therefore place each in its own directory without
 * collision. See the "distinct, non-nested managed dirs" test in `heartbeat-project-env.test.ts`.
 */
export function resolveManagedProjectWorkspaceDir(input: {
  spaceId: string;
  projectId: string;
  repoName?: string | null;
}): string {
  const spaceId = input.spaceId.trim();
  const projectId = input.projectId.trim();
  if (!spaceId || !projectId) {
    throw new Error("Managed project workspace path requires spaceId and projectId.");
  }
  return path.resolve(
    resolveOutpostInstanceRoot(),
    "projects",
    sanitizeFriendlyPathSegment(spaceId, "space"),
    sanitizeFriendlyPathSegment(projectId, "project"),
    sanitizeFriendlyPathSegment(input.repoName, "_default"),
  );
}
