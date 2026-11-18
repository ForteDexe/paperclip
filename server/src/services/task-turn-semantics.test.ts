import { describe, expect, it } from "vitest";

import { usesChatTurnSemantics } from "./task-turn-semantics.js";

describe("usesChatTurnSemantics", () => {
  it("uses chat turns for ordinary tasks and Agent Chat", () => {
    expect(usesChatTurnSemantics({ harnessKind: null })).toBe(true);
    expect(usesChatTurnSemantics({ conversationAgentId: "agent", harnessKind: null })).toBe(true);
  });

  it("keeps the skill-test harness strict", () => {
    expect(usesChatTurnSemantics({ harnessKind: "skill_test" })).toBe(false);
    expect(usesChatTurnSemantics(null)).toBe(false);
  });
});
