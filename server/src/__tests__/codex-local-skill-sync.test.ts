import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listCodexSkills,
  syncCodexSkills,
} from "@outpost/adapter-codex-local/server";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("codex local skill sync", () => {
  const outpostKey = "outpost/outpost/outpost";
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    await Promise.all(Array.from(cleanupDirs).map((dir) => fs.rm(dir, { recursive: true, force: true })));
    cleanupDirs.clear();
  });

  it("defaults the operational Outpost skill for workspace injection on the next run", async () => {
    const codexHome = await makeTempDir("outpost-codex-skill-sync-");
    cleanupDirs.add(codexHome);

    const ctx = {
      agentId: "agent-1",
      spaceId: "space-1",
      adapterType: "codex_local",
      config: {
        env: {
          CODEX_HOME: codexHome,
        },
      },
    } as const;

    const before = await listCodexSkills(ctx);
    expect(before.mode).toBe("ephemeral");
    expect(before.desiredSkills).toContain(outpostKey);
    expect(before.entries.find((entry) => entry.key === outpostKey)?.state).toBe("configured");
    expect(before.entries.find((entry) => entry.key === outpostKey)?.detail).toContain("CODEX_HOME/skills/");
  });

  it("does not apply the legacy operational skill default to the native runner", async () => {
    const snapshot = await listCodexSkills({
      agentId: "agent-native",
      spaceId: "space-1",
      adapterType: "outpost_runner",
      config: {},
    });

    expect(snapshot.adapterType).toBe("outpost_runner");
    expect(snapshot.desiredSkills).toEqual([]);
    expect(snapshot.entries.find((entry) => entry.key === outpostKey)?.state).toBe("available");
  });

  it("does not persist Outpost skills into CODEX_HOME during sync", async () => {
    const codexHome = await makeTempDir("outpost-codex-skill-prune-");
    cleanupDirs.add(codexHome);

    const configuredCtx = {
      agentId: "agent-2",
      spaceId: "space-1",
      adapterType: "codex_local",
      config: {
        env: {
          CODEX_HOME: codexHome,
        },
        outpostSkillSync: {
          desiredSkills: [outpostKey],
        },
      },
    } as const;

    const after = await syncCodexSkills(configuredCtx, [outpostKey]);
    expect(after.mode).toBe("ephemeral");
    expect(after.entries.find((entry) => entry.key === outpostKey)?.state).toBe("configured");
    await expect(fs.lstat(path.join(codexHome, "skills", "outpost"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("normalizes legacy flat Outpost skill refs before reporting configured state", async () => {
    const codexHome = await makeTempDir("outpost-codex-legacy-skill-sync-");
    cleanupDirs.add(codexHome);

    const snapshot = await listCodexSkills({
      agentId: "agent-3",
      spaceId: "space-1",
      adapterType: "codex_local",
      config: {
        env: {
          CODEX_HOME: codexHome,
        },
        outpostSkillSync: {
          desiredSkills: ["outpost"],
        },
      },
    });

    expect(snapshot.warnings).toEqual([]);
    expect(snapshot.desiredSkills).toContain(outpostKey);
    expect(snapshot.desiredSkills).not.toContain("outpost");
    expect(snapshot.entries.find((entry) => entry.key === outpostKey)?.state).toBe("configured");
    expect(snapshot.entries.find((entry) => entry.key === "outpost")).toBeUndefined();
  });
});
