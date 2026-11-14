import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  describeLocalInstancePaths,
  expandHomePrefix,
  resolveOutpostHomeDir,
  resolveOutpostInstanceId,
} from "../config/home.js";

const ORIGINAL_ENV = { ...process.env };

describe("home path resolution", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("defaults to ~/.outpost and default instance", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "outpost-home-paths-"));
    process.env.OUTPOST_HOME = home;
    delete process.env.OUTPOST_INSTANCE_ID;

    const paths = describeLocalInstancePaths();
    expect(paths.homeDir).toBe(home);
    expect(paths.instanceId).toBe("default");
    expect(paths.configPath).toBe(path.resolve(home, "instances", "default", "config.json"));
  });

  it("supports OUTPOST_HOME and explicit instance ids", () => {
    process.env.OUTPOST_HOME = "~/outpost-home";

    const home = resolveOutpostHomeDir();
    expect(home).toBe(path.resolve(os.homedir(), "outpost-home"));
    expect(resolveOutpostInstanceId("dev_1")).toBe("dev_1");
  });

  it("rejects invalid instance ids", () => {
    expect(() => resolveOutpostInstanceId("bad/id")).toThrow(/Invalid OUTPOST_INSTANCE_ID/);
  });

  it("expands ~ prefixes", () => {
    expect(expandHomePrefix("~")).toBe(os.homedir());
    expect(expandHomePrefix("~/x/y")).toBe(path.resolve(os.homedir(), "x/y"));
  });
});
