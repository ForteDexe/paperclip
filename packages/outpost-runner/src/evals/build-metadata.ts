import { createHash } from "node:crypto";

import { OUTPOST_RUNNER_COMPATIBILITY } from "../compatibility.js";
import {
  ORP_PROTOCOL_MIN_VERSION,
  ORP_PROTOCOL_NAME,
  ORP_PROTOCOL_VERSION,
} from "../protocol/replay-contract.js";
import { canonicalCapabilitySemanticCatalog } from "../semantic-tools/catalog.js";

export const OUTPOST_RUNNER_BUILD_METADATA_SCHEMA =
  "outpost-runner/build-metadata/v1" as const;
export const OUTPOST_RUNNER_NATIVE_EXECUTION_SCHEMA =
  "outpost-runner/native-execution/v1" as const;
export const OUTPOST_RUNNER_EVAL_INTEGRATION_SCHEMA =
  "outpost-runner/evals-integration/v1" as const;
export const OUTPOST_RUNNERD_BUILD_METADATA_SCHEMA =
  "outpost-runner/runnerd-build-metadata/v1" as const;

export const OUTPOST_RUNNER_SEMANTIC_CATALOG_SHA256 =
  `sha256:${createHash("sha256")
    .update(canonicalCapabilitySemanticCatalog())
    .digest("hex")}` as const;

/**
 * App-owned release metadata that Evals pins beside every native attempt.
 * Contract versions are independent from package semver so consumers can give
 * a precise mismatch instead of guessing from a package version.
 */
export const OUTPOST_RUNNER_BUILD_METADATA = Object.freeze({
  schema: OUTPOST_RUNNER_BUILD_METADATA_SCHEMA,
  package: Object.freeze({
    name: OUTPOST_RUNNER_COMPATIBILITY.packageName,
    version: OUTPOST_RUNNER_COMPATIBILITY.packageVersion,
  }),
  contracts: Object.freeze({
    evalIntegration: OUTPOST_RUNNER_COMPATIBILITY.components.evalIntegration,
    nativeExecution: OUTPOST_RUNNER_COMPATIBILITY.components.nativeExecution,
    runnerdArtifact: OUTPOST_RUNNER_COMPATIBILITY.components.runnerdBinary,
    orp: ORP_PROTOCOL_VERSION,
    semanticCatalog: OUTPOST_RUNNER_COMPATIBILITY.components.catalog,
    harnessDriver: OUTPOST_RUNNER_COMPATIBILITY.components.harnessDriver,
    controlPlaneAdapter: OUTPOST_RUNNER_COMPATIBILITY.components.controlPlaneAdapter,
    testkit: OUTPOST_RUNNER_COMPATIBILITY.components.testkit,
  }),
  orp: Object.freeze({
    name: ORP_PROTOCOL_NAME,
    minimumVersion: ORP_PROTOCOL_MIN_VERSION,
    maximumVersion: ORP_PROTOCOL_VERSION,
  }),
  semanticCatalog: Object.freeze({
    version: OUTPOST_RUNNER_COMPATIBILITY.components.catalog,
    sha256: OUTPOST_RUNNER_SEMANTIC_CATALOG_SHA256,
  }),
  runnerd: Object.freeze({
    binaryName: "outpost-runnerd" as const,
    metadataSchema: OUTPOST_RUNNERD_BUILD_METADATA_SCHEMA,
    digestAlgorithm: "sha256" as const,
  }),
});

export type PaperclipRunnerBuildMetadata = typeof OUTPOST_RUNNER_BUILD_METADATA;
