import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseSync, visitorKeys } from "oxc-parser";

export const ACTIVE_TERMINOLOGY_ROOTS = [
  "ui/src",
  "cli/src",
  "server/src",
  "packages",
  "skills",
  "integrations/assistant-plugins",
];

const TECHNICAL_IGNORED_PATH = /(?:^|\/)(?:node_modules|dist)(?:\/|$)/i;
const SOURCE_FILE = /\.[cm]?[jt]sx?$/i;
const MARKDOWN_FILE = /\.md$/i;

export const TERMINOLOGY_PATH_ALLOWLIST = Object.freeze([
  {
    id: "automated-tests-and-fixtures",
    path: /(?:^|\/)(?:fixtures|__tests__|tests?)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/i,
    reason: "Test corpus and preserved regression fixtures are migrated in focused test slices.",
  },
  {
    id: "generated-and-migrations",
    path: /(?:^|\/)(?:generated|migrations)(?:\/|$)/i,
    reason: "Generated output and historical schema records are not presentation surfaces.",
  },
  {
    id: "design-archives",
    path: /(?:^|\/)(?:storybook|artifact-directions)(?:\/|$)/i,
    reason: "Design experiments and archived presentation comparisons retain their recorded copy.",
  },
]);

export const TERMINOLOGY_ALLOWLIST = Object.freeze([
  {
    id: "upstream-attribution",
    path: /./,
    value: /(?:github\.com\/)?paperclipai\/paperclip/i,
    reason: "Genuine upstream repository attribution or release infrastructure.",
  },
  {
    id: "agent-companies-protocol",
    path: /(?:space-portability|agentcompanies|companies-spec)/i,
    value: /(?:agentcompanies\/v1|COMPANY\.md)/i,
    reason: "External Agent Companies protocol identifiers.",
  },
  {
    id: "external-companies-api",
    path: /composio-search-catalog\.json$/i,
    value: /thecompaniesapi/i,
    reason: "External Composio catalog key.",
  },
]);

export const FORBIDDEN_PRESENTATION_TERMS = Object.freeze([
  { id: "paperclip-product", pattern: /\bPaperclip\b/i },
  { id: "executive-rank", pattern: /\b(?:CEO|CTO|COO|chief executive|chief technology officer|chief operating officer|chief of staff)\b/i },
  { id: "employment-language", pattern: /\b(?:employee|employees|employer|employment|hire|hired|hiring|recruit|recruited|recruiting|workforce)\b/i },
  { id: "corporate-hierarchy", pattern: /\b(?:reports to|direct reports|organizational hierarchy|org chart)\b/i },
  { id: "corporate-boundary", pattern: /\b(?:company|corporation)\b/i },
  { id: "corporate-authority", pattern: /\b(?:board member|board user|governance|governed)\b/i },
]);

export const THEME_SENSITIVE_TERMS = Object.freeze([
  /\bOutposts?\b/g,
  /\bSpaces?\b/g,
  /\bDefault agents?\b/g,
  /\bNorth Stars?\b/g,
  /\bCampfires?\b/g,
  /\bRooms?\b/g,
  /\bTasks?\b/g,
  /\bDecisions?\b/g,
  /\bArtifacts?\b/g,
  /\bCases?\b/g,
]);

const normalizePath = (file) => file.replaceAll("\\", "/");

export function excludedTerminologyPath(file) {
  const normalized = normalizePath(file);
  if (TECHNICAL_IGNORED_PATH.test(normalized)) return { id: "technical-build-output", reason: "Dependency and build output." };
  return TERMINOLOGY_PATH_ALLOWLIST.find((entry) => entry.path.test(normalized)) ?? null;
}

function filesUnder(root) {
  if (!fs.existsSync(root)) return [];
  const result = [];
  const visit = (entry) => {
    for (const child of fs.readdirSync(entry, { withFileTypes: true })) {
      const file = path.join(entry, child.name);
      const normalized = normalizePath(file);
      if (excludedTerminologyPath(normalized)) continue;
      if (child.isDirectory()) visit(file);
      else if (SOURCE_FILE.test(file) || MARKDOWN_FILE.test(file)) result.push(file);
    }
  };
  visit(root);
  return result;
}

function lineAt(text, offset) {
  return text.slice(0, offset).split(/\r?\n/u).length;
}

