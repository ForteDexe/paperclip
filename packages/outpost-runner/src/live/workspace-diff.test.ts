import { mkdtemp, mkdir, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { captureOutpostWorkspace, diffOutpostWorkspace } from "./workspace-diff.js";

describe("runner-verified workspace diffs", () => {
  it("captures create, modify, delete, and rename without runner-owned noise", async () => {
    const root = await mkdtemp(join(tmpdir(), "outpost-workspace-diff-"));
    await mkdir(join(root, ".outpost-runner-orp"));
    await writeFile(join(root, ".outpost-runner-orp", "state.json"), "before");
    await writeFile(join(root, "modify.txt"), "old\n");
    await writeFile(join(root, "delete.txt"), "gone\n");
    await writeFile(join(root, "rename.txt"), "same\n");
    const before = await captureOutpostWorkspace(root);

    await writeFile(join(root, ".outpost-runner-orp", "state.json"), "after");
    await writeFile(join(root, "modify.txt"), "new\n");
    await writeFile(join(root, "create.txt"), "created\n");
    await writeFile(join(root, "delete.txt"), "");
    await rename(join(root, "rename.txt"), join(root, "renamed.txt"));
    const after = await captureOutpostWorkspace(root);
    const diff = diffOutpostWorkspace(before, after, "turn-1:workspace");

    expect(diff?.schema).toBe("outpost.workspace.diff.v1");
    expect(diff?.source).toBe("runner_verified");
    expect(diff?.files.map((file) => [file.path, file.operation])).toEqual([
      ["create.txt", "create"],
      ["delete.txt", "modify"],
      ["modify.txt", "modify"],
      ["renamed.txt", "rename"],
    ]);
    expect(diff?.files.find((file) => file.path === "renamed.txt")?.previousPath).toBe("rename.txt");
    expect(JSON.stringify(diff)).not.toContain(".outpost-runner-orp");
  });

  it("returns no record when the workspace did not change", async () => {
    const root = await mkdtemp(join(tmpdir(), "outpost-workspace-stable-"));
    await writeFile(join(root, "stable.txt"), "same\n");
    const before = await captureOutpostWorkspace(root);
    const after = await captureOutpostWorkspace(root);
    expect(diffOutpostWorkspace(before, after, "turn-1:workspace")).toBeNull();
  });
});
