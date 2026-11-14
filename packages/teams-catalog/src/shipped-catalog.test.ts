import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { catalogManifest, catalogTeams, resolveCatalogTeamRef } from "./index.js";
import { asBoolean, asString, parseFrontmatterMarkdown } from "./frontmatter.js";
import type { CatalogTeam } from "./types.js";

const EXPECTED_BUNDLED_KEYS = [
  "outpost/bundled/product/product-design",
  "outpost/bundled/software-development/product-engineering",
  "outpost/bundled/space-defaults/core-crew",
];

const EXPECTED_OPTIONAL_KEYS = [
  "outpost/optional/communications/speko-space-phone-agent",
  "outpost/optional/content/content-machine",
];

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("shipped teams catalog", () => {
  it("ships the expected bundled and optional team fixtures", () => {
    const bundledKeys = catalogTeams
      .filter((team) => team.kind === "bundled")
      .map((team) => team.key)
      .sort();
    const optionalKeys = catalogTeams
      .filter((team) => team.kind === "optional")
      .map((team) => team.key)
      .sort();

    expect(bundledKeys).toEqual(EXPECTED_BUNDLED_KEYS);
    expect(optionalKeys).toEqual(EXPECTED_OPTIONAL_KEYS);
  });

  it("keeps every shipped team free of executable scripts and external sources in Phase B", () => {
    const risky = catalogTeams.filter(
      (team) => team.trustLevel === "scripts_executables" || team.trustLevel === "external_sources",
    );
    expect(risky, formatViolations("script-bearing or external-source teams require later security review", risky)).toEqual([]);
  });

  it("populates browse/search-relevant fields for every shipped team", () => {
    const issues: string[] = [];
    for (const team of catalogTeams) {
      if (team.compatibility !== "compatible") {
        issues.push(`${team.key} compatibility=${team.compatibility}`);
      }
      if (!team.description || team.description.length < 40) {
        issues.push(`${team.key} description must be at least 40 characters for catalog browse/search`);
      }
      if (team.recommendedForSpaceTypes.length === 0) {
        issues.push(`${team.key} must list recommendedForSpaceTypes`);
      }
      if (team.tags.length === 0) {
        issues.push(`${team.key} must list tags`);
      }
      if (team.rootAgentSlugs.length === 0) {
        issues.push(`${team.key} must list a root agent slug`);
      }
    }
    expect(issues).toEqual([]);
  });

  it("uses canonical outpost keys derived from kind/category/slug", () => {
    const violations: string[] = [];
    for (const team of catalogTeams) {
      const expectedKey = `outpost/${team.kind}/${team.category}/${team.slug}`;
      const expectedId = `outpost:${team.kind}:${team.category}:${team.slug}`;
      if (team.key !== expectedKey) violations.push(`${team.key} should be ${expectedKey}`);
      if (team.id !== expectedId) violations.push(`${team.id} should be ${expectedId}`);
    }
    expect(violations).toEqual([]);
  });

  it("exposes a stable manifest header for downstream consumers", () => {
    expect(catalogManifest.schemaVersion).toBe(1);
    expect(catalogManifest.packageName).toBe("@outpost/teams-catalog");
    expect(catalogTeams.length).toBe(EXPECTED_BUNDLED_KEYS.length + EXPECTED_OPTIONAL_KEYS.length);
  });

  it("resolves shipped teams by id, key, and unique slug", () => {
    const sample = catalogTeams.find((team) => team.key === "outpost/bundled/space-defaults/core-crew");
    expect(sample, "expected core-crew to ship in the bundled catalog").toBeDefined();
    if (!sample) return;

    expect(resolveCatalogTeamRef(sample.id)).toMatchObject({ key: sample.key });
    expect(resolveCatalogTeamRef(sample.key)).toMatchObject({ key: sample.key });
    expect(resolveCatalogTeamRef(sample.slug)).toMatchObject({ key: sample.key });
  });

  it("preserves shipped agent roles, reporting lines, and skill assignments", () => {
    const expected = {
      "core-crew/lead": { role: "lead", leadAgentId: null, skills: ["task-planning", "issue-triage"] },
      "core-crew/engineering-lead": { role: "engineering-manager", leadAgentId: "lead", skills: ["github-pr-workflow", "task-planning"] },
      "core-crew/qa": { role: "qa", leadAgentId: "engineering-lead", skills: ["qa-acceptance"] },
      "product-engineering/engineering-lead": { role: "engineering-manager", leadAgentId: null, skills: ["github-pr-workflow", "task-planning", "doc-maintenance"] },
      "product-engineering/qa": { role: "qa", leadAgentId: "engineering-lead", skills: ["qa-acceptance"] },
      "product-engineering/senior-coder": { role: "engineer", leadAgentId: "engineering-lead", skills: ["github-pr-workflow", "doc-maintenance"] },
      "product-design/ux-designer": { role: "designer", leadAgentId: null, skills: ["wireframe", "design-critique", "task-planning"] },
      "speko-space-phone-agent/speko-space-phone-agent": { role: "general", leadAgentId: null, skills: undefined },
      "content-machine/content-lead": { role: "content-strategist", leadAgentId: null, skills: ["content-calendar"] },
    };
    const observed: Record<string, unknown> = {};
    for (const team of catalogTeams) {
      for (const file of team.files.filter((entry) => entry.kind === "agent")) {
        const raw = fs.readFileSync(path.join(PACKAGE_DIR, team.path, file.path));
        const { frontmatter } = parseFrontmatterMarkdown(raw.toString("utf8"));
        observed[`${team.slug}/${frontmatter.slug}`] = {
          role: frontmatter.role,
          leadAgentId: frontmatter.leadAgentId,
          skills: frontmatter.skills,
        };
        // An edited role file must also regenerate its distributable manifest.
        expect(file.sizeBytes, `${team.key}/${file.path}`).toBe(raw.byteLength);
        expect(file.sha256, `${team.key}/${file.path}`).toBe(createHash("sha256").update(raw).digest("hex"));
      }
    }
    expect(observed).toEqual(expected);
  });

  it("declares a valid project for every shipped recurring task", () => {
    const issues: string[] = [];

    for (const team of catalogTeams) {
      for (const file of team.files.filter((entry) => entry.kind === "task")) {
        const absolutePath = path.join(PACKAGE_DIR, team.path, file.path);
        const parsed = parseFrontmatterMarkdown(fs.readFileSync(absolutePath, "utf8"));
        if (!asBoolean(parsed.frontmatter.recurring)) continue;

        const project = asString(parsed.frontmatter.project);
        if (!project) {
          issues.push(`${team.key}/${file.path} recurring task must declare a project`);
          continue;
        }
        if (!team.projectSlugs.includes(project)) {
          issues.push(`${team.key}/${file.path} project=${project} must match a team project`);
        }
      }
    }

    expect(issues).toEqual([]);
  });
});

function formatViolations(label: string, teams: CatalogTeam[]) {
  if (teams.length === 0) return label;
  const detail = teams.map((team) => `${team.key} (${team.trustLevel})`).join(", ");
  return `${label}: ${detail}`;
}
