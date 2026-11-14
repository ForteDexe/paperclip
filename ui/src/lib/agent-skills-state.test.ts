import { describe, expect, it } from "vitest";
import {
  applyAgentSkillSnapshot,
  isReadOnlyUnmanagedSkillEntry,
  sameSkillSelection,
  shouldScheduleSkillAutosave,
} from "./agent-skills-state";

describe("sameSkillSelection", () => {
  it("treats selections as order-independent sets", () => {
    expect(sameSkillSelection(["a", "b", "c"], ["c", "a", "b"])).toBe(true);
  });

  it("detects added or removed keys", () => {
    expect(sameSkillSelection(["a", "b"], ["a"])).toBe(false);
    expect(sameSkillSelection(["a"], ["a", "b"])).toBe(false);
  });
});

describe("shouldScheduleSkillAutosave", () => {
  it("does not re-save when the server returns the same set in a different order", () => {
    // Server preserves stale keys but groups them at the end; the draft keeps the
    // user's order. Same set → already saved, no re-fire (would loop otherwise).
    expect(
      shouldScheduleSkillAutosave({
        draft: ["outpost", "stale/removed/skill", "ascii-art"],
        lastSaved: ["outpost", "ascii-art", "stale/removed/skill"],
        failedDraft: null,
      }),
    ).toBe(false);
  });

  it("does not save when the draft already matches what was saved", () => {
    expect(
      shouldScheduleSkillAutosave({
        draft: ["outpost"],
        lastSaved: ["outpost"],
        failedDraft: null,
      }),
    ).toBe(false);
  });

  it("saves when the draft diverges from the last saved state", () => {
    expect(
      shouldScheduleSkillAutosave({
        draft: ["outpost", "ascii-art"],
        lastSaved: ["outpost"],
        failedDraft: null,
      }),
    ).toBe(true);
  });

  it("holds a payload that just failed to prevent a retry storm (PAP-13222)", () => {
    const draft = ["outpost", "stale/removed/skill"];
    expect(
      shouldScheduleSkillAutosave({
        draft,
        lastSaved: ["outpost"],
        failedDraft: [...draft],
      }),
    ).toBe(false);
  });

  it("resumes saving once the user edits the draft after a failure", () => {
    expect(
      shouldScheduleSkillAutosave({
        draft: ["outpost", "ascii-art"],
        lastSaved: ["outpost"],
        failedDraft: ["outpost", "stale/removed/skill"],
      }),
    ).toBe(true);
  });
});

describe("applyAgentSkillSnapshot", () => {
  it("hydrates the initial snapshot without arming autosave", () => {
    const result = applyAgentSkillSnapshot(
      {
        draft: [],
        lastSaved: [],
        hasHydratedSnapshot: false,
      },
      ["outpost", "para-memory-files"],
    );

    expect(result).toEqual({
      draft: ["outpost", "para-memory-files"],
      lastSaved: ["outpost", "para-memory-files"],
      hasHydratedSnapshot: true,
      shouldSkipAutosave: true,
    });
  });

  it("keeps unsaved local edits when a fresh snapshot arrives", () => {
    const result = applyAgentSkillSnapshot(
      {
        draft: ["outpost", "custom-skill"],
        lastSaved: ["outpost"],
        hasHydratedSnapshot: true,
      },
      ["outpost"],
    );

    expect(result).toEqual({
      draft: ["outpost", "custom-skill"],
      lastSaved: ["outpost"],
      hasHydratedSnapshot: true,
      shouldSkipAutosave: false,
    });
  });

  it("adopts server state after a successful save and skips the follow-up autosave pass", () => {
    const result = applyAgentSkillSnapshot(
      {
        draft: ["outpost", "custom-skill"],
        lastSaved: ["outpost", "custom-skill"],
        hasHydratedSnapshot: true,
      },
      ["outpost", "custom-skill"],
    );

    expect(result).toEqual({
      draft: ["outpost", "custom-skill"],
      lastSaved: ["outpost", "custom-skill"],
      hasHydratedSnapshot: true,
      shouldSkipAutosave: true,
    });
  });

  it("treats user-installed entries outside the space library as read-only unmanaged skills", () => {
    expect(isReadOnlyUnmanagedSkillEntry({
      key: "crack-python",
      runtimeName: "crack-python",
      desired: false,
      managed: false,
      state: "external",
      origin: "user_installed",
    }, new Set(["outpost"]))).toBe(true);
  });

  it("keeps space-library entries in the managed section even when the adapter reports an external conflict", () => {
    expect(isReadOnlyUnmanagedSkillEntry({
      key: "outpost",
      runtimeName: "outpost",
      desired: true,
      managed: false,
      state: "external",
      origin: "space_managed",
    }, new Set(["outpost"]))).toBe(false);
  });

  it("falls back to legacy snapshots that only mark unmanaged external entries", () => {
    expect(isReadOnlyUnmanagedSkillEntry({
      key: "legacy-external",
      runtimeName: "legacy-external",
      desired: false,
      managed: false,
      state: "external",
    }, new Set())).toBe(true);
  });
});
