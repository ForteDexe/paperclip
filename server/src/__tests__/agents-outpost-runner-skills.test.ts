import { describe, expect, it } from "vitest";
import { OUTPOST_RUNNER_DEFAULT_MODELS } from "@outpost/adapter-utils/outpost-runner-permissions";
import {
  normalizePaperclipOperationalSkillPreference,
  normalizePaperclipRunnerAdapterConfig,
  OUTPOST_OPERATIONAL_SKILL_KEY,
  resolveLegacyPaperclipDesiredSkillNames,
} from "@outpost/adapter-utils/server-utils";

const legacyConfig = {
  paperclipSkillSync: {
    desiredSkills: [OUTPOST_OPERATIONAL_SKILL_KEY],
  },
};

describe("outpost_runner operational skill normalization", () => {
  it("applies full-auto native runner defaults at persistence boundaries", () => {
    expect(normalizePaperclipRunnerAdapterConfig("outpost_runner", {})).toEqual({
      provider: "codex",
      model: OUTPOST_RUNNER_DEFAULT_MODELS.codex,
      codexPermissionMode: "never",
    });
  });

  it("repairs an existing blank model without replacing an explicit model", () => {
    expect(normalizePaperclipRunnerAdapterConfig("outpost_runner", { model: "" }))
      .toMatchObject({ model: OUTPOST_RUNNER_DEFAULT_MODELS.codex });
    expect(normalizePaperclipRunnerAdapterConfig("outpost_runner", { model: "gpt-5.5" }))
      .toMatchObject({ model: "gpt-5.5" });
  });

  it("does not replace a non-Codex provider model with the Codex default", () => {
    expect(normalizePaperclipRunnerAdapterConfig("outpost_runner", {
      provider: "claude_managed",
      model: "claude-sonnet-5",
    })).toMatchObject({
      provider: "claude_managed",
      model: "claude-sonnet-5",
    });
  });

  it("removes the legacy operational skill while preserving optional skills", () => {
    const normalized = normalizePaperclipOperationalSkillPreference("outpost_runner", {
      paperclipSkillSync: {
        desiredSkills: [OUTPOST_OPERATIONAL_SKILL_KEY, "company-1/reviewer"],
      },
    });

    expect(normalized).toEqual({
      paperclipSkillSync: { desiredSkills: ["company-1/reviewer"] },
    });
  });

  it("restores the required operational skill through the legacy resolver after switching back", () => {
    const normalized = normalizePaperclipOperationalSkillPreference("outpost_runner", legacyConfig);
    expect(resolveLegacyPaperclipDesiredSkillNames(normalized, [{
      key: OUTPOST_OPERATIONAL_SKILL_KEY,
      runtimeName: "paperclip",
    }])).toEqual([OUTPOST_OPERATIONAL_SKILL_KEY]);
  });

  it("does not change direct adapter preferences", () => {
    expect(normalizePaperclipOperationalSkillPreference("codex_local", legacyConfig)).toBe(legacyConfig);
  });
});
