#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const runnerRoot = path.join(repoRoot, "tests/runner-e2e");
const domainRoot = path.join(runnerRoot, "chat-catalog-domains");

function walk(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(target, files);
    else if (/\.(?:ts|json|yaml)$/.test(entry.name)) files.push(target);
  }
  return files;
}

function resolveLocal(from, specifier) {
  if (!specifier.startsWith(".")) return null;
  const stem = path.resolve(path.dirname(from), specifier.replace(/\.js$/, ".ts"));
  for (const candidate of [stem, `${stem}.ts`, path.join(stem, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const files = walk(runnerRoot);
const edges = new Map();
const importPattern = /(?:from\s*|import\s*\(|require\s*\()\s*["']([^"']+)["']/g;
for (const file of files.filter(candidate => candidate.endsWith(".ts"))) {
  const dependencies = [...readFileSync(file, "utf8").matchAll(importPattern)]
    .map(match => resolveLocal(file, match[1]))
    .filter(Boolean);
  edges.set(file, dependencies);
}

const descriptors = JSON.parse(readFileSync(path.join(runnerRoot, "chat-catalog-descriptors.json"), "utf8"));
// Only the active catalog is authoritative. Historical top-level tests must
// not keep retired domain implementations alive merely by importing them.
const roots = new Set();
const descriptorModules = [];
for (const descriptor of descriptors) {
  const module = path.resolve(runnerRoot, descriptor.modulePath.replace(/^\.\//, "").replace(/\.js$/, ".ts"));
  descriptorModules.push(module);
  roots.add(module);
  for (const source of descriptor.sourceFiles ?? []) roots.add(path.resolve(runnerRoot, source));
}

function closure(initial) {
  const reachable = new Set();
  const pending = [...initial];
  while (pending.length > 0) {
    const file = pending.pop();
    if (reachable.has(file)) continue;
    reachable.add(file);
    pending.push(...(edges.get(file) ?? []));
  }
  return reachable;
}

const productionReachable = closure(roots);
const domainTests = files.filter(file => file.startsWith(`${domainRoot}${path.sep}`) && /\.(?:test|spec)\.ts$/.test(file));
const retainedTests = domainTests.filter(test => (edges.get(test) ?? []).some(file =>
  productionReachable.has(file) && file.startsWith(`${domainRoot}${path.sep}`),
));
const reachable = closure([...roots, ...retainedTests]);

const domainFiles = files.filter(file => file.startsWith(`${domainRoot}${path.sep}`) && file.endsWith(".ts"));
const orphans = domainFiles.filter(file => !reachable.has(file)).map(file => path.relative(repoRoot, file).replaceAll(path.sep, "/"));
const missingDescriptorModules = descriptorModules.filter(file => !reachable.has(file));
process.stdout.write(`${JSON.stringify({ domainFiles: domainFiles.length, protected: domainFiles.length - orphans.length, missingDescriptorModules, orphans }, null, 2)}\n`);
