import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import {
  checkForbiddenImports,
  defaultPackageRoot,
  findSpecifiers,
} from "./lib/forbidden-imports.mjs";

test("the package passes its standalone boundary", async () => {
  assert.deepEqual(await checkForbiddenImports(), []);
});

test("a negative fixture proves that a core import is rejected", async () => {
  const violations = await checkForbiddenImports({
    scanRoots: ["test-fixtures/forbidden-import"],
    cargoRoots: [],
    checkManifest: false,
  });

  assert.equal(violations.length, 1);
  assert.equal(violations[0].specifier, "../../../../server/src/services/heartbeat.js");
  assert.match(violations[0].reason, /may not escape/);
  assert.ok(violations[0].file.startsWith(defaultPackageRoot));
});

test("a negative Cargo fixture proves that a core path dependency is rejected", async () => {
  const violations = await checkForbiddenImports({
    scanRoots: [],
    cargoRoots: ["test-fixtures/forbidden-cargo-path"],
    checkManifest: false,
  });

  assert.equal(violations.length, 1);
  assert.equal(violations[0].specifier, "../../../../server");
  assert.match(violations[0].reason, /Cargo path dependencies may not escape/);
  assert.ok(violations[0].file.startsWith(defaultPackageRoot));
});

test("a negative fixture proves that a browser UI runtime import is rejected", async () => {
  const violations = await checkForbiddenImports({
    scanRoots: ["devtools/browser", "test-fixtures/forbidden-ui-runtime/devtools/browser"],
    cargoRoots: [],
    checkManifest: false,
  });

  assert.equal(violations.length, 1);
  assert.equal(violations[0].specifier, "@ai-sdk/react");
  assert.match(violations[0].reason, /adapts component source/);
  assert.ok(violations[0].file.startsWith(defaultPackageRoot));
});

test("a negative fixture proves that an SDK consumer deep import is rejected", async () => {
  const violations = await checkForbiddenImports({
    scanRoots: ["test-fixtures/forbidden-sdk-consumer/examples"],
    cargoRoots: [],
    checkManifest: false,
  });

  assert.equal(violations.length, 1);
  assert.match(violations[0].reason, /may not deep-import/);
});

test("the parser ignores embedded fixtures but preserves executable imports and types", () => {
  const source = [
    '// import "comment";',
    '/* export * from "comment-export"; */',
    'const fixture = "import value from \\"fixture\\"";',
    'const template = `require("fixture-require"); import("fixture-dynamic")`;',
    'const pattern = /import\\("fixture-regex"\\)/;',
    'import "side-effect";',
    'import type { T } from "types";',
    'export { value } from "barrel";',
    'export * from "star";',
    'import equal = require("equal");',
    'type Imported = import("import-type").T;',
    'const cjs = require("cjs");',
    'const dynamic = import("dynamic", { with: { type: "json" } });',
    'const literal = import(`static-template`);',
    'const escaped = import("escaped\\u002dname");',
    'const interpolation = `text ${import("executed-interpolation")}`;',
  ].join("\n");
  const found = findSpecifiers(source);
  assert.deepEqual(found.map(({ specifier }) => specifier), [
    "side-effect", "types", "barrel", "star", "equal", "import-type", "cjs",
    "dynamic", "static-template", "escaped-name", "executed-interpolation",
  ]);
  assert.deepEqual(found.map(({ offset }) => source.slice(0, offset).split("\n").length),
    [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
});

test("the parser treats JSX fixture text separately from expression imports", () => {
  assert.deepEqual(findSpecifiers(
    '<div title={\'import("fixture")\'}>require("text") {import("executed")}</div>',
    "fixture.tsx",
  ).map(({ specifier }) => specifier), ["executed"]);
});

test("Rust include macros and path modules retain their boundary checks", () => {
  assert.deepEqual(findSpecifiers([
    'include!("../included.rs");',
    'include_str!("../text.txt");',
    'include_bytes!("../bytes.bin");',
    '#[path = "../module.rs"] mod module;',
  ].join("\n"), "source.rs").map(({ specifier }) => specifier),
  ["../included.rs", "../text.txt", "../bytes.bin", "../module.rs"]);
});

async function fixtureBoundary(t, { manifest = {}, files = {} } = {}) {
  const root = await mkdtemp(resolve(tmpdir(), "runner-import-boundary-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(resolve(root, "src"), { recursive: true });
  await writeFile(resolve(root, "package.json"), JSON.stringify(manifest));
  for (const [file, source] of Object.entries(files)) {
    await mkdir(dirname(resolve(root, file)), { recursive: true });
    await writeFile(resolve(root, file), source);
  }
  return checkForbiddenImports({ packageRoot: root, scanRoots: ["src"], cargoRoots: [] });
}

const publicManifest = { exports: { "./testing": "./dist/testing.js" } };

test("only exact declared public subpaths are admitted", async (t) => {
  const violations = await fixtureBoundary(t, {
    manifest: publicManifest,
    files: { "src/consumer.ts": [
      'import "@outpost/outpost-runner/testing";',
      'import "@outpost/outpost-runner/testing/private";',
      'import "@outpost/outpost-runner/undeclared";',
    ].join("\n") },
  });
  assert.deepEqual(violations.map(({ specifier }) => specifier), [
    "@outpost/outpost-runner/testing/private", "@outpost/outpost-runner/undeclared",
  ]);
});

test("workspace development dependencies require explicit review", async (t) => {
  const violations = await fixtureBoundary(t, {
    manifest: { ...publicManifest, devDependencies: { "@outpost/private-helper": "workspace:*" } },
  });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].specifier, "@outpost/private-helper");
});
