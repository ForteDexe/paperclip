import fs from "node:fs";
import {
  DEPLOYMENT_MODES,
  findOutpostConfigKeyWarnings,
  outpostConfigSchema,
  type OutpostConfig,
  type DeploymentMode,
} from "@outpost/shared";
import { ZodError } from "zod";
import { resolveOutpostConfigPath } from "./paths.js";
import { isCloudManagedInstance } from "./services/cloud-instance.js";
import { getCloudRuntimeConfigSnapshot, toOutpostConfig } from "./services/cloud-runtime-config-snapshot.js";

function formatConfigValidationError(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const issuePath = issue.path.length > 0 ? issue.path.join(".") : "<root>";
      return `${issuePath}: ${issue.message}`;
    })
    .join("; ");
}

interface ConfigFileWithProvenance {
  config: OutpostConfig;
  explicitStorageS3Bucket: boolean;
}

export function readConfigFile(options: { includeProvenance: true }): ConfigFileWithProvenance | null;
export function readConfigFile(): OutpostConfig | null;
export function readConfigFile(options?: { includeProvenance: true }): OutpostConfig | ConfigFileWithProvenance | null {
  if (isCloudManagedInstance()) {
    const saved = getCloudRuntimeConfigSnapshot().config;
    const config = toOutpostConfig(saved);
    // A stored snapshot is canonical configuration, including its bucket.
    // It must not inherit local-file provenance or inspect an old home.
    return config && options?.includeProvenance ? { config, explicitStorageS3Bucket: true } : config;
  }

  const configPath = resolveOutpostConfigPath();

  if (!fs.existsSync(configPath)) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid Outpost config at ${configPath}: failed to read or parse JSON: ${reason}`);
  }

  try {
    const config = outpostConfigSchema.parse(raw);
    for (const warning of findOutpostConfigKeyWarnings(config)) {
      console.warn(
        `Unknown config key ${warning.path}; did you mean ${warning.suggestion}? It will be preserved.`,
      );
    }
    if (options?.includeProvenance) {
      // Schema validation above establishes the input shape, but fills omitted
      // buckets with a default. Keep only that provenance at the file boundary.
      const input = raw as Partial<OutpostConfig>;
      return { config, explicitStorageS3Bucket: input.storage?.s3?.bucket !== undefined };
    }
    return config;
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(`Invalid Outpost config at ${configPath}: ${formatConfigValidationError(error)}`);
    }

    throw error;
  }
}

/** Resolve the same deployment mode without loading config.ts's dotenv/startup side effects. */
export function resolveDeploymentMode(fileConfig = readConfigFile()): DeploymentMode {
  const fromEnv = process.env.OUTPOST_DEPLOYMENT_MODE;
  return fromEnv && DEPLOYMENT_MODES.includes(fromEnv as DeploymentMode)
    ? fromEnv as DeploymentMode
    : fileConfig?.server.deploymentMode ?? "local_trusted";
}
