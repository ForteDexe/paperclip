import { beforeEach, describe, expect, it } from "vitest";
import { claimOnboardingOffer, dashboardOnboardingOptions, resetOnboardingOffers } from "./onboarding-auto-open";

describe("dashboard onboarding recovery", () => {
  const setup = { id: "setup-1", spaceId: "space-1", pauseReason: "setup" as const, status: "paused" as const };
  const draft = JSON.stringify({ createdSpaceId: "space-1", setupAgentId: "setup-1", step: 4 });

  it("resumes the saved setup after a reload", () => {
    expect(dashboardOnboardingOptions("space-1", [setup], draft)).toEqual({ spaceId: "space-1", initialStep: 4 });
  });

  it("waits for agents and starts an empty space at the agent step", () => {
    expect(dashboardOnboardingOptions("space-1", undefined, draft)).toBeNull();
    expect(dashboardOnboardingOptions("space-1", [], null)).toEqual({ spaceId: "space-1", initialStep: 3 });
  });

  it("keeps the dashboard after the agent is created or another agent exists", () => {
    expect(dashboardOnboardingOptions("space-1", [{ ...setup, pauseReason: null, status: "idle" }], draft)).toBeNull();
    expect(dashboardOnboardingOptions("space-1", [setup, { ...setup, id: "ready", pauseReason: null, status: "idle" }], draft)).toBeNull();
    expect(dashboardOnboardingOptions("space-1", [setup], JSON.stringify({ createdSpaceId: "space-1", setupAgentId: "setup-1", createdAgentId: "setup-1" }))).toBeNull();
  });

  it("does not adopt missing, malformed, foreign or terminated drafts", () => {
    for (const raw of [null, "{", "null", "[]", JSON.stringify({ createdSpaceId: "space-other", setupAgentId: "setup-1" }), JSON.stringify({ createdSpaceId: "space-1", setupAgentId: "other" })]) {
      expect(dashboardOnboardingOptions("space-1", [setup], raw)).toBeNull();
    }
    expect(dashboardOnboardingOptions("space-other", [setup], draft)).toBeNull();
    expect(dashboardOnboardingOptions("space-1", [{ ...setup, status: "terminated" }], draft)).toBeNull();
  });
});

describe("claimOnboardingOffer", () => {
  beforeEach(resetOnboardingOffers);

  it("lets the first offer through", () => {
    expect(claimOnboardingOffer("space-1")).toBe(true);
  });

  it("refuses a second offer for the same space", () => {
    // The dashboard effect re-runs whenever a query behind it refetches, and
    // again on every return to the page. Neither may reopen a wizard the
    // customer closed.
    claimOnboardingOffer("space-1");
    expect(claimOnboardingOffer("space-1")).toBe(false);
  });

  it("offers each space once, in any order", () => {
    // A single stored space id fails here: declining for A, visiting B, then
    // returning to A would offer A again.
    expect(claimOnboardingOffer("space-a")).toBe(true);
    expect(claimOnboardingOffer("space-b")).toBe(true);
    expect(claimOnboardingOffer("space-a")).toBe(false);
    expect(claimOnboardingOffer("space-b")).toBe(false);
  });
});
