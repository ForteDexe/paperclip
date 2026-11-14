import { describe, expect, it } from "vitest";
import { restoreOnboardingState } from "./onboarding-state";

const spaces = [{ id: "space-new" }];

describe("restoreOnboardingState", () => {
  it("returns null for unusable input", () => {
    expect(restoreOnboardingState(null, spaces)).toBeNull();
    expect(restoreOnboardingState("nonsense", spaces)).toBeNull();
  });

  it("discards state whose space the user does not own", () => {
    const saved = { step: 4, spaceName: "Old Co", createdSpaceId: "space-old" };
    expect(restoreOnboardingState(saved, spaces)).toBeNull();
  });

  it("keeps state for a space the user does own", () => {
    const saved = { step: 4, spaceName: "New Co", createdSpaceId: "space-new" };
    expect(restoreOnboardingState(saved, spaces)?.spaceName).toBe("New Co");
  });

  it("keeps in-progress state that has no space yet", () => {
    const saved = { step: 1, spaceName: "Draft" };
    expect(restoreOnboardingState(saved, spaces)?.spaceName).toBe("Draft");
  });

  it("discards a space id against an empty (settled) spaces list", () => {
    // Per the CONTRACT in the JSDoc, callers must only invoke this once
    // spaces have settled. An empty settled list legitimately means the
    // account owns no spaces, so a saved space id is discarded exactly
    // like an unowned one.
    const saved = { step: 4, createdSpaceId: "space-new" };
    expect(restoreOnboardingState(saved, [])).toBeNull();
  });
});
