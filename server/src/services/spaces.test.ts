import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveSpaceWorkingDirectory, writePortableSpaceManifest } from "./spaces.js";

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("Space working directories", () => {
  it("resolves a stable identity for an existing directory", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "outpost-space-"));
    temporaryDirectories.push(directory);
    const result = await resolveSpaceWorkingDirectory(directory);
    expect(result.root).toBe(path.resolve(directory));
    expect(result.name).toBe(path.basename(directory));
    expect(result.key).toBe(process.platform === "win32" ? path.resolve(directory).toLowerCase() : path.resolve(directory));
  });

  it("rejects a missing directory", async () => {
    const missing = path.join(os.tmpdir(), `outpost-missing-${Date.now()}`);
    await expect(resolveSpaceWorkingDirectory(missing)).rejects.toThrow("Working directory does not exist");
  });

  it("writes only portable Space identity into the repository", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "outpost-space-"));
    temporaryDirectories.push(directory);
    await writePortableSpaceManifest({ root: directory, spaceId: "space-1", name: "Maya" });
    expect(JSON.parse(fs.readFileSync(path.join(directory, ".outpost", "space.json"), "utf8"))).toEqual({
      schemaVersion: 1,
      spaceId: "space-1",
      name: "Maya",
    });
  });
});
