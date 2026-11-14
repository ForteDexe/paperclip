import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  OUTPOST_RUNNER_BUILD_METADATA,
  OUTPOST_RUNNERD_BUILD_METADATA_SCHEMA,
} from "./build-metadata.js";
import {
  OutpostRunnerEvalCompatibilityError,
  assertOutpostRunnerEvalCompatibility,
  type OutpostRunnerEvalCompatibilityRequirement,
} from "./compatibility.js";

function compatible(): OutpostRunnerEvalCompatibilityRequirement {
  return {
    consumer: "outpost-evals",
    packageVersion: OUTPOST_RUNNER_BUILD_METADATA.package.version,
    runnerd: {
      schema: OUTPOST_RUNNERD_BUILD_METADATA_SCHEMA,
      binaryName: "outpost-runnerd",
      packageName: "@outpost/outpost-runner",
      packageVersion: OUTPOST_RUNNER_BUILD_METADATA.package.version,
      binaryContractVersion: OUTPOST_RUNNER_BUILD_METADATA.contracts.runnerdArtifact,
      nativeExecutionVersion: 1,
      harnessDriverVersion: 1,
      orp: { name: "outpost.runner", minimumVersion: 1, maximumVersion: 1 },
    },
    nativeExecutionVersion: 1,
    orp: { minimumVersion: 1, maximumVersion: 1 },
    catalog: {
      version: OUTPOST_RUNNER_BUILD_METADATA.semanticCatalog.version,
      sha256: OUTPOST_RUNNER_BUILD_METADATA.semanticCatalog.sha256,
    },
    driver: {
      contractVersion: 1,
      requiredCapabilities: ["typedEvents", "interruption", "usage", "dynamicTools"],
      descriptor: {
        kind: "outpost-deterministic",
        displayName: "Deterministic",
        version: "1.0.0",
        protocolVersion: "orp.v1",
        capabilities: {
          resume: true,
          typedEvents: true,
          steering: false,
          interruption: true,
          structuredResult: true,
          usage: true,
          dynamicTools: true,
        },
      },
    },
  };
}

describe("Outpost Evals integration compatibility", () => {
  it("keeps build metadata synchronized with package semver", () => {
    const packageJson = JSON.parse(readFileSync(
      fileURLToPath(new URL("../../package.json", import.meta.url)),
      "utf8",
    ));
    expect(OUTPOST_RUNNER_BUILD_METADATA.package.version).toBe(packageJson.version);
  });

  it("negotiates package, binary, ORP, catalog, and driver V1", () => {
    expect(assertOutpostRunnerEvalCompatibility(compatible())).toMatchObject({
      schema: "outpost-runner/evals-integration/v1",
      consumer: "outpost-evals",
      negotiatedPrpVersion: 1,
      driverKind: "outpost-deterministic",
    });
  });

  it("fails closed with actionable codes for every independently versioned input", () => {
    const requirement = compatible();
    requirement.packageVersion = "9.0.0";
    requirement.runnerd.packageVersion = "8.0.0";
    requirement.runnerd.binaryContractVersion = 3;
    requirement.runnerd.nativeExecutionVersion = 2;
    requirement.runnerd.harnessDriverVersion = 2;
    requirement.nativeExecutionVersion = 2;
    const unsupportedVersion = OUTPOST_RUNNER_BUILD_METADATA.orp.maximumVersion + 1;
    requirement.orp = { minimumVersion: unsupportedVersion, maximumVersion: unsupportedVersion };
    requirement.runnerd.orp = { name: "outpost.runner", minimumVersion: unsupportedVersion, maximumVersion: unsupportedVersion };
    requirement.catalog = { version: 2, sha256: `sha256:${"0".repeat(64)}` };
    requirement.driver.contractVersion = 2;
    requirement.driver.descriptor.capabilities.dynamicTools = false;

    try {
      assertOutpostRunnerEvalCompatibility(requirement);
      throw new Error("expected compatibility failure");
    } catch (error) {
      expect(error).toBeInstanceOf(OutpostRunnerEvalCompatibilityError);
      expect((error as OutpostRunnerEvalCompatibilityError).issues.map((item) => item.code))
        .toEqual([
          "package_version_mismatch",
          "binary_package_version_mismatch",
          "binary_contract_version_mismatch",
          "native_execution_version_mismatch",
          "orp_version_no_overlap",
          "catalog_version_mismatch",
          "catalog_digest_mismatch",
          "driver_contract_version_mismatch",
          "driver_capability_unsupported",
        ]);
      expect((error as Error).message).toContain("runnerd was built for package 8.0.0");
    }
  });

  it("rejects a driver that does not speak the negotiated ORP version", () => {
    const requirement = compatible();
    requirement.driver.descriptor.protocolVersion = "orp.v2";

    expect(() => assertOutpostRunnerEvalCompatibility(requirement)).toThrow(
      expect.objectContaining({
        issues: [expect.objectContaining({ code: "driver_protocol_version_mismatch" })],
      }),
    );
  });
});
