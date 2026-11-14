import { describe, expect, it } from "vitest";
import {
  catalogSkillFileDetailSchema,
  catalogSkillListQuerySchema,
  spaceSkillAuditResultSchema,
  spaceSkillInstallCatalogResultSchema,
  spaceSkillInstallCatalogSchema,
  spaceSkillInstallUpdateSchema,
  spaceSkillResetSchema,
  spaceSkillUpdateStatusSchema,
} from "./space-skill.js";

const catalogSkill = {
  id: "outpost:bundled:software-development:review",
  key: "outpost/bundled/software-development/review",
  kind: "bundled",
  category: "software-development",
  slug: "review",
  name: "review",
  description: "Review code",
  path: "catalog/bundled/software-development/review",
  entrypoint: "SKILL.md",
  trustLevel: "markdown_only",
  compatibility: "compatible",
  defaultInstall: false,
  recommendedForRoles: ["engineer"],
  requires: [],
  tags: ["review"],
  files: [{ path: "SKILL.md", kind: "skill", sizeBytes: 8, sha256: "abc" }],
  contentHash: "sha256:abc",
  source: {
    type: "github",
    hostname: "github.com",
    owner: "example",
    repo: "review-skill",
    ref: "v1.0.0",
    commit: "0123456789abcdef0123456789abcdef01234567",
    path: "skills/review",
    url: "https://github.com/example/review-skill/tree/v1.0.0/skills/review",
  },
};

const spaceSkill = {
  id: "00000000-0000-4000-8000-000000000001",
  spaceId: "00000000-0000-4000-8000-000000000002",
  key: catalogSkill.key,
  slug: catalogSkill.slug,
  name: catalogSkill.name,
  description: catalogSkill.description,
  markdown: "# Review\n",
  sourceType: "catalog",
  sourceLocator: "/tmp/review",
  sourceRef: catalogSkill.contentHash,
  trustLevel: "markdown_only",
  compatibility: "compatible",
  fileInventory: [{ path: "SKILL.md", kind: "skill" }],
  iconUrl: null,
  color: null,
  tagline: null,
  authorName: null,
  homepageUrl: null,
  categories: [],
  sharingScope: "private",
  publicShareToken: null,
  forkedFromSkillId: null,
  forkedFromSpaceId: null,
  starCount: 0,
  installCount: 1,
  forkCount: 0,
  currentVersionId: null,
  metadata: {
    sourceKind: "catalog",
    catalogId: catalogSkill.id,
    originHash: catalogSkill.contentHash,
  },
  createdAt: "2026-05-26T00:00:00.000Z",
  updatedAt: "2026-05-26T00:00:00.000Z",
};

describe("space skill catalog validators", () => {
  it("accepts catalog list and install request shapes", () => {
    expect(catalogSkillListQuerySchema.parse({
      kind: "bundled",
      category: "software-development",
      q: "review",
    })).toEqual({
      kind: "bundled",
      category: "software-development",
      q: "review",
    });

    expect(spaceSkillInstallCatalogSchema.parse({
      catalogSkillId: catalogSkill.id,
      slug: "team-review",
      force: true,
    })).toEqual({
      catalogSkillId: catalogSkill.id,
      slug: "team-review",
      force: true,
    });
  });

  it("rejects invalid catalog filter and install payloads", () => {
    expect(() => catalogSkillListQuerySchema.parse({ kind: "external" })).toThrow();
    expect(() => spaceSkillInstallCatalogSchema.parse({ force: true })).toThrow();
  });

  it("accepts catalog file and install result responses", () => {
    expect(catalogSkillFileDetailSchema.parse({
      catalogSkillId: catalogSkill.id,
      path: "SKILL.md",
      kind: "skill",
      content: "# Review\n",
      language: "markdown",
      markdown: true,
    })).toMatchObject({
      catalogSkillId: catalogSkill.id,
      path: "SKILL.md",
    });

    expect(spaceSkillInstallCatalogResultSchema.parse({
      action: "created",
      skill: spaceSkill,
      catalogSkill,
      warnings: [],
    })).toMatchObject({
      action: "created",
      skill: {
        key: catalogSkill.key,
        sourceType: "catalog",
      },
      catalogSkill: {
        id: catalogSkill.id,
        source: catalogSkill.source,
      },
    });
  });

  it("accepts update status, audit, update, and reset contract shapes", () => {
    expect(spaceSkillUpdateStatusSchema.parse({
      supported: true,
      reason: null,
      trackingRef: catalogSkill.id,
      currentRef: "sha256:old",
      latestRef: catalogSkill.contentHash,
      hasUpdate: true,
      installedHash: "sha256:installed",
      originHash: catalogSkill.contentHash,
      userModifiedAt: "2026-05-26T00:00:00.000Z",
      updateHoldReason: "local_modifications",
      auditVerdict: "warning",
      auditCodes: ["local_modifications"],
    })).toMatchObject({
      supported: true,
      updateHoldReason: "local_modifications",
      auditVerdict: "warning",
    });

    expect(spaceSkillAuditResultSchema.parse({
      skillId: spaceSkill.id,
      installedHash: "sha256:installed",
      originHash: catalogSkill.contentHash,
      verdict: "fail",
      codes: ["remote_fetch_exec"],
      findings: [{
        code: "remote_fetch_exec",
        severity: "error",
        message: "Remote-fetch or dynamic execution pattern is not allowed.",
        path: "SKILL.md",
      }],
      scannedAt: "2026-05-26T00:00:00.000Z",
      scanVersion: "skills-audit-v1",
    })).toMatchObject({
      verdict: "fail",
      codes: ["remote_fetch_exec"],
    });

    expect(spaceSkillInstallUpdateSchema.parse(undefined)).toEqual({});
    expect(spaceSkillInstallUpdateSchema.parse({ force: true })).toEqual({ force: true });
    expect(spaceSkillResetSchema.parse(undefined)).toEqual({});
    expect(spaceSkillResetSchema.parse({ force: true })).toEqual({ force: true });
  });
});
