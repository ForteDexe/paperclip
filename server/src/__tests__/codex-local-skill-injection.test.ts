import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureCodexSkillsInjected } from "@outpost/adapter-codex-local/server";

async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function createOutpostRepoSkill(root: string, skillName: string) {
  await fs.mkdir(path.join(root, "server"), { recursive: true });
  await fs.mkdir(path.join(root, "packages", "adapter-utils"), { recursive: true });
  await fs.mkdir(path.join(root, "skills", skillName), { recursive: true });
  await fs.writeFile(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n", "utf8");
  await fs.writeFile(path.join(root, "package.json"), '{"name":"outpost"}\n', "utf8");
  await fs.writeFile(
    path.join(root, "skills", skillName, "SKILL.md"),
    `---\nname: ${skillName}\n---\n`,
    "utf8",
  );
}

async function createCustomSkill(root: string, skillName: string) {
  await fs.mkdir(path.join(root, "custom", skillName), { recursive: true });
  await fs.writeFile(
    path.join(root, "custom", skillName, "SKILL.md"),
    `---\nname: ${skillName}\n---\n`,
    "utf8",
  );
}

describe("codex local adapter skill injection", () => {
  const outpostKey = "outpost/outpost/outpost";
  const delegationKey = "outpost/outpost-delegation";
  const cleanupDirs = new Set<string>();

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(Array.from(cleanupDirs).map((dir) => fs.rm(dir, { recursive: true, force: true })));
    cleanupDirs.clear();
  });

  it.runIf(process.platform === "win32")("falls back to a Windows junction when directory symlinks are denied", async () => {
    const skillRoot = await makeTempDir("outpost-codex-junction-source-");
    const skillsHome = await makeTempDir("outpost-codex-junction-home-");
    cleanupDirs.add(skillRoot);
    cleanupDirs.add(skillsHome);
    await createCustomSkill(skillRoot, "review");
    const source = path.join(skillRoot, "custom", "review");
    const target = path.join(skillsHome, "review");

    const realSymlink = fs.symlink.bind(fs);
    const symlink = vi.spyOn(fs, "symlink").mockImplementation(async (from, to, type) => {
      if (type !== "junction") {
        const denied = new Error("symbolic links require privilege") as NodeJS.ErrnoException;
        denied.code = "EPERM";
        throw denied;
      }
      await realSymlink(from, to, type);
    });

    const logs: Array<{ stream: "stdout" | "stderr"; chunk: string }> = [];
    await ensureCodexSkillsInjected(async (stream, chunk) => {
      logs.push({ stream, chunk });
    }, {
      skillsHome,
      skillsEntries: [{ key: "outpost/review", runtimeName: "review", source }],
    });

    expect(await fs.realpath(target)).toBe(await fs.realpath(source));
    expect(symlink).toHaveBeenNthCalledWith(1, source, target, "dir");
    expect(symlink).toHaveBeenNthCalledWith(2, path.resolve(source), target, "junction");
    expect(logs).toContainEqual(expect.objectContaining({
      stream: "stdout",
      chunk: expect.stringContaining('Injected Codex skill "review"'),
    }));
    expect(logs.some((entry) => entry.stream === "stderr")).toBe(false);
  });

  it("repairs a Codex Outpost skill symlink that still points at another live checkout", async () => {
    const currentRepo = await makeTempDir("outpost-codex-current-");
    const oldRepo = await makeTempDir("outpost-codex-old-");
    const skillsHome = await makeTempDir("outpost-codex-home-");
    cleanupDirs.add(currentRepo);
    cleanupDirs.add(oldRepo);
    cleanupDirs.add(skillsHome);

    await createOutpostRepoSkill(currentRepo, "outpost");
    await createOutpostRepoSkill(currentRepo, "outpost-delegation");
    await createOutpostRepoSkill(oldRepo, "outpost");
    await fs.symlink(path.join(oldRepo, "skills", "outpost"), path.join(skillsHome, "outpost"));

    const logs: Array<{ stream: "stdout" | "stderr"; chunk: string }> = [];
    await ensureCodexSkillsInjected(
      async (stream, chunk) => {
        logs.push({ stream, chunk });
      },
      {
        skillsHome,
        skillsEntries: [
          {
            key: outpostKey,
            runtimeName: "outpost",
            source: path.join(currentRepo, "skills", "outpost"),
          },
          {
            key: delegationKey,
            runtimeName: "outpost-delegation",
            source: path.join(currentRepo, "skills", "outpost-delegation"),
          },
        ],
      },
    );

    expect(await fs.realpath(path.join(skillsHome, "outpost"))).toBe(
      await fs.realpath(path.join(currentRepo, "skills", "outpost")),
    );
    expect(await fs.realpath(path.join(skillsHome, "outpost-delegation"))).toBe(
      await fs.realpath(path.join(currentRepo, "skills", "outpost-delegation")),
    );
    expect(logs).toContainEqual(
      expect.objectContaining({
        stream: "stdout",
        chunk: expect.stringContaining('Repaired Codex skill "outpost"'),
      }),
    );
    expect(logs).toContainEqual(
      expect.objectContaining({
        stream: "stdout",
        chunk: expect.stringContaining('Injected Codex skill "outpost-delegation"'),
      }),
    );
  });

  it("preserves a custom Codex skill symlink outside Outpost repo checkouts", async () => {
    const currentRepo = await makeTempDir("outpost-codex-current-");
    const customRoot = await makeTempDir("outpost-codex-custom-");
    const skillsHome = await makeTempDir("outpost-codex-home-");
    cleanupDirs.add(currentRepo);
    cleanupDirs.add(customRoot);
    cleanupDirs.add(skillsHome);

    await createOutpostRepoSkill(currentRepo, "outpost");
    await createCustomSkill(customRoot, "outpost");
    await fs.symlink(path.join(customRoot, "custom", "outpost"), path.join(skillsHome, "outpost"));

    await ensureCodexSkillsInjected(async () => {}, {
      skillsHome,
      skillsEntries: [{
        key: outpostKey,
        runtimeName: "outpost",
        source: path.join(currentRepo, "skills", "outpost"),
      }],
    });

    expect(await fs.realpath(path.join(skillsHome, "outpost"))).toBe(
      await fs.realpath(path.join(customRoot, "custom", "outpost")),
    );
  });

  it("prunes broken symlinks for unavailable Outpost repo skills before Codex starts", async () => {
    const currentRepo = await makeTempDir("outpost-codex-current-");
    const oldRepo = await makeTempDir("outpost-codex-old-");
    const skillsHome = await makeTempDir("outpost-codex-home-");
    cleanupDirs.add(currentRepo);
    cleanupDirs.add(oldRepo);
    cleanupDirs.add(skillsHome);

    await createOutpostRepoSkill(currentRepo, "outpost");
    await createOutpostRepoSkill(oldRepo, "agent-browser");
    const staleTarget = path.join(oldRepo, "skills", "agent-browser");
    await fs.symlink(staleTarget, path.join(skillsHome, "agent-browser"));
    await fs.rm(staleTarget, { recursive: true, force: true });

    const logs: Array<{ stream: "stdout" | "stderr"; chunk: string }> = [];
    await ensureCodexSkillsInjected(
      async (stream, chunk) => {
        logs.push({ stream, chunk });
      },
      {
        skillsHome,
        skillsEntries: [{
          key: outpostKey,
          runtimeName: "outpost",
          source: path.join(currentRepo, "skills", "outpost"),
        }],
      },
    );

    await expect(fs.lstat(path.join(skillsHome, "agent-browser"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(logs).toContainEqual(
      expect.objectContaining({
        stream: "stdout",
        chunk: expect.stringContaining('Removed stale Codex skill "agent-browser"'),
      }),
    );
  });

  it("preserves other live Outpost skill symlinks in the shared workspace skill directory", async () => {
    const currentRepo = await makeTempDir("outpost-codex-current-");
    const skillsHome = await makeTempDir("outpost-codex-home-");
    cleanupDirs.add(currentRepo);
    cleanupDirs.add(skillsHome);

    await createOutpostRepoSkill(currentRepo, "outpost");
    await createOutpostRepoSkill(currentRepo, "agent-browser");
    await fs.symlink(
      path.join(currentRepo, "skills", "agent-browser"),
      path.join(skillsHome, "agent-browser"),
    );

    await ensureCodexSkillsInjected(async () => {}, {
      skillsHome,
      skillsEntries: [{
        key: outpostKey,
        runtimeName: "outpost",
        source: path.join(currentRepo, "skills", "outpost"),
      }],
    });

    expect((await fs.lstat(path.join(skillsHome, "outpost"))).isSymbolicLink()).toBe(true);
    expect((await fs.lstat(path.join(skillsHome, "agent-browser"))).isSymbolicLink()).toBe(true);
    expect(await fs.realpath(path.join(skillsHome, "agent-browser"))).toBe(
      await fs.realpath(path.join(currentRepo, "skills", "agent-browser")),
    );
  });
});
