import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { OUTPOST_RUNNERD_BUILD_METADATA_SCHEMA } from "./build-metadata.js";
import {
  OutpostRunnerdArtifactError,
  parseOutpostRunnerdBuildMetadata,
  resolveOutpostRunnerdArtifact,
} from "./runnerd-artifact.js";

const valid = {
  schema: OUTPOST_RUNNERD_BUILD_METADATA_SCHEMA,
  binaryName: "outpost-runnerd",
  packageName: "@outpost/outpost-runner",
  packageVersion: "0.0.0",
  binaryContractVersion: 2,
  nativeExecutionVersion: 1,
  harnessDriverVersion: 1,
  orp: { name: "outpost.runner", minimumVersion: 1, maximumVersion: 1 },
};

describe("runnerd artifact metadata", () => {
  it("parses the exact runnerd identity", () => {
    expect(parseOutpostRunnerdBuildMetadata(valid)).toEqual(valid);
  });

  it("accepts private host-control metadata without changing artifact admission", () => {
    expect(parseOutpostRunnerdBuildMetadata({ ...valid, privateHostControlVersion: 1 })).toEqual(valid);
  });

  it("rejects an unknown binary metadata schema", () => {
    expect(() => parseOutpostRunnerdBuildMetadata({ ...valid, schema: "runnerd/v2" }))
      .toThrow(OutpostRunnerdArtifactError);
  });

  it("rejects an invalid or mismatched explicit artifact digest before execution", async () => {
    await expect(resolveOutpostRunnerdArtifact({
      executablePath: "/does/not/matter",
      expectedSha256: "not-a-digest",
    })).rejects.toMatchObject({ issue: "digest_invalid" });

    const root = await mkdtemp(join(tmpdir(), "outpost-runnerd-artifact-"));
    const executablePath = join(root, "outpost-runnerd");
    try {
      await writeFile(executablePath, "not the expected binary");
      await expect(resolveOutpostRunnerdArtifact({
        executablePath,
        expectedSha256: `sha256:${"0".repeat(64)}`,
      })).rejects.toMatchObject({ issue: "digest_mismatch" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
