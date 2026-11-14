import { describe, expect, it } from "vitest";
import {
  spacePrefixFromOnboardingPath,
  isOnboardingPath,
  isOnboardingWizardActive,
  onboardingStepForSpace,
  resolveRouteOnboardingOptions,
  shouldRedirectSpacelessRouteToOnboarding,
  shouldRouteAgentlessSpaceToOnboarding,
  ONBOARDING_AGENT_STEP,
} from "./onboarding-route";

describe("isOnboardingPath", () => {
  it("matches the global onboarding route", () => {
    expect(isOnboardingPath("/onboarding")).toBe(true);
  });

  it("matches a space-prefixed onboarding route", () => {
    expect(isOnboardingPath("/pap/onboarding")).toBe(true);
  });

  it("ignores non-onboarding routes", () => {
    expect(isOnboardingPath("/pap/dashboard")).toBe(false);
  });
});

describe("resolveRouteOnboardingOptions", () => {
  it("opens space creation for the global onboarding route", () => {
    expect(
      resolveRouteOnboardingOptions({
        pathname: "/onboarding",
        spaces: [],
      }),
    ).toEqual({ initialStep: 1 });
  });

  it("opens creation when the prefixed space exists", () => {
    expect(
      resolveRouteOnboardingOptions({
        pathname: "/pap/onboarding",
        spacePrefix: "pap",
        spaces: [{ id: "space-1", issuePrefix: "PAP" }],
      }),
    ).toEqual({ initialStep: ONBOARDING_AGENT_STEP, spaceId: "space-1" });
  });

  it("falls back to space creation when the prefixed space is missing", () => {
    expect(
      resolveRouteOnboardingOptions({
        pathname: "/pap/onboarding",
        spacePrefix: "pap",
        spaces: [],
      }),
    ).toEqual({ initialStep: 1 });
  });
});

describe("shouldRedirectSpacelessRouteToOnboarding", () => {
  it("redirects spaceless entry routes into onboarding", () => {
    expect(
      shouldRedirectSpacelessRouteToOnboarding({
        pathname: "/",
        hasSpaces: false,
      }),
    ).toBe(true);
  });

  it("does not redirect when already on onboarding", () => {
    expect(
      shouldRedirectSpacelessRouteToOnboarding({
        pathname: "/onboarding",
        hasSpaces: false,
      }),
    ).toBe(false);
  });

  it("does not redirect when spaces exist", () => {
    expect(
      shouldRedirectSpacelessRouteToOnboarding({
        pathname: "/issues",
        hasSpaces: true,
      }),
    ).toBe(false);
  });
});

describe("isOnboardingWizardActive", () => {
  it("is active on the freshly-landed onboarding route (auto-open, not dismissed)", () => {
    expect(
      isOnboardingWizardActive({ onboardingOpen: false, routeDismissed: false }),
    ).toBe(true);
  });

  it("hands off to the launcher once the wizard is dismissed and not re-opened", () => {
    expect(
      isOnboardingWizardActive({ onboardingOpen: false, routeDismissed: true }),
    ).toBe(false);
  });

  it("stays active when explicitly re-opened after a dismissal", () => {
    expect(
      isOnboardingWizardActive({ onboardingOpen: true, routeDismissed: true }),
    ).toBe(true);
  });
});

