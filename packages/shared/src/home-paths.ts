import os from "node:os";
import path from "node:path";

export const DEFAULT_OUTPOST_INSTANCE_ID = "default";
export const OUTPOST_CONFIG_BASENAME = "config.json";
export const OUTPOST_ENV_FILENAME = ".env";

const PATH_SEGMENT_RE = /^[a-zA-Z0-9_-]+$/;

export function expandHomePrefix(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.resolve(os.homedir(), value.slice(2));
  return value;
}

export function resolveOutpostHomeDir(homeOverride?: string): string {
  const raw = homeOverride?.trim() || process.env.OUTPOST_HOME?.trim();
  if (raw) return path.resolve(expandHomePrefix(raw));
  return path.resolve(os.homedir(), ".outpost");
}

export function resolveOutpostInstanceId(instanceIdOverride?: string): string {
  const raw = instanceIdOverride?.trim() || process.env.OUTPOST_INSTANCE_ID?.trim() || DEFAULT_OUTPOST_INSTANCE_ID;
  if (!PATH_SEGMENT_RE.test(raw)) {
    throw new Error(`Invalid OUTPOST_INSTANCE_ID '${raw}'.`);
  }
  return raw;
}

export function resolveOutpostInstanceRoot(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolveOutpostHomeDir(input.homeDir), "instances", resolveOutpostInstanceId(input.instanceId));
}

export function resolveOutpostInstanceConfigPath(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolveOutpostInstanceRoot(input), OUTPOST_CONFIG_BASENAME);
}

export function resolveOutpostConfigPathForInstance(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return resolveOutpostInstanceConfigPath(input);
}

export function resolveOutpostEnvPathForConfig(configPath: string): string {
  return path.resolve(path.dirname(configPath), OUTPOST_ENV_FILENAME);
}

export function resolveDefaultEmbeddedPostgresDir(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolveOutpostInstanceRoot(input), "db");
}

export function resolveDefaultLogsDir(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolveOutpostInstanceRoot(input), "logs");
}

export function resolveDefaultSecretsKeyFilePath(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolveOutpostInstanceRoot(input), "secrets", "master.key");
}

export function resolveDefaultStorageDir(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolveOutpostInstanceRoot(input), "data", "storage");
}

export function resolveDefaultBackupDir(input: {
  homeDir?: string;
  instanceId?: string;
} = {}): string {
  return path.resolve(resolveOutpostInstanceRoot(input), "data", "backups");
}

export function resolveHomeAwarePath(value: string): string {
  return path.resolve(expandHomePrefix(value));
}