export function visibleStrings(file, text) {
  if (MARKDOWN_FILE.test(file)) {
    return text.split(/\r?\n/u).map((value, index) => ({ value, line: index + 1 }));
  }
  if (!SOURCE_FILE.test(file)) return [];
  const source = parseSync(file, text).program;
  const values = [];
  const add = (value, start) => {
    if (typeof value === "string" && value.trim()) values.push({ value, line: lineAt(text, start) });
  };
  const visit = (node, parent = null) => {
    if (!node || typeof node !== "object" || typeof node.type !== "string") return;
    const moduleSpecifier = parent && ["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration", "ImportExpression"].includes(parent.type);
    if (!moduleSpecifier && (node.type === "Literal" || node.type === "StringLiteral")) add(node.value, node.start);
    else if (node.type === "TemplateElement") add(node.value?.raw, node.start);
    else if (node.type === "JSXText") add(text.slice(node.start, node.end), node.start);
    for (const key of visitorKeys[node.type] ?? []) {
      const child = node[key];
      if (Array.isArray(child)) child.forEach((entry) => visit(entry, node));
      else visit(child, node);
    }
  };
  visit(source);
  return values;
}

function matchingAllowlist(file, value, allowlist = TERMINOLOGY_ALLOWLIST) {
  const normalized = normalizePath(file);
  return allowlist.find((entry) => entry.path.test(normalized) && entry.value.test(value)) ?? null;
}

export function findForbiddenInText(file, value, allowlist = TERMINOLOGY_ALLOWLIST) {
  const allowed = matchingAllowlist(file, value, allowlist);
  if (allowed) return [];
  return FORBIDDEN_PRESENTATION_TERMS.flatMap((rule) => rule.pattern.test(value)
    ? [{ file: normalizePath(file), value, rule: rule.id }]
    : []);
}

export function scanTerminology({ roots = ACTIVE_TERMINOLOGY_ROOTS } = {}) {
  const forbidden = [];
  const bypasses = [];
  const allowlisted = [];
  for (const file of roots.flatMap(filesUnder)) {
    const text = fs.readFileSync(file, "utf8");
    for (const entry of visibleStrings(file, text)) {
      const allowed = matchingAllowlist(file, entry.value);
      if (allowed) {
        allowlisted.push({ file: normalizePath(file), line: entry.line, allowlist: allowed.id, reason: allowed.reason });
        continue;
      }
      for (const hit of findForbiddenInText(file, entry.value, [])) forbidden.push({ ...hit, line: entry.line });
      const matchedTerms = THEME_SENSITIVE_TERMS.flatMap((pattern) => [...entry.value.matchAll(pattern)].map((match) => match[0]));
      if (matchedTerms.length > 0 && !normalizePath(file).endsWith("packages/shared/src/product-vocabulary.ts")) {
        bypasses.push({ file: normalizePath(file), line: entry.line, terms: [...new Set(matchedTerms)] });
      }
    }
  }
  return { forbidden, bypasses, allowlisted };
}

function printReport(entries, max = 200) {
  for (const entry of entries.slice(0, max)) {
    console.log(`${entry.file}:${entry.line}  ${entry.terms.join(", ")}`);
  }
  if (entries.length > max) console.log(`… ${entries.length - max} additional occurrences omitted`);
}

export function runTerminology(mode = "check") {
  const result = scanTerminology();
  if (mode === "report") {
    console.log(`Hardcoded theme-sensitive presentation labels: ${result.bypasses.length}`);
    printReport(result.bypasses);
    console.log(`Reviewed external/attribution allowlist matches: ${result.allowlisted.length}`);
    return 0;
  }
  if (result.forbidden.length === 0) {
    console.log(`Terminology check passed. Reviewed allowlist matches: ${result.allowlisted.length}.`);
    return 0;
  }
  console.error(`Forbidden presentation terminology (${result.forbidden.length}):`);
  for (const hit of result.forbidden.slice(0, 200)) {
    console.error(`${hit.file}:${hit.line} [${hit.rule}] ${JSON.stringify(hit.value.trim())}`);
  }
  if (result.forbidden.length > 200) console.error(`… ${result.forbidden.length - 200} additional occurrences omitted`);
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = runTerminology(process.argv.includes("--report") ? "report" : "check");
}
