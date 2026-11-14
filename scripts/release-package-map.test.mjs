import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReleasePackagePlan,
  checkConfiguration,
  findUnpublishableWorkspaceEdges,
  getReleasePackages,
} from "./release-package-map.mjs";

function pkg(name, { publishFromCi, ...deps } = {}) {
  return { name, dir: name, publishFromCi, pkg: { name, ...deps } };
}

test("release package manifest covers all public packages with explicit CI enrollment", () => {
  const packages = buildReleasePackagePlan();
  assert.ok(packages.length > 0);
  assert.ok(packages.every((pkg) => typeof pkg.publishFromCi === "boolean"));
});

test("release package list only contains CI-enrolled packages", () => {
  const enabledPackages = getReleasePackages();
  assert.ok(enabledPackages.length > 0);
  assert.ok(enabledPackages.every((pkg) => pkg.publishFromCi === true));
});

test("release package list publishes the installable channel entrypoint last", () => {
  const enabledPackages = getReleasePackages();

  assert.equal(enabledPackages.at(-1)?.name, "paperclipai");
  assert.ok(enabledPackages.slice(0, -1).some((pkg) => pkg.name === "@outpost/server"));
});

test("release package list keeps runtime workspace dependencies ahead of consumers", () => {
  const enabledPackages = getReleasePackages();
  const publishIndexByName = new Map(enabledPackages.map((pkg, index) => [pkg.name, index]));

  for (const pkg of enabledPackages) {
    for (const section of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      for (const [dependencyName, spec] of Object.entries(pkg.pkg[section] ?? {})) {
        if (typeof spec !== "string" || !spec.startsWith("workspace:")) continue;
        const dependencyIndex = publishIndexByName.get(dependencyName);
        if (dependencyIndex === undefined) continue;

        assert.ok(
          dependencyIndex < publishIndexByName.get(pkg.name),
          `${dependencyName} must publish before ${pkg.name}`,
        );
      }
    }
  }
});

test("Hermes release surface publishes the unified built-in package and keeps gateway as a shim", () => {
  const packages = buildReleasePackagePlan();
  const hermes = packages.find((pkg) => pkg.name === "@outpost/hermes-outpost-adapter");
  const gatewayShim = packages.find((pkg) => pkg.name === "@outpost/adapter-hermes-gateway");

  assert.equal(hermes?.dir, "packages/adapters/hermes");
  assert.equal(hermes?.publishFromCi, true);
  assert.equal(gatewayShim?.dir, "packages/adapters/hermes-gateway");
  assert.equal(gatewayShim?.publishFromCi, false);
});

test("release package configuration validates successfully", () => {
  assert.doesNotThrow(() => checkConfiguration());
});

test("guard flags a publishFromCi:true package depending on a publishFromCi:false package", () => {
  const problems = findUnpublishableWorkspaceEdges([
    pkg("@outpost/server", {
      publishFromCi: true,
      dependencies: { "@outpost/skills-catalog": "workspace:*" },
    }),
    pkg("@outpost/skills-catalog", { publishFromCi: false }),
  ]);

  assert.equal(problems.length, 1);
  assert.match(problems[0], /@paperclipai\/server/);
  assert.match(problems[0], /@paperclipai\/skills-catalog/);
});

test("guard inspects optional and peer dependency sections too", () => {
  const problems = findUnpublishableWorkspaceEdges([
    pkg("@outpost/server", {
      publishFromCi: true,
      optionalDependencies: { "@outpost/opt": "workspace:^" },
      peerDependencies: { "@outpost/peer": "workspace:*" },
    }),
    pkg("@outpost/opt", { publishFromCi: false }),
    pkg("@outpost/peer", { publishFromCi: false }),
  ]);

  assert.equal(problems.length, 2);
});

test("guard treats a workspace dep on an unknown @paperclipai package as unpublishable", () => {
  const problems = findUnpublishableWorkspaceEdges([
    pkg("@outpost/server", {
      publishFromCi: true,
      dependencies: { "@outpost/private-internal": "workspace:*" },
    }),
  ]);

  assert.equal(problems.length, 1);
});

test("guard allows true->true workspace edges", () => {
  const problems = findUnpublishableWorkspaceEdges([
    pkg("@outpost/server", {
      publishFromCi: true,
      dependencies: { "@outpost/shared": "workspace:*" },
    }),
    pkg("@outpost/shared", { publishFromCi: true }),
  ]);

  assert.deepEqual(problems, []);
});

test("guard ignores non-workspace specs, non-internal deps, and edges from off-train packages", () => {
  const problems = findUnpublishableWorkspaceEdges([
    pkg("@outpost/server", {
      publishFromCi: true,
      dependencies: {
        "@outpost/pinned": "0.3.1",
        zod: "^3.0.0",
      },
    }),
    pkg("@outpost/pinned", { publishFromCi: false }),
    pkg("@outpost/offtrain", {
      publishFromCi: false,
      dependencies: { "@outpost/also-off": "workspace:*" },
    }),
    pkg("@outpost/also-off", { publishFromCi: false }),
  ]);

  assert.deepEqual(problems, []);
});

test("the live release manifest has no unpublishable workspace edges", () => {
  assert.deepEqual(findUnpublishableWorkspaceEdges(buildReleasePackagePlan()), []);
});
