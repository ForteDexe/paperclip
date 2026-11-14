import { describe, expect, it } from "vitest";
import {
  buildSecretPathBreadcrumbs,
  buildSecretPathListing,
  getSecretPathRowName,
  normalizeSecretPath,
  validateSecretFolderSegment,
  type SecretPathRow,
} from "./secret-path";

type TestRow = SecretPathRow & { id: string };

function spaceRow(id: string, name: string): TestRow {
  return { id, kind: "space", secret: { name } };
}

function userRow(id: string, name: string): TestRow {
  return { id, kind: "user", definition: { name } };
}

describe("secret path normalization", () => {
  it("ignores leading, duplicate, and trailing slashes without changing stored names", () => {
    const rows = [
      spaceRow("github", "/dev//github/"),
      spaceRow("token", "//prod///api//token/"),
      userRow("standalone", "/standalone/"),
    ];

    expect(normalizeSecretPath("//dev///github/")).toBe("dev/github");
    expect(buildSecretPathListing(rows, "/")).toEqual({
      folders: [
        { name: "dev", path: "dev", secretCount: 1, folderCount: 0 },
        { name: "prod", path: "prod", secretCount: 1, folderCount: 1 },
      ],
      secrets: [rows[2]],
    });
    expect(getSecretPathRowName(rows[0])).toBe("/dev//github/");
  });

  it("keeps no-slash names at the root", () => {
    const rows = [spaceRow("one", "alpha"), userRow("two", "beta")];

    expect(buildSecretPathListing(rows, "")).toEqual({ folders: [], secrets: rows });
  });
});

describe("buildSecretPathListing", () => {
  it("shows a name as both a direct secret and a folder when it is also a prefix", () => {
    const exact = spaceRow("exact", "dev");
    const nested = spaceRow("nested", "dev/oauth/token");

    expect(buildSecretPathListing([exact, nested], "")).toEqual({
      folders: [{ name: "dev", path: "dev", secretCount: 1, folderCount: 1 }],
      secrets: [exact],
    });
    expect(buildSecretPathListing([exact, nested], "dev")).toEqual({
      folders: [{ name: "oauth", path: "dev/oauth", secretCount: 1, folderCount: 0 }],
      secrets: [exact],
    });
  });

  it("groups case-sensitively while sorting case-insensitively", () => {
    const rows = [
      spaceRow("lower-child", "dev/token"),
      spaceRow("upper-child", "Dev/token"),
      spaceRow("zebra", "zebra"),
      spaceRow("alpha-upper", "Alpha"),
      spaceRow("alpha-lower", "alpha"),
    ];
    const listing = buildSecretPathListing(rows, "");

    expect(listing.folders.map((folder) => folder.name)).toEqual(["dev", "Dev"]);
    expect(listing.secrets.map(getSecretPathRowName)).toEqual(["Alpha", "alpha", "zebra"]);
  });

  it("naturally sorts folders and secrets", () => {
    const rows = [
      spaceRow("env10", "env10/token"),
      spaceRow("env2", "env2/token"),
      spaceRow("key10", "key10"),
      spaceRow("key2", "key2"),
    ];
    const listing = buildSecretPathListing(rows, "");

    expect(listing.folders.map((folder) => folder.name)).toEqual(["env2", "env10"]);
    expect(listing.secrets.map(getSecretPathRowName)).toEqual(["key2", "key10"]);
  });

  it("preserves encoded and special characters in segments and breadcrumbs", () => {
    const row = spaceRow("special", "team & ops/100%/api?key=a%2Fb");

    expect(buildSecretPathListing([row], "team & ops").folders).toEqual([
      {
        name: "100%",
        path: "team & ops/100%",
        secretCount: 1,
        folderCount: 0,
      },
    ]);
    expect(buildSecretPathBreadcrumbs("/team & ops//100%/api?key=a%2Fb/")).toEqual([
      { name: "team & ops", path: "team & ops" },
      { name: "100%", path: "team & ops/100%" },
      { name: "api?key=a%2Fb", path: "team & ops/100%/api?key=a%2Fb" },
    ]);
  });

  it("computes recursive secret and folder counts from the provided rows", () => {
    const allRows = [
      spaceRow("direct", "dev/direct"),
      spaceRow("a", "dev/a/token"),
      spaceRow("b", "dev/b/token"),
      spaceRow("deep", "dev/b/deep/token"),
      spaceRow("filtered", "dev/c/hidden"),
    ];
    const filteredRows = allRows.filter((row) => row.id !== "filtered");

    expect(buildSecretPathListing(filteredRows, "").folders).toEqual([
      { name: "dev", path: "dev", secretCount: 4, folderCount: 3 },
    ]);
    expect(buildSecretPathListing(filteredRows, "dev")).toEqual({
      folders: [
        { name: "a", path: "dev/a", secretCount: 1, folderCount: 0 },
        { name: "b", path: "dev/b", secretCount: 2, folderCount: 1 },
      ],
      secrets: [allRows[0]],
    });
  });
});

describe("validateSecretFolderSegment", () => {
  it("rejects empty and slash-containing folder segments", () => {
    expect(validateSecretFolderSegment("   ")).toBe("Folder name is required.");
    expect(validateSecretFolderSegment("dev/prod")).toBe(
      "Folder name cannot contain slashes.",
    );
  });

  it("accepts trimmed and special-character segment names", () => {
    expect(validateSecretFolderSegment("  dev tools  ")).toBeNull();
    expect(validateSecretFolderSegment("100% & encoded%2Fvalue")).toBeNull();
  });
});
