import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Static guard against the cross-tenant existence oracle.
 *
 * Route handlers that look a resource up by id and then call
 * `assertSpaceAccess(req, resource.spaceId)` leak resource existence
 * across tenants: missing ids return 404 while cross-tenant ids return 403,
 * letting any authenticated user enumerate other tenants' ids. The required
 * pattern (documented on `hasSpaceAccess` in routes/authz.ts) folds the
 * access check into the existence check:
 *
 *     const issue = await svc.getById(id);
 *     if (!issue || !hasSpaceAccess(req, issue.spaceId)) {
 *       res.status(404).json({ error: "Issue not found" });
 *       return;
 *     }
 *     assertSpaceAccess(req, issue.spaceId); // write paths only
 *
 * This test scans every route file and fails when it finds an
 * `assertSpaceAccess(req, <resource>.spaceId)` call that is not preceded
 * by a `hasSpaceAccess(req, <resource>.spaceId)` gate. Sites where the
 * spaceId comes from request input (params/body) rather than a looked-up
 * resource carry no oracle and belong on the allowlist below.
 */

const ROUTES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "routes");

// "<file>:<variable>" call sites where the spaceId is request input, not a
// discovered resource — no existence oracle to close. Add new entries only
// when the value cannot reveal whether a cross-tenant resource exists.
const REQUEST_INPUT_ALLOWLIST = new Set([
  "spaces.ts:target", // import target chosen by the caller (req.body.target)
  "plugins.ts:runContext", // run context supplied in the request body
]);

const GATE_LOOKBACK_LINES = 12;

function findUngatedSites() {
  const ungated: string[] = [];
  for (const file of readdirSync(ROUTES_DIR).filter((name) => name.endsWith(".ts"))) {
    if (file === "authz.ts") continue;
    const lines = readFileSync(join(ROUTES_DIR, file), "utf8").split("\n");
    lines.forEach((line, index) => {
      const match = line.match(/assertSpaceAccess\(req,\s*(\w+)\.spaceId\)/);
      if (!match) return;
      const variable = match[1];
      const lookback = lines
        .slice(Math.max(0, index - GATE_LOOKBACK_LINES), index)
        .join("\n");
      if (new RegExp(`hasSpaceAccess\\(req,\\s*${variable}\\.spaceId\\)`).test(lookback)) return;
      if (REQUEST_INPUT_ALLOWLIST.has(`${file}:${variable}`)) return;
      ungated.push(`${file}:${index + 1} (${variable}.spaceId)`);
    });
  }
  return ungated;
}

describe("cross-tenant existence oracle guard", () => {
  it("requires a hasSpaceAccess gate before assertSpaceAccess on looked-up resources", () => {
    const ungated = findUngatedSites();
    expect(
      ungated,
      "assertSpaceAccess on a looked-up resource without a hasSpaceAccess 404 gate "
        + "reintroduces the cross-tenant existence oracle (403 vs 404). "
        + "Apply the two-step pattern documented on hasSpaceAccess in routes/authz.ts, "
        + "or — only if the spaceId is request input — add the site to REQUEST_INPUT_ALLOWLIST. "
        + `Offending sites: ${ungated.join(", ")}`,
    ).toEqual([]);
  });

  it("keeps the allowlist free of stale entries", () => {
    const stale: string[] = [];
    for (const entry of REQUEST_INPUT_ALLOWLIST) {
      const [file, variable] = entry.split(":");
      const source = readFileSync(join(ROUTES_DIR, file!), "utf8");
      if (!new RegExp(`assertSpaceAccess\\(req,\\s*${variable}\\.spaceId\\)`).test(source)) {
        stale.push(entry);
      }
    }
    expect(stale, `Allowlist entries no longer present in the code: ${stale.join(", ")}`).toEqual([]);
  });
});
