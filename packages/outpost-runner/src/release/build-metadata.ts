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
export const OUTPOST_RUNNERD_BUILD_METADATA_SCHEMA =
  "outpost-runner/runnerd-build-metadata/v1" as const;

export const OUTPOST_RUNNER_SEMANTIC_CATALOG_SHA256 =
  `sha256:${createHash("sha256")
    .update(canonicalCapabilitySemanticCatalog())
    .digest("hex")}` as const;

/** App-owned release metadata shared by build and artifact verification. */
export const OUTPOST_RUNNER_BUILD_METADATA = Object.freeze({
  schema: OUTPOST_RUNNER_BUILD_METADATA_SCHEMA,
  package: Object.freeze({
    name: OUTPOST_RUNNER_COMPATIBILITY.packageName,
    version: OUTPOST_RUNNER_COMPATIBILITY.packageVersion,
  }),
  contracts: Object.freeze({
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

export type OutpostRunnerBuildMetadata = typeof OUTPOST_RUNNER_BUILD_METADATA;
