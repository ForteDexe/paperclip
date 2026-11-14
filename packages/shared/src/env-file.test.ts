import { describe, expect, it } from "vitest";
import { encodeEnvValue, updateEnvFileContents } from "./env-file.js";

describe("env file editor", () => {
  it("pins minimal and JSON value encoding", () => {
    expect(encodeEnvValue("plain-value", "minimal")).toBe("plain-value");
    expect(encodeEnvValue("#439edb", "minimal")).toBe('"#439edb"');
    expect(encodeEnvValue("plain-value", "json")).toBe('"plain-value"');
  });

  it("preserves unrelated content and CRLF while updating every stale duplicate", () => {
    const original = [
      "# operator comment",
      "UNKNOWN='keep this encoding'",
      "",
      "export OUTPOST_HOME = '/old path'  # managed path",
      "OUTPOST_DUPLICATE=stale",
      'OUTPOST_DUPLICATE="current"',
      "TRAILING=untouched",
      "",
    ].join("\r\n");

    const updated = updateEnvFileContents(
      original,
      {
        OUTPOST_HOME: "/new path",
        OUTPOST_DUPLICATE: "current",
        OUTPOST_WORKTREE_COLOR: "#439edb",
      },
      { valueEncoding: "minimal" },
    );

    expect(updated).toBe([
      "# operator comment",
      "UNKNOWN='keep this encoding'",
      "",
      'export OUTPOST_HOME = "/new path"  # managed path',
      "OUTPOST_DUPLICATE=current",
      'OUTPOST_DUPLICATE="current"',
      "TRAILING=untouched",
      'OUTPOST_WORKTREE_COLOR="#439edb"',
      "",
    ].join("\r\n"));
    expect(updated.replaceAll("\r\n", "")).not.toContain("\n");
  });

  it("uses JSON encoding for changed values without re-encoding current assignments", () => {
    const original = [
      "OUTPOST_CURRENT=plain-value",
      "OUTPOST_CHANGED=old",
      "UNKNOWN=\"operator value\"",
      "",
    ].join("\n");

    expect(
      updateEnvFileContents(
        original,
        {
          OUTPOST_CURRENT: "plain-value",
          OUTPOST_CHANGED: "new",
          OUTPOST_ADDED: "added",
        },
        { valueEncoding: "json" },
      ),
    ).toBe([
      "OUTPOST_CURRENT=plain-value",
      'OUTPOST_CHANGED="new"',
      'UNKNOWN="operator value"',
      'OUTPOST_ADDED="added"',
      "",
    ].join("\n"));
  });

  it("does not treat an unquoted dotenv comment as the managed value", () => {
    expect(
      updateEnvFileContents(
        ["OUTPOST_COLOR=#439edb", "OUTPOST_HOME=old# keep this comment"].join("\n"),
        {
          OUTPOST_COLOR: "#439edb",
          OUTPOST_HOME: "new",
        },
        { valueEncoding: "minimal" },
      ),
    ).toBe(
      ['OUTPOST_COLOR="#439edb"#439edb', "OUTPOST_HOME=new# keep this comment"].join("\n"),
    );
  });

  it("is a no-op when every managed duplicate is already current", () => {
    const original = [
      "export OUTPOST_HOME = '/same path' # first",
      'OUTPOST_HOME="/same path"',
      "UNKNOWN=value",
    ].join("\n");

    expect(updateEnvFileContents(original, { OUTPOST_HOME: "/same path" })).toBe(original);
  });
});
