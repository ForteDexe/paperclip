import { describe, expect, it } from "vitest";
import {
  applySpacePrefix,
  extractSpacePrefixFromPath,
  isBoardPathWithoutPrefix,
  toSpaceRelativePath,
} from "./space-routes";

describe("space routes", () => {
  it("treats the Space collection as a operator route inside the active shell", () => {
    expect(isBoardPathWithoutPrefix("/spaces")).toBe(true);
    expect(extractSpacePrefixFromPath("/spaces")).toBeNull();
    expect(applySpacePrefix("/spaces", "HER")).toBe("/HER/spaces");
    expect(applySpacePrefix("/spaces?new=1", "HER")).toBe("/HER/spaces?new=1");
    expect(toSpaceRelativePath("/HER/spaces?new=1")).toBe("/spaces?new=1");
  });

  it("keeps public Dot consent outside space-prefixed routes", () => {
    const path = `/dot-connect/pcmcp_request_${"a".repeat(43)}`;
    expect(extractSpacePrefixFromPath(path)).toBeNull();
    expect(applySpacePrefix(path, "DOT")).toBe(path);
  });
  it("treats the task-list alias as an unprefixed operator route", () => {
    expect(isBoardPathWithoutPrefix("/tasks")).toBe(true);
    expect(extractSpacePrefixFromPath("/tasks")).toBeNull();
    expect(applySpacePrefix("/tasks", "PAP")).toBe("/PAP/tasks");
  });

  it("treats execution workspace paths as operator routes that need a space prefix", () => {
    expect(isBoardPathWithoutPrefix("/execution-workspaces/workspace-123")).toBe(true);
    expect(isBoardPathWithoutPrefix("/execution-workspaces/workspace-123/routines")).toBe(true);
    expect(extractSpacePrefixFromPath("/execution-workspaces/workspace-123")).toBeNull();
    expect(applySpacePrefix("/execution-workspaces/workspace-123", "PAP")).toBe(
      "/PAP/execution-workspaces/workspace-123",
    );
    expect(applySpacePrefix("/execution-workspaces/workspace-123/routines", "PAP")).toBe(
      "/PAP/execution-workspaces/workspace-123/routines",
    );
  });

  it("normalizes prefixed execution workspace paths back to space-relative paths", () => {
    expect(toSpaceRelativePath("/PAP/execution-workspaces/workspace-123")).toBe(
      "/execution-workspaces/workspace-123",
    );
    expect(toSpaceRelativePath("/PAP/execution-workspaces/workspace-123/routines")).toBe(
      "/execution-workspaces/workspace-123/routines",
    );
  });

  it("treats /search as a operator route that needs a space prefix", () => {
    expect(isBoardPathWithoutPrefix("/search")).toBe(true);
    expect(extractSpacePrefixFromPath("/search")).toBeNull();
    expect(applySpacePrefix("/search", "PAP")).toBe("/PAP/search");
    expect(applySpacePrefix("/search?q=hello%20world", "PAP")).toBe("/PAP/search?q=hello%20world");
    expect(toSpaceRelativePath("/PAP/search?q=foo")).toBe("/search?q=foo");
  });

  it("rewrites space package paths with the active prefix", () => {
    expect(applySpacePrefix("/space/export", "NEU")).toBe("/NEU/space/export");
    expect(applySpacePrefix("/space/import", "NEU")).toBe("/NEU/space/import");
    expect(applySpacePrefix("/org", "NEU")).toBe("/NEU/org");
  });

  it("does not double-apply the space prefix", () => {
    expect(applySpacePrefix("/NEU/space/export", "NEU")).toBe("/NEU/space/export");
  });

  it("normalizes prefixed space export file URLs for parsing", () => {
    expect(toSpaceRelativePath("/NEU/space/export/files/agents/lead/AGENTS.md")).toBe(
      "/space/export/files/agents/lead/AGENTS.md",
    );
  });

  // Regression for PAP-10257: Team Catalog navigation (auto-select + row/file
  // clicks) produces space-relative `/teams-catalog/<key>` paths. Without
  // `teams-catalog` in the operator-route allowlist, `extractSpacePrefixFromPath`
  // misread the first segment as a space prefix and `useNavigate` skipped the
  // rewrite, dropping the `/PAP/` prefix and crashing into "Space not found".
  it("re-prefixes team catalog routes so navigate preserves the space prefix", () => {
    expect(isBoardPathWithoutPrefix("/teams")).toBe(false);
    expect(isBoardPathWithoutPrefix("/teams-catalog")).toBe(true);
    expect(isBoardPathWithoutPrefix("/teams-catalog/core-exec-team")).toBe(true);
    expect(extractSpacePrefixFromPath("/teams-catalog/core-exec-team")).toBeNull();

    // Auto-select effect: `/teams-catalog/<first-key>` must gain the `/PAP/` prefix.
    expect(applySpacePrefix("/teams-catalog/core-exec-team", "PAP")).toBe(
      "/PAP/teams-catalog/core-exec-team",
    );
    // File-tree click: nested `/files/<encoded>` path is preserved under the prefix.
    expect(applySpacePrefix("/teams-catalog/core-exec-team/files/TEAM.md", "PAP")).toBe(
      "/PAP/teams-catalog/core-exec-team/files/TEAM.md",
    );
    // Already-prefixed paths are left untouched (idempotent — no double prefix).
    expect(applySpacePrefix("/PAP/teams-catalog/core-exec-team", "PAP")).toBe(
      "/PAP/teams-catalog/core-exec-team",
    );
    // Round-trips back to a space-relative path.
    expect(toSpaceRelativePath("/PAP/teams-catalog/core-exec-team")).toBe(
      "/teams-catalog/core-exec-team",
    );
  });

  it("treats /artifacts as a operator route that needs a space prefix", () => {
    expect(isBoardPathWithoutPrefix("/artifacts")).toBe(true);
    expect(extractSpacePrefixFromPath("/artifacts")).toBeNull();
    expect(applySpacePrefix("/artifacts", "PAP")).toBe("/PAP/artifacts");
    expect(toSpaceRelativePath("/PAP/artifacts")).toBe("/artifacts");
  });

  it("treats /audit as a operator route that needs a space prefix", () => {
    expect(isBoardPathWithoutPrefix("/audit")).toBe(true);
    expect(extractSpacePrefixFromPath("/audit")).toBeNull();
    expect(applySpacePrefix("/audit", "PAP")).toBe("/PAP/audit");
    expect(toSpaceRelativePath("/PAP/audit")).toBe("/audit");
  });

  it("treats /tools routes as operator routes that need a space prefix", () => {
    expect(isBoardPathWithoutPrefix("/tools")).toBe(true);
    expect(isBoardPathWithoutPrefix("/tools/runtime")).toBe(true);
    expect(extractSpacePrefixFromPath("/tools")).toBeNull();
    expect(applySpacePrefix("/tools", "PAP")).toBe("/PAP/tools");
    expect(applySpacePrefix("/tools/runtime", "PAP")).toBe("/PAP/tools/runtime");
    expect(applySpacePrefix("/PAP/tools/runtime", "PAP")).toBe("/PAP/tools/runtime");
    expect(toSpaceRelativePath("/PAP/tools/runtime")).toBe("/tools/runtime");
  });

  it("recognizes Decisions without retaining the legacy attention route", () => {
    expect(isBoardPathWithoutPrefix("/decisions")).toBe(true);
    expect(extractSpacePrefixFromPath("/decisions")).toBeNull();
    expect(applySpacePrefix("/decisions", "PAP")).toBe("/PAP/decisions");

    expect(isBoardPathWithoutPrefix("/attention")).toBe(false);
    expect(extractSpacePrefixFromPath("/attention")).toBe("ATTENTION");
  });

  it("treats /timeline as a operator route that needs a space prefix", () => {
    expect(isBoardPathWithoutPrefix("/timeline")).toBe(true);
    expect(extractSpacePrefixFromPath("/timeline")).toBeNull();
    expect(applySpacePrefix("/timeline", "PAP")).toBe("/PAP/timeline");
    expect(toSpaceRelativePath("/PAP/timeline")).toBe("/timeline");
  });

  it("treats Skill Studio create mode as an unprefixed operator route", () => {
    expect(isBoardPathWithoutPrefix("/skills/studio/new")).toBe(true);
    expect(extractSpacePrefixFromPath("/skills/studio/new")).toBeNull();
    expect(applySpacePrefix("/skills/studio/new?forkFrom=skill-1", "PAP")).toBe(
      "/PAP/skills/studio/new?forkFrom=skill-1",
    );
    expect(toSpaceRelativePath("/PAP/skills/studio/new?forkFrom=skill-1")).toBe(
      "/skills/studio/new?forkFrom=skill-1",
    );
  });

  it("preserves artifact deep-link anchors when applying the space prefix", () => {
    expect(applySpacePrefix("/issues/PAP-10205#work-product-wp-1", "PAP")).toBe(
      "/PAP/issues/PAP-10205#work-product-wp-1",
    );
    expect(applySpacePrefix("/issues/PAP-10306#attachment-att-1", "PAP")).toBe(
      "/PAP/issues/PAP-10306#attachment-att-1",
    );
    // Already-prefixed paths are returned untouched.
    expect(applySpacePrefix("/PAP/artifacts", "PAP")).toBe("/PAP/artifacts");
  });
});
