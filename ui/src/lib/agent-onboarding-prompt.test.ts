import { describe, expect, it } from "vitest";
import { buildAgentOnboardingPrompt } from "./agent-onboarding-prompt";

describe("buildAgentOnboardingPrompt", () => {
  it("includes generic external-agent onboarding without provider-specific gateways", () => {
    const prompt = buildAgentOnboardingPrompt({
      onboardingTextUrl: "http://localhost:3100/api/invites/token-123/onboarding.txt",
      connectionCandidates: ["http://192.168.1.10:3100"],
    });

    expect(prompt).toContain("http://192.168.1.10:3100");
    expect(prompt).toContain("Submit an agent join request");
    expect(prompt).toContain("Do not rotate or invent an Outpost key manually");
    expect(prompt).toContain("parsed `token` field from the raw HTTP JSON response");
    expect(prompt).toContain("A token value containing literal `...` or `[redacted]`");
    expect(prompt).not.toContain("openclaw_gateway");
    expect(prompt).not.toContain("hermes_gateway");
  });
});