describe("spacePrefixFromOnboardingPath", () => {
  it("reads the prefix from a space onboarding path", () => {
    expect(spacePrefixFromOnboardingPath("/PC7409/onboarding")).toBe("PC7409");
  });

  it("keeps the prefix as written so the caller decides how to compare it", () => {
    // resolveRouteOnboardingOptions already matches case-insensitively.
    // Normalising here as well would hide which half owns the comparison.
    expect(spacePrefixFromOnboardingPath("/pc7409/Onboarding")).toBe("pc7409");
  });

  it("has no prefix to read on the unprefixed route", () => {
    expect(spacePrefixFromOnboardingPath("/onboarding")).toBeUndefined();
  });

  it("ignores paths that only look like onboarding", () => {
    expect(spacePrefixFromOnboardingPath("/PC7409/onboarding/extra")).toBeUndefined();
    expect(spacePrefixFromOnboardingPath("/PC7409/dashboard")).toBeUndefined();
    expect(spacePrefixFromOnboardingPath("/")).toBeUndefined();
  });

  it("agrees with isOnboardingPath about what an onboarding path is", () => {
    // The two parse the same shape. If they ever disagree the wizard would
    // open on a path that resolves no space, or resolve a space on a path
    // that is not onboarding.
    for (const pathname of ["/onboarding", "/PC1/onboarding", "/PC1/dash", "/a/b/c"]) {
      const prefix = spacePrefixFromOnboardingPath(pathname);
      if (prefix !== undefined) expect(isOnboardingPath(pathname)).toBe(true);
    }
  });

  it("feeds resolveRouteOnboardingOptions the prefix useParams cannot supply", () => {
    // The regression this fixes: the wizard renders beside <Routes>, so
    // useParams() returned nothing and every space route opened at step 1.
    const spaces = [{ id: "c1", issuePrefix: "PC7409" }];
    const pathname = "/PC7409/onboarding";

    expect(
      resolveRouteOnboardingOptions({ pathname, spacePrefix: undefined, spaces }),
    ).toEqual({ initialStep: 1 });

    expect(
      resolveRouteOnboardingOptions({
        pathname,
        spacePrefix: spacePrefixFromOnboardingPath(pathname),
        spaces,
      }),
    ).toEqual({ initialStep: ONBOARDING_AGENT_STEP, spaceId: "c1" });
  });
});

describe("navigating away from a space's onboarding route", () => {
  const spaces = [{ id: "c1", issuePrefix: "PC1" }];

  // The wizard is a persistent overlay, so it survives navigation and keeps
  // its state. Once the route can supply a spaceId - which it could not
  // before spacePrefixFromOnboardingPath existed - leaving that route has to
  // withdraw it, or the wizard shows "create a space" while still holding
  // the previous one.
  it("stops supplying a space once the path no longer names one", () => {
    const onSpaceRoute = resolveRouteOnboardingOptions({
      pathname: "/PC1/onboarding",
      spacePrefix: spacePrefixFromOnboardingPath("/PC1/onboarding"),
      spaces,
    });
    expect(onSpaceRoute).toEqual({ initialStep: ONBOARDING_AGENT_STEP, spaceId: "c1" });

    const afterNavigating = resolveRouteOnboardingOptions({
      pathname: "/onboarding",
      spacePrefix: spacePrefixFromOnboardingPath("/onboarding"),
      spaces,
    });
    expect(afterNavigating).toEqual({ initialStep: 1 });
    expect(afterNavigating?.spaceId).toBeUndefined();
  });

  it("supplies no space for a prefix that matches nothing", () => {
    expect(
      resolveRouteOnboardingOptions({
        pathname: "/NOPE/onboarding",
        spacePrefix: spacePrefixFromOnboardingPath("/NOPE/onboarding"),
        spaces,
      }),
    ).toEqual({ initialStep: 1 });
  });
});

