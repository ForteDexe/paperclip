import { describe, expect, it } from "vitest";
import { assertLegacyAgentInviteAdapterType } from "../routes/access.js";

describe("assertLegacyAgentInviteAdapterType", () => {
  it("rejects native runner for new and pending agent-invite onboarding", () => {
    expect(() => assertLegacyAgentInviteAdapterType("outpost_runner")).toThrow(
      "Outpost Runner is not available through agent invite onboarding.",
    );
    expect(() => assertLegacyAgentInviteAdapterType("claude_local")).not.toThrow();
    expect(() => assertLegacyAgentInviteAdapterType(null)).not.toThrow();
  });
});
