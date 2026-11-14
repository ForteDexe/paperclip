import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { runnerApiCatalog, searchRunnerApi } from "../services/native-runtime/runner-api-catalog.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

// An agent asked to turn on a space model service cannot do it and must link the page that holds the control.
// The general /space/settings page has none of these sections, so the catalog names the Connections page.
it.each([
  ["fast response feature", "/api/spaces/{spaceId}/fast-response", "Fast response"],
  ["space settings page fast responses web UI", "/api/spaces/{spaceId}/fast-response", "Fast response"],
  ["decision model settings", "/api/spaces/{spaceId}/decision-model", "Decision model"],
  ["prompt injection prevention settings", "/api/spaces/{spaceId}/prompt-injection-prevention", "Prompt Injection Prevention"],
])("search %j returns the settings page that holds the %s control", (query, path, section) => {
  const operation = searchRunnerApi({ query, limit: 10 }).results.find(row => row.path === path && row.method === "PUT");
  expect(operation, query).toBeDefined();
  expect(operation!.description).toContain(`${section} section of the space-prefixed /space/settings/connections page`);
  expect(operation!.description).toContain("/<prefix>/space/settings/connections");
});

it("names the experiment that hides the Fast response section", () => {
  const operation = searchRunnerApi({ query: "fast response", limit: 10 }).results.find(row => row.operationId === "GET /api/spaces/{spaceId}/fast-response");
  expect(operation?.description).toContain("/<prefix>/space/settings/instance/experimental");
});

// The catalog text is the only place these page paths live on the server, so a renamed UI route
// would leave agents linking a page that no longer exists. Every page the guidance names must be
// a route the operator UI mounts under the space prefix.
it("names only pages that the operator UI mounts", () => {
  const appRoutes = readFileSync(path.join(repoRoot, "ui/src/App.tsx"), "utf8");
  const pages = new Set(
    runnerApiCatalog()
      .filter(row => /^\/api\/spaces\/\{spaceId\}\/(fast-response|decision-model|prompt-injection-prevention)/.test(row.path))
      .flatMap(row => [...(row.description ?? "").matchAll(/\/<prefix>\/([a-z0-9/-]+)/g)].map(match => match[1]!)),
  );
  expect([...pages].sort()).toEqual(["space/settings/connections", "space/settings/instance/experimental"]);
  for (const page of pages) expect(appRoutes, page).toContain(`<Route path="${page}" element=`);
});
