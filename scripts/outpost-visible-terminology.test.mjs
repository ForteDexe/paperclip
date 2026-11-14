import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { excludedTerminologyPath, findForbiddenInText } from "./outpost-visible-terminology.mjs";

test("terminology checker catches forbidden active presentation copy", () => {
  const hits = findForbiddenInText("ui/src/Fake.tsx", "Ask the CEO to hire an employee who reports to the CTO");
  assert.deepEqual(hits.map((hit) => hit.rule), ["executive-rank", "employment-language", "corporate-hierarchy"]);
});

test("terminology checker respects reviewed external attribution", () => {
  assert.deepEqual(
    findForbiddenInText("packages/shared/package.json", "https://github.com/paperclipai/paperclip"),
    [],
  );
});

test("terminology checker respects reviewed historical path exclusions", () => {
  assert.equal(excludedTerminologyPath("ui/storybook/stories/Legacy.stories.tsx")?.id, "design-archives");
  assert.equal(excludedTerminologyPath("packages/db/src/migrations/0001.sql")?.id, "generated-and-migrations");
});

test("representative UI surfaces use the shared presentation vocabulary", () => {
  for (const file of [
    "ui/src/components/Sidebar.tsx",
    "ui/src/components/Sidebar.production.tsx",
    "ui/src/pages/Spaces.tsx",
    "ui/src/pages/Goals.tsx",
    "ui/src/components/default-agent/DefaultAgentPresentation.tsx",
  ]) {
    const source = fs.readFileSync(file, "utf8");
    assert.match(source, /productLabel/);
  }
  for (const file of ["ui/src/components/Sidebar.tsx", "ui/src/components/Sidebar.production.tsx"]) {
    const sidebar = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(sidebar, /label="(?:Spaces|Tasks|Artifacts|Cases|North Stars|Decisions|Agents)"/);
  }
});