describe("shouldRouteAgentlessSpaceToOnboarding", () => {
  it("sends a space with no agents to onboarding", () => {
    expect(
      shouldRouteAgentlessSpaceToOnboarding({
        pathname: "/PC1/dashboard",
        agentsLoaded: true,
        agentCount: 0,
      }),
    ).toBe(true);
  });

  it("leaves a space that has agents alone", () => {
    expect(
      shouldRouteAgentlessSpaceToOnboarding({
        pathname: "/PC1/dashboard",
        agentsLoaded: true,
        agentCount: 1,
      }),
    ).toBe(false);
  });

  it("waits for the agent list before deciding", () => {
    // In flight, the list is undefined and reads exactly like an empty one.
    // Deciding here would bounce every user through onboarding on each cold
    // load — the count is zero only because nothing has arrived yet.
    expect(
      shouldRouteAgentlessSpaceToOnboarding({
        pathname: "/PC1/dashboard",
        agentsLoaded: false,
        agentCount: 0,
      }),
    ).toBe(false);
  });

  it("does not trust a cached empty list while it is being refreshed", () => {
    // The wizard creations the first agent and lands on the first task. A
    // dashboard reached from there can still hold the empty list it cached
    // before the create, with the refetch in flight — offering on it reopens
    // "Create your first agent" for a space that just got one.
    expect(
      shouldRouteAgentlessSpaceToOnboarding({
        pathname: "/PC1/dashboard",
        agentsLoaded: true,
        agentsRefreshing: true,
        agentCount: 0,
      }),
    ).toBe(false);
    expect(
      shouldRouteAgentlessSpaceToOnboarding({
        pathname: "/PC1/dashboard",
        agentsLoaded: true,
        agentsRefreshing: false,
        agentCount: 0,
      }),
    ).toBe(true);
  });

  it("does not redirect onto onboarding from onboarding", () => {
    // The loop: finish the wizard without creating an agent, and a redirect
    // that ignored the current path would send you straight back in.
    for (const pathname of ["/onboarding", "/PC1/onboarding"]) {
      expect(
        shouldRouteAgentlessSpaceToOnboarding({
          pathname,
          agentsLoaded: true,
          agentCount: 0,
        }),
      ).toBe(false);
    }
  });
});

describe("resolveRouteOnboardingOptions — the agent step", () => {
  const spaces = [{ id: "c1", issuePrefix: "PC1" }];

  it("opens an existing space on the agent step", () => {
    expect(
      resolveRouteOnboardingOptions({
        pathname: "/PC1/onboarding",
        spacePrefix: "PC1",
        spaces,
      }),
    ).toEqual({ initialStep: ONBOARDING_AGENT_STEP, spaceId: "c1" });
  });

  it("never resolves into the create wizard on a managed stack", () => {
    // POST /spaces is a 403 floor on Cloud-managed stacks — a create wizard
    // there is a dead end wearing a form. A managed stack holds exactly one
    // space, so the useful reading of a bare or unmatched onboarding path is
    // that space's agent arc.
    const one = [{ id: "c1", issuePrefix: "PC1" }];
    expect(
      resolveRouteOnboardingOptions({
        pathname: "/onboarding",
        spaces: one,
        cloudManaged: true,
      }),
    ).toEqual({ initialStep: ONBOARDING_AGENT_STEP, spaceId: "c1" });
    expect(
      resolveRouteOnboardingOptions({
        pathname: "/NOPE/onboarding",
        spacePrefix: "NOPE",
        spaces: one,
        cloudManaged: true,
      }),
    ).toEqual({ initialStep: ONBOARDING_AGENT_STEP, spaceId: "c1" });
  });

  it("opens nothing on a managed stack whose spaces are not exactly one", () => {
    // Zero spaces means the list is still loading or errored — offering
    // creation would 403; opening an arc would name nobody. Do neither.
    for (const spaces of [[], [{ id: "c1", issuePrefix: "PC1" }, { id: "c2", issuePrefix: "PC2" }]]) {
      expect(
        resolveRouteOnboardingOptions({
          pathname: "/onboarding",
          spaces,
          cloudManaged: true,
        }),
      ).toBeNull();
    }
  });

  it("keeps sending an unmatched prefix to space creation", () => {
    expect(
      resolveRouteOnboardingOptions({
        pathname: "/NOPE/onboarding",
        spacePrefix: "NOPE",
        spaces,
      }),
    ).toEqual({ initialStep: 1 });
  });
});

describe("onboardingStepForSpace", () => {
  it("opens an existing space on the agent step", () => {
    expect(onboardingStepForSpace()).toBe(ONBOARDING_AGENT_STEP);
  });
});
