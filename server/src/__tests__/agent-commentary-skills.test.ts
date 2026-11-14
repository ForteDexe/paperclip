import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureCodexSkillsInjected, listCodexSkills } from "@outpost/adapter-codex-local/server";
import { listClaudeSkills } from "@outpost/adapter-claude-local/server";
import { readPaperclipRuntimeSkillEntries, resolveLegacyPaperclipDesiredSkillNames } from "@outpost/adapter-utils/server-utils";
import { prepareClaudePromptBundle } from "../../../packages/adapters/claude-local/src/server/prompt-cache.js";
import { stageCodexHomeForSync } from "../../../packages/adapters/codex-local/src/server/codex-home.js";

describe("minimal default skill delivery", () => {
  const cleanup: string[] = [];
  const operationalKey = "paperclipai/paperclip/paperclip";
  const retiredFeedbackKeys = ["complain", "suggestion-box"].map(name => `paperclipai/paperclip/${name}`);
  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(cleanup.splice(0).map(root => rm(root, { recursive: true, force: true })));
  });

  it.each([undefined, []])("resolves only the operational default for Codex and Claude with selection %s", async (desiredSkills) => {
    const config = desiredSkills ? { paperclipSkillSync: { desiredSkills } } : {};
    for (const [adapterType, list] of [["codex_local", listCodexSkills], ["claude_local", listClaudeSkills]] as const) {
      const snapshot = await list({ agentId: "agent", companyId: "company", adapterType, config });
      expect(snapshot.desiredSkills).toEqual([operationalKey]);
      expect(snapshot.entries.find(e => e.key === operationalKey)?.state).toBe("configured");
      expect(snapshot.desiredSkills).not.toEqual(expect.arrayContaining(retiredFeedbackKeys));
    }
  });

  it("does not mount retired feedback skills into Codex or Claude homes", async () => {
    const root = await mkdtemp(join(tmpdir(), "paperclip-commentary-skills-"));
    cleanup.push(root);
    vi.stubEnv("OUTPOST_HOME", root);
    const entries = await readPaperclipRuntimeSkillEntries({}, import.meta.dirname, [fileURLToPath(new URL("../../../skills", import.meta.url))]);
    const desiredSkillNames = resolveLegacyPaperclipDesiredSkillNames({}, entries);
    const selected = entries.filter(e => desiredSkillNames.includes(e.key));
    const codexHome = join(root, "codex");
    await ensureCodexSkillsInjected(async () => {}, { skillsHome: join(codexHome, "skills"), skillsEntries: entries, desiredSkillNames });
    const claude = await prepareClaudePromptBundle({ companyId: "company", skills: selected, instructionsContents: null, onLog: async () => {} });
    const staged = await stageCodexHomeForSync(codexHome, { runId: "commentary-test" });
    cleanup.push(staged);
    for (const skills of [join(codexHome, "skills"), join(claude.addDir, ".claude", "skills"), join(staged, "skills")]) {
      for (const name of ["complain", "suggestion-box"]) {
        await expect(readFile(join(skills, name, "SKILL.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      }
    }
    // Runtime policy removes entries before default selection; never resurrect them.
    const restricted = entries.filter(e => e.key === operationalKey);
    expect(resolveLegacyPaperclipDesiredSkillNames({}, restricted)).toEqual([operationalKey]);
    expect(await readPaperclipRuntimeSkillEntries({ paperclipRuntimeSkills: [] }, import.meta.dirname)).toEqual([]);
  });
});
