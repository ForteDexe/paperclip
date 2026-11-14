import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  OUTPOST_RUNNERD_BUILD_METADATA_SCHEMA,
  OUTPOST_RUNNER_BUILD_METADATA,
} from "./build-metadata.js";

const execFileAsync = promisify(execFile);
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

async function readVerifiedBuildMetadata(
  bytes: Buffer,
  timeoutMs: number,
): Promise<string> {
  const stagingDirectory = await mkdtemp(join(tmpdir(), "outpost-runnerd-verified-"));
  const stagedExecutable = join(
    stagingDirectory,
    process.platform === "win32" ? "outpost-runnerd.exe" : "outpost-runnerd",
  );

  try {
    await chmod(stagingDirectory, 0o700);
    await writeFile(stagedExecutable, bytes, { flag: "wx", mode: 0o700 });
    await chmod(stagedExecutable, 0o700);
    const { stdout } = await execFileAsync(stagedExecutable, ["--build-metadata"], {
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 64 * 1024,
    });
    return stdout;
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }
}

export interface OutpostRunnerdBuildMetadata {
  schema: typeof OUTPOST_RUNNERD_BUILD_METADATA_SCHEMA;
  binaryName: "outpost-runnerd";
  packageName: "@outpost/outpost-runner";
  packageVersion: string;
  binaryContractVersion: number;
  nativeExecutionVersion: number;
  harnessDriverVersion: number;
  orp: {
    name: string;
    minimumVersion: number;
    maximumVersion: number;
  };
}

export interface OutpostRunnerdArtifact {
  executablePath: string;
  sha256: string;
  byteSize: number;
  buildMetadata: OutpostRunnerdBuildMetadata;
}

export class OutpostRunnerdArtifactError extends Error {
  readonly code = "outpost_runnerd_artifact_invalid" as const;

  constructor(
    message: string,
    readonly issue:
      | "path_invalid"
      | "digest_invalid"
      | "digest_mismatch"
      | "metadata_unavailable"
      | "metadata_invalid",
  ) {
    super(message);
    this.name = "OutpostRunnerdArtifactError";
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new OutpostRunnerdArtifactError(`${path} must be an object`, "metadata_invalid");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new OutpostRunnerdArtifactError(`${path} must be a non-empty string`, "metadata_invalid");
  }
  return value;
}

function version(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new OutpostRunnerdArtifactError(`${path} must be a positive integer`, "metadata_invalid");
  }
  return value as number;
}

/** Parse the runnerd response without accepting a look-alike binary. */
export function parseOutpostRunnerdBuildMetadata(
  value: unknown,
): OutpostRunnerdBuildMetadata {
  const metadata = record(value, "runnerd build metadata");
  if (metadata.schema !== OUTPOST_RUNNERD_BUILD_METADATA_SCHEMA) {
    throw new OutpostRunnerdArtifactError(
      `runnerd metadata schema ${String(metadata.schema)} is unsupported; expected ${OUTPOST_RUNNERD_BUILD_METADATA_SCHEMA}`,
      "metadata_invalid",
    );
  }
  if (metadata.binaryName !== "outpost-runnerd") {
    throw new OutpostRunnerdArtifactError(
      `runnerd metadata names unexpected binary ${String(metadata.binaryName)}`,
      "metadata_invalid",
    );
  }
  if (metadata.packageName !== OUTPOST_RUNNER_BUILD_METADATA.package.name) {
    throw new OutpostRunnerdArtifactError(
      `runnerd metadata names unexpected package ${String(metadata.packageName)}`,
      "metadata_invalid",
    );
  }
  const orp = record(metadata.orp, "runnerd build metadata.orp");
  const minimumVersion = version(
    orp.minimumVersion,
    "runnerd build metadata.orp.minimumVersion",
  );
  const maximumVersion = version(
    orp.maximumVersion,
    "runnerd build metadata.orp.maximumVersion",
  );
  if (minimumVersion > maximumVersion) {
    throw new OutpostRunnerdArtifactError(
      "runnerd build metadata.orp minimumVersion must not exceed maximumVersion",
      "metadata_invalid",
    );
  }
  return {
    schema: OUTPOST_RUNNERD_BUILD_METADATA_SCHEMA,
    binaryName: "outpost-runnerd",
    packageName: OUTPOST_RUNNER_BUILD_METADATA.package.name,
    packageVersion: text(metadata.packageVersion, "runnerd build metadata.packageVersion"),
    binaryContractVersion: version(
      metadata.binaryContractVersion,
      "runnerd build metadata.binaryContractVersion",
    ),
    nativeExecutionVersion: version(
      metadata.nativeExecutionVersion,
      "runnerd build metadata.nativeExecutionVersion",
    ),
    harnessDriverVersion: version(
      metadata.harnessDriverVersion,
      "runnerd build metadata.harnessDriverVersion",
    ),
    orp: {
      name: text(orp.name, "runnerd build metadata.orp.name"),
      minimumVersion,
      maximumVersion,
    },
  };
}

/**
 * Resolve one explicitly supplied runnerd artifact, verify its content digest,
 * and read version metadata from that exact executable. This never searches
 * PATH or the App source tree.
 */
export async function resolveOutpostRunnerdArtifact(input: {
  executablePath: string;
  expectedSha256: string;
  metadataTimeoutMs?: number;
}): Promise<OutpostRunnerdArtifact> {
  if (!SHA256_PATTERN.test(input.expectedSha256)) {
    throw new OutpostRunnerdArtifactError(
      "expectedSha256 must use the sha256:<64 lowercase hex> form",
      "digest_invalid",
    );
  }

  let executablePath: string;
  let fileStat: Awaited<ReturnType<typeof stat>>;
  let bytes: Buffer;
  try {
    executablePath = await realpath(input.executablePath);
    fileStat = await stat(executablePath);
    if (!fileStat.isFile()) throw new Error("path is not a file");
    bytes = await readFile(executablePath);
  } catch (error) {
    throw new OutpostRunnerdArtifactError(
      `runnerd artifact ${input.executablePath} is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      "path_invalid",
    );
  }

  const observedSha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (observedSha256 !== input.expectedSha256) {
    throw new OutpostRunnerdArtifactError(
      `runnerd artifact digest mismatch: expected ${input.expectedSha256}, observed ${observedSha256}`,
      "digest_mismatch",
    );
  }

  let stdout: string;
  try {
    stdout = await readVerifiedBuildMetadata(bytes, input.metadataTimeoutMs ?? 5_000);
  } catch (error) {
    throw new OutpostRunnerdArtifactError(
      `runnerd artifact did not return build metadata: ${error instanceof Error ? error.message : String(error)}`,
      "metadata_unavailable",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout) as unknown;
  } catch (error) {
    throw new OutpostRunnerdArtifactError(
      `runnerd build metadata is not JSON: ${error instanceof Error ? error.message : String(error)}`,
      "metadata_invalid",
    );
  }

  return {
    executablePath,
    sha256: observedSha256,
    byteSize: bytes.byteLength,
    buildMetadata: parseOutpostRunnerdBuildMetadata(parsed),
  };
}
