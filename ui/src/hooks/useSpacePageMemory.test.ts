import { describe, expect, it } from "vitest";
import {
  getRememberedPathOwnerSpaceId,
  sanitizeRememberedPathForSpace,
} from "../lib/space-page-memory";

const spaces = [
  { id: "for", issuePrefix: "FOR" },
  { id: "pap", issuePrefix: "PAP" },
];

describe("getRememberedPathOwnerSpaceId", () => {
  it("uses the route space instead of stale selected-space state for prefixed routes", () => {
    expect(
      getRememberedPathOwnerSpaceId({
        spaces,
        pathname: "/FOR/issues/FOR-1",
        fallbackSpaceId: "pap",
      }),
    ).toBe("for");
  });

  it("skips saving when a prefixed route cannot yet be resolved to a known space", () => {
    expect(
      getRememberedPathOwnerSpaceId({
        spaces: [],
        pathname: "/FOR/issues/FOR-1",
        fallbackSpaceId: "pap",
      }),
    ).toBeNull();
  });

  it("falls back to the previous space for unprefixed operator routes", () => {
    expect(
      getRememberedPathOwnerSpaceId({
        spaces,
        pathname: "/dashboard",
        fallbackSpaceId: "pap",
      }),
    ).toBe("pap");
  });

  it("treats unprefixed skills routes as operator routes instead of space prefixes", () => {
    expect(
      getRememberedPathOwnerSpaceId({
        spaces,
        pathname: "/skills/skill-123/files/SKILL.md",
        fallbackSpaceId: "pap",
      }),
    ).toBe("pap");
  });
});

describe("sanitizeRememberedPathForSpace", () => {
  it("keeps remembered issue paths that belong to the target space", () => {
    expect(
      sanitizeRememberedPathForSpace({
        path: "/issues/PAP-12",
        spacePrefix: "PAP",
      }),
    ).toBe("/issues/PAP-12");
  });

  it("falls back to dashboard for remembered issue identifiers from another space", () => {
    expect(
      sanitizeRememberedPathForSpace({
        path: "/issues/FOR-1",
        spacePrefix: "PAP",
      }),
    ).toBe("/dashboard");
  });

  it("falls back to dashboard when no remembered path exists", () => {
    expect(
      sanitizeRememberedPathForSpace({
        path: null,
        spacePrefix: "PAP",
      }),
    ).toBe("/dashboard");
  });

  it("keeps remembered skills paths intact for the target space", () => {
    expect(
      sanitizeRememberedPathForSpace({
        path: "/skills/skill-123/files/SKILL.md",
        spacePrefix: "PAP",
      }),
    ).toBe("/skills/skill-123/files/SKILL.md");
  });
});
