import fs from "node:fs";
import path from "node:path";
import { parseSync, visitorKeys } from "oxc-parser";

const roots = ["ui/src", "cli/src", "server/src", "packages", "integrations/assistant-plugins"];
const ignored = /(?:^|[\\/])(?:node_modules|dist|generated|fixtures|__tests__|tests?|migrations)(?:[\\/]|$)|\.test\.[cm]?[jt]sx?$|\.spec\.[cm]?[jt]sx?$/;

function visibleTerminology(value) {
  return value
    .replace(/\bPaperclip\b/g, "Outpost")
    .replace(/X-Outpost/g, "X-Paperclip")
    .replace(/\bCompanies\b/g, "Outposts")
    .replace(/\bCompany\b/g, "Outpost")
    .replace(/\bCEOs\b/g, "Outpost Leads")
    .replace(/\bCEO\b/g, "Outpost Lead")
    .replace(/\bCTOs\b/g, "Engineering Leads")
    .replace(/\bCTO\b/g, "Engineering Lead")
    .replace(/\bGoals\b/g, "North Stars")
    .replace(/\bGoal\b/g, "North Star")
    .replace(/\bA Outpost\b/g, "An Outpost")
    .replace(/\ba Outpost\b/g, "an Outpost")
    .replace(/\bA Engineering Lead\b/g, "An Engineering Lead")
    .replace(/\ba Engineering Lead\b/g, "an Engineering Lead");
}

const sourceKind = (file) => /\.[cm]?[jt]sx?$/.test(file);

function filesUnder(root) {
  if (!fs.existsSync(root)) return [];
  const result = [];
  const visit = (entry) => {
    for (const child of fs.readdirSync(entry, { withFileTypes: true })) {
      const file = path.join(entry, child.name);
      if (ignored.test(file)) continue;
      if (child.isDirectory()) visit(file);
      else if (sourceKind(file)) result.push(file);
    }
  };
  visit(root);
  return result;
}

for (const file of roots.flatMap(filesUnder)) {
  const text = fs.readFileSync(file, "utf8");
  const source = parseSync(file, text).program;
  const edits = [];
  const add = (start, end) => {
    const before = text.slice(start, end);
    const after = visibleTerminology(before);
    if (after !== before) edits.push({ start, end, after });
  };
  const visit = (node, parent = null) => {
    if (!node || typeof node !== "object" || typeof node.type !== "string") return;
    const isModuleSpecifier = parent && ["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration", "ImportExpression"].includes(parent.type);
    if (!isModuleSpecifier && (node.type === "Literal" || node.type === "StringLiteral") && typeof node.value === "string") {
      add(node.start + 1, node.end - 1);
    } else if (node.type === "TemplateElement" && typeof node.value?.raw === "string") {
      const suffixLength = text.slice(node.end - 2, node.end) === "${" ? 2 : 1;
      add(node.start + 1, node.end - suffixLength);
    } else if (node.type === "JSXText") {
      add(node.start, node.end);
    }
    for (const key of visitorKeys[node.type] ?? []) {
      const child = node[key];
      if (Array.isArray(child)) child.forEach((entry) => visit(entry, node));
      else visit(child, node);
    }
  };
  visit(source);
  if (edits.length === 0) continue;
  let next = text;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    next = next.slice(0, edit.start) + edit.after + next.slice(edit.end);
  }
  fs.writeFileSync(file, next, "utf8");
}

function walkFiles(root, predicate) {
  if (!fs.existsSync(root)) return [];
  const result = [];
  const visit = (entry) => {
    for (const child of fs.readdirSync(entry, { withFileTypes: true })) {
      const file = path.join(entry, child.name);
      if (file.includes(`${path.sep}node_modules${path.sep}`) || ignored.test(file)) continue;
      if (child.isDirectory()) visit(file);
      else if (predicate(file)) result.push(file);
    }
  };
  visit(root);
  return result;
}

for (const file of ["README.md", "cli/README.md", ...walkFiles("packages", (name) => name.endsWith(".md")), ...walkFiles("server/src/onboarding-assets", (name) => name.endsWith(".md")), ...walkFiles("server/src/services/scripts", (name) => name.endsWith(".md")), ...walkFiles("integrations/assistant-plugins", (name) => name.endsWith(".md"))]) {
  if (file.endsWith("MIGRATION.md") || !fs.existsSync(file)) continue;
  const before = fs.readFileSync(file, "utf8");
  const after = visibleTerminology(before);
  if (after !== before) fs.writeFileSync(file, after, "utf8");
}

for (const file of walkFiles("integrations/assistant-plugins", (name) => name.endsWith(".json"))) {
  const before = fs.readFileSync(file, "utf8");
  const parsed = JSON.parse(before);
  const after = `${JSON.stringify(mapJsonStrings(parsed, visibleTerminology), null, 2)}\n`;
  if (after !== before) fs.writeFileSync(file, after, "utf8");
}

function mapJsonStrings(value, transform) {
  if (typeof value === "string") return transform(value);
  if (Array.isArray(value)) return value.map((entry) => mapJsonStrings(entry, transform));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, mapJsonStrings(entry, transform)]));
}

const appDefinitionTerminology = (value) => visibleTerminology(value)
  .replace(/\bOutpost\b(?= Domain\b)/g, "Company");
for (const file of walkFiles("packages/shared/src/app-definitions", (name) => name.endsWith(".json"))) {
  const before = fs.readFileSync(file, "utf8");
  const parsed = JSON.parse(before);
  const after = `${JSON.stringify(mapJsonStrings(parsed, appDefinitionTerminology), null, 2)}\n`;
  if (after !== before) fs.writeFileSync(file, after, "utf8");
}

for (const file of walkFiles("packages", (name) => path.basename(name) === "package.json")) {
  const before = fs.readFileSync(file, "utf8");
  const parsed = JSON.parse(before);
  if (typeof parsed.description === "string") parsed.description = visibleTerminology(parsed.description);
  if (parsed.author === "Paperclip") parsed.author = "Outpost";
  const after = `${JSON.stringify(parsed, null, 2)}\n`;
  if (after !== before) fs.writeFileSync(file, after, "utf8");
}
