import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { agents, spaces, spaceSkills, spaceSkillVersions, spaceSkillSources, heartbeatRuns, issues } from "@outpost/db";
import { startRecoveryPostgres } from "../../__tests__/helpers/recovery-postgres.js";
import { createDb } from "@outpost/db";
import { OutpostRunnerToolAuthority } from "./outpost-runner-tool-authority.js";
import { skillPackagePaths, skillPackageStore } from "../skill-package-store.js";
import { withSkillVersionCacheLock } from "../skill-version-cache.js";
import { getStorageService } from "../../storage/index.js";

describe("native space skill discovery", () => {
  let temporary: Awaited<ReturnType<typeof startRecoveryPostgres>>;
  let db: ReturnType<typeof createDb>;
  let home: string;
  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), "native-skill-library-"));
    vi.stubEnv("OUTPOST_HOME", home);
    vi.stubEnv("OUTPOST_STORAGE_PROVIDER", "local_disk");
    vi.stubEnv("OUTPOST_STORAGE_LOCAL_DIR", join(home, "objects"));
    temporary = await startRecoveryPostgres("native-skill-library-");
    db = createDb(temporary.connectionString);
  }, 60_000);
  afterAll(async () => {
    await temporary?.cleanup(); vi.unstubAllEnvs();
    if (home) await rm(home, { recursive: true, force: true });
  });

  async function fixture() {
    const spaceId = randomUUID(), agentId = randomUUID(), issueId = randomUUID(), runId = randomUUID();
    await db.insert(spaces).values({ id: spaceId, name: "Skill library", issuePrefix: `S${spaceId.slice(0, 8)}` });
    await db.insert(agents).values({ id: agentId, spaceId, name: "Reviewer", adapterType: "outpost_runner", status: "active", adapterConfig: { provider: "codex" } });
    await db.insert(issues).values({ id: issueId, spaceId, title: "Review", status: "in_progress", assigneeAgentId: agentId });
    await db.insert(heartbeatRuns).values({ id: runId, spaceId, agentId, nativeIssueId: issueId, status: "running", runtimeMode: "native", invocationSource: "assignment", triggerDetail: "system", contextSnapshot: { issueId, skillVersions: {} } });
    await db.update(issues).set({ executionRunId: runId }).where(eq(issues.id, issueId));
    const binding = { spaceId, agentId, issueId, runId, apiToolsEnabled: false };
    const authority = new OutpostRunnerToolAuthority(db, binding);
    const call = (tool: string, args: Record<string, unknown> = {}) => authority.execute({ tool, callId: randomUUID(), arguments: args });
    return { ...binding, authority, call };
  }

  async function skill(spaceId: string, key = "pr-merge-review", text = "Read the diff and check the tests.") {
    const id = randomUUID(), versionId = randomUUID();
    await db.insert(spaceSkills).values({ id, spaceId, key, slug: key, name: key, description: "Review a pull request before merge", markdown: text, sourceType: "managed" });
    await db.insert(spaceSkillVersions).values({ id: versionId, spaceId, spaceSkillId: id, revisionNumber: 1, fileInventory: [
      { path: "SKILL.md", kind: "skill", content: text },
      { path: "references/checks.md", kind: "reference", content: "Check CI and the review result." },
      { path: "assets/icon.png", kind: "asset", content: "AAEC", encoding: "base64" },
    ] });
    await db.update(spaceSkills).set({ currentVersionId: versionId }).where(eq(spaceSkills.id, id));
    return { id, versionId, text };
  }

  it("finds and loads an unassigned skill without generic API tools or assignment changes", async () => {
    const f = await fixture(), s = await skill(f.spaceId);
    expect(f.authority.definitions().map(t => t.name)).toEqual(expect.arrayContaining(["search_skills", "load_skill"]));
    expect(await f.call("search_skills", { query: "MERGE" })).toMatchObject({ skills: [{ id: s.id, key: "pr-merge-review", versionId: s.versionId, trustLevel: "markdown_only" }], nextCursor: null });
    expect(await f.call("load_skill", { skill: "pr-merge-review" })).toMatchObject({ skillId: s.id, versionId: s.versionId, path: "SKILL.md", text: s.text, nextOffset: null });
    expect(await f.call("load_skill", { skill: s.id, versionId: s.versionId, path: "references/checks.md" })).toMatchObject({ text: "Check CI and the review result." });
    expect((await db.select().from(agents).where(eq(agents.id, f.agentId)))[0]?.adapterConfig).toEqual({ provider: "codex" });
  });

  it("keeps default inline file reads compatible with existing callers", async () => {
    const f = await fixture(), s = await skill(f.spaceId);
    const store = skillPackageStore(db);
    const version = await store.version(f.spaceId, s.id, s.versionId);
    expect(version).toBeTruthy();
    expect(await store.readVersionFile(version!, "SKILL.md")).toMatchObject({ content: s.text });
    expect(await store.readVersionFile(version!, "references/checks.md", false))
      .toMatchObject({ content: "Check CI and the review result." });
  });

  it("bounds and paginates search results and treats SQL wildcard characters literally", async () => {
    const f = await fixture();
    await skill(f.spaceId, "review-a"); await skill(f.spaceId, "review-b"); await skill(f.spaceId, "review-c");
    const first = await f.call("search_skills", { query: "review", limit: 2 }) as any;
    const second = await f.call("search_skills", { query: "review", limit: 2, cursor: first.nextCursor }) as any;
    expect(first.skills).toHaveLength(2); expect(second.skills).toHaveLength(1); expect(second.nextCursor).toBeNull();
    expect(new Set([...first.skills, ...second.skills].map(s => s.id)).size).toBe(3);
    expect(await f.call("search_skills", { query: "%" })).toMatchObject({ skills: [] });
  });

  it.each([false, true])("reads stored package bytes and supporting files (repository wrapper: %s)", async repository => {
    const f = await fixture(), s = await skill(f.spaceId);
    const markdown = "---\nname: packaged-review\ndescription: Review packaged content.\n---\n\nUse [checks](references/checks.md).";
    const root = repository ? "skills/review/" : "";
    const packageId = await skillPackageStore(db).prepare(f.spaceId, [
      { path: `${root}SKILL.md`, kind: "skill", content: markdown },
      { path: `${root}references/checks.md`, kind: "reference", content: "These bytes came from saved storage." },
    ]);
    await db.update(spaceSkillVersions).set({ fileInventory: [], ...(repository
      ? { repositorySnapshotId: packageId, repositorySkillPath: `${root}SKILL.md` }
      : { packageSnapshotId: packageId }) }).where(eq(spaceSkillVersions.id, s.versionId));
    const first = await f.call("load_skill", { skill: s.id, versionId: s.versionId }) as any;
    expect(first.text).toContain(repository ? ".outpost-repository/skills/review/SKILL.md" : "Use [checks]");
    const path = `${repository ? ".outpost-repository/" : ""}${root}references/checks.md`;
    expect(first.files).toContainEqual({ path, kind: "reference" });
    expect(await f.call("load_skill", { skill: s.id, versionId: s.versionId, path })).toMatchObject({ text: "These bytes came from saved storage." });
    expect(await f.authority.recover({ tool: "load_skill", callId: "recover-read", arguments: { skill: s.id, versionId: s.versionId, path } })).toMatchObject({ result: { text: "These bytes came from saved storage." } });
  });

  it("rechecks access after package storage I/O", async () => {
    const f = await fixture(), s = await skill(f.spaceId);
    const packageId = await skillPackageStore(db).prepare(f.spaceId, [{ path: "SKILL.md", kind: "skill", content: "Stored instructions" }]);
    await db.update(spaceSkillVersions).set({ packageSnapshotId: packageId, fileInventory: [] }).where(eq(spaceSkillVersions.id, s.versionId));
    const sourceId = randomUUID();
    await db.insert(spaceSkillSources).values({ id: sourceId, spaceId: f.spaceId, repositoryUrl: "https://github.com/example/private", fullName: "example/private", trackingRef: "HEAD", accessScope: "projects" });
    const storage = getStorageService(), read = storage.getObject.bind(storage);
    const fault = vi.spyOn(storage, "getObject").mockImplementation(async (...args) => {
      const result = await read(...args);
      await db.update(spaceSkills).set({ accessSourceId: sourceId }).where(eq(spaceSkills.id, s.id));
      return result;
    });
    try { await expect(f.call("load_skill", { skill: s.id })).rejects.toThrow("Skill not found"); }
    finally { fault.mockRestore(); }
  });

  it.each([false, true])("reuses text between pages and still rechecks access (repository: %s)", async repository => {
    const f = await fixture(), s = await skill(f.spaceId);
    const content = "x".repeat(16 * 1024 * 1024);
    const packageId = await skillPackageStore(db).prepare(f.spaceId, [
      { path: "SKILL.md", kind: "skill", content: "---\nname: review\ndescription: Review.\n---\n\nRead checks." },
      { path: "checks.md", kind: "reference", content },
    ]);
    await db.update(spaceSkillVersions).set({ fileInventory: [], ...(repository
      ? { repositorySnapshotId: packageId, repositorySkillPath: "SKILL.md" }
      : { packageSnapshotId: packageId }) }).where(eq(spaceSkillVersions.id, s.versionId));
    const path = `${repository ? ".outpost-repository/" : ""}checks.md`;
    const open = vi.spyOn(fs, "open"), read = vi.spyOn(fs, "readFile");
    const bodyReads = () => [...open.mock.calls, ...read.mock.calls].filter(args => String(args[0]).endsWith("/checks.md")).length;
    try {
      const first = await f.call("load_skill", { skill: s.id, path }) as any;
      const reads = bodyReads();
      expect(reads).toBeGreaterThan(0);
      expect(first.byteSize).toBe(content.length);
      expect(await f.call("load_skill", { skill: s.id, versionId: s.versionId, path, offset: first.nextOffset }))
        .toMatchObject({ text: content.slice(6000, 12000), sha256: null });
      expect(bodyReads()).toBe(reads);
      const sourceId = randomUUID();
      await db.insert(spaceSkillSources).values({ id: sourceId, spaceId: f.spaceId, repositoryUrl: "https://github.com/example/private", fullName: "example/private", trackingRef: "HEAD", accessScope: "projects" });
      await db.update(spaceSkills).set({ accessSourceId: sourceId }).where(eq(spaceSkills.id, s.id));
      expect(await f.call("load_skill", { skill: s.id, versionId: s.versionId, path, offset: 12000 }))
        .toMatchObject({ outcome: "failed", code: "runner_skill_not_found" });
    } finally { open.mockRestore(); read.mockRestore(); f.authority.close(); }
  });

  it.each([false, true])("reads repository files without waiting for the startup lock (cold: %s)", async cold => {
    const f = await fixture(), s = await skill(f.spaceId);
    const store = skillPackageStore(db);
    const packageId = await store.prepare(f.spaceId, [
      { path: "SKILL.md", kind: "skill", content: "---\nname: review\ndescription: Review.\n---\n\nRead checks." },
      { path: "checks.md", kind: "reference", content: "Repository checks." },
    ]);
    await db.update(spaceSkillVersions).set({ fileInventory: [], repositorySnapshotId: packageId, repositorySkillPath: "SKILL.md" })
      .where(eq(spaceSkillVersions.id, s.versionId));
    if (cold) {
      await rm(skillPackagePaths(f.spaceId, packageId).directory, { recursive: true, force: true });
    }
    let release!: () => void, acquired!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { acquired = resolve; });
    const lock = withSkillVersionCacheLock(db, f.spaceId, async () => { acquired(); await held; });
    await ready;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        (async () => {
          expect(await f.call("load_skill", { skill: s.id })).toMatchObject({ path: "SKILL.md" });
          expect(await f.call("load_skill", { skill: s.id, versionId: s.versionId, path: ".outpost-repository/checks.md" }))
            .toMatchObject({ text: "Repository checks." });
        })(),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("Skill read waited for the startup lock")), 3000); }),
      ]);
    } finally { clearTimeout(timeout); release(); await lock; f.authority.close(); }
  });

  it.each(["inline", "package", "repository"])("rejects oversized text before reading its body (%s)", async storage => {
    const f = await fixture(), s = await skill(f.spaceId);
    const root = storage === "repository" ? "skills/review/" : "";
    const files = [
      { path: `${root}SKILL.md`, kind: "skill" as const, content: "---\nname: review\ndescription: Review.\n---\n\nRead references." },
      { path: `${root}references/oversized.md`, kind: "reference" as const, content: "x".repeat(16 * 1024 * 1024 + 1) },
    ];
    if (storage === "inline") {
      await db.update(spaceSkillVersions).set({ fileInventory: files }).where(eq(spaceSkillVersions.id, s.versionId));
    } else {
      const packageId = await skillPackageStore(db).prepare(f.spaceId, files);
      await db.update(spaceSkillVersions).set({ fileInventory: [], ...(storage === "repository"
        ? { repositorySnapshotId: packageId, repositorySkillPath: `${root}SKILL.md` }
        : { packageSnapshotId: packageId }) }).where(eq(spaceSkillVersions.id, s.versionId));
    }
    const open = vi.spyOn(fs, "open"), read = vi.spyOn(fs, "readFile");
    try {
      const path = `${storage === "repository" ? ".outpost-repository/" : ""}${root}references/oversized.md`;
      for (const offset of [0, 6000]) {
        expect(await f.call("load_skill", { skill: s.id, versionId: s.versionId, path, offset }))
          .toMatchObject({ outcome: "failed", code: "runner_skill_file_size_limit" });
      }
      expect([...open.mock.calls, ...read.mock.calls].some(args => String(args[0]).endsWith("oversized.md"))).toBe(false);
    } finally { open.mockRestore(); read.mockRestore(); }
    expect(await f.call("load_skill", { skill: s.id, versionId: s.versionId })).toMatchObject({ path: "SKILL.md" });
  });

  it.each([false, true])("loads long supporting paths from the returned inventory (repository wrapper: %s)", async repository => {
    const f = await fixture(), s = await skill(f.spaceId);
    const root = repository ? "skills/review/" : "";
    const path = `${root}${("nested-" + "x".repeat(90) + "/").repeat(12)}checks.md`;
    const packageId = await skillPackageStore(db).prepare(f.spaceId, [
      { path: `${root}SKILL.md`, kind: "skill", content: "---\nname: review\ndescription: Review.\n---\n\nRead checks." },
      { path, kind: "reference", content: "Long paths remain readable." },
    ]);
    await db.update(spaceSkillVersions).set({ fileInventory: [], ...(repository
      ? { repositorySnapshotId: packageId, repositorySkillPath: `${root}SKILL.md` }
      : { packageSnapshotId: packageId }) }).where(eq(spaceSkillVersions.id, s.versionId));
    const first = await f.call("load_skill", { skill: s.id, versionId: s.versionId }) as any;
    const listedPath = first.files.find((file: { path: string; kind: string }) => file.kind === "reference").path;
    expect(listedPath.length).toBeGreaterThan(1000);
    expect(await f.call("load_skill", { skill: s.id, versionId: s.versionId, path: listedPath }))
      .toMatchObject({ text: "Long paths remain readable." });
  });

  it("pages the file inventory without repeating the response digest", async () => {
    const f = await fixture(), s = await skill(f.spaceId);
    await db.update(spaceSkillVersions).set({ fileInventory: [
      { path: "SKILL.md", kind: "skill", content: s.text },
      ...Array.from({ length: 50 }, (_, index) => ({ path: `references/${index}.md`, kind: "reference" as const, content: "Check." })),
    ] }).where(eq(spaceSkillVersions.id, s.versionId));
    const first = await f.call("load_skill", { skill: s.id }) as any;
    expect(first.files).toHaveLength(50);
    expect(first.nextFileOffset).toBe(50);
    const second = await f.call("load_skill", { skill: s.id, versionId: first.versionId, fileOffset: first.nextFileOffset }) as any;
    expect(second.files).toHaveLength(1);
    expect(second.nextFileOffset).toBeNull();
    expect(second.sha256).toBeNull();
  });

  it("keeps pages and reference reads on the selected immutable version", async () => {
    const f = await fixture(), s = await skill(f.spaceId, "long-review", "a".repeat(5999) + "🚀" + "b".repeat(2000));
    const first = await f.call("load_skill", { skill: s.id }) as any;
    expect(first.text.length).toBeLessThanOrEqual(6000);
    expect(first.sha256).toBe(createHash("sha256").update(s.text).digest("hex"));
    const changed = randomUUID();
    await db.insert(spaceSkillVersions).values({ id: changed, spaceId: f.spaceId, spaceSkillId: s.id, revisionNumber: 2, fileInventory: [{ path: "SKILL.md", kind: "skill", content: "New version" }] });
    await db.update(spaceSkills).set({ currentVersionId: changed }).where(eq(spaceSkills.id, s.id));
    const second = await f.call("load_skill", { skill: s.id, versionId: first.versionId, offset: first.nextOffset }) as any;
    expect(first.text + second.text).toBe(s.text);
    expect(second.sha256).toBeNull();
    expect(await f.call("load_skill", { skill: s.id, offset: first.nextOffset })).toMatchObject({ outcome: "failed", code: "runner_skill_invalid_arguments" });
  });

  it("hides foreign and project-restricted skills, including after access changes", async () => {
    const a = await fixture(), b = await fixture(), s = await skill(a.spaceId), foreign = await skill(b.spaceId);
    expect(await a.call("load_skill", { skill: foreign.id })).toMatchObject({ outcome: "failed", code: "runner_skill_not_found" });
    expect(await a.call("load_skill", { skill: s.id, versionId: foreign.versionId })).toMatchObject({ outcome: "failed", code: "runner_skill_version_not_found" });
    const sourceId = randomUUID();
    await db.insert(spaceSkillSources).values({ id: sourceId, spaceId: a.spaceId, repositoryUrl: "https://github.com/example/private", fullName: "example/private", trackingRef: "HEAD", accessScope: "projects" });
    await db.update(spaceSkills).set({ accessSourceId: sourceId }).where(eq(spaceSkills.id, s.id));
    expect(await a.call("search_skills", { query: "review" })).toMatchObject({ skills: [] });
    expect(await a.call("load_skill", { skill: s.id })).toMatchObject({ outcome: "failed", code: "runner_skill_not_found" });
  });

  it("rejects invalid paths, binary files, and stale run authority", async () => {
    const f = await fixture(), s = await skill(f.spaceId);
    for (const path of ["../SKILL.md", "/etc/passwd", "references\\checks.md"]) {
      expect(await f.call("load_skill", { skill: s.id, path })).toMatchObject({ outcome: "failed", code: "runner_skill_invalid_arguments" });
    }
    expect(await f.call("load_skill", { skill: s.id, path: "assets/icon.png" })).toMatchObject({ outcome: "failed", code: "runner_skill_binary_file" });
    expect(await f.call("load_skill", { skill: s.id, path: "missing.md" })).toMatchObject({ outcome: "failed", code: "runner_skill_file_not_found" });
    await db.update(heartbeatRuns).set({ status: "failed" }).where(eq(heartbeatRuns.id, f.runId));
    await expect(f.call("search_skills", {})).rejects.toThrow();
  });

  it("preserves the closed Muse, skill-test and completion-review profiles", async () => {
    const f = await fixture();
    for (const extra of [{ museRuntime: true }, { workMode: "skill_test" as const }, { nativeReview: {} as any }]) {
      const names = new OutpostRunnerToolAuthority(db, { ...f, ...extra }).definitions().map(t => t.name);
      expect(names).not.toContain("search_skills"); expect(names).not.toContain("load_skill");
    }
    for (const workMode of ["ask", "planning"] as const) {
      expect(new OutpostRunnerToolAuthority(db, { ...f, workMode }).definitions().map(t => t.name)).toEqual(expect.arrayContaining(["search_skills", "load_skill"]));
    }
  });
});
