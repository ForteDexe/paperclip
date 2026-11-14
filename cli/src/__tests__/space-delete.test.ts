import { describe, expect, it } from "vitest";
import type { Space } from "@outpost/shared";
import { assertDeleteConfirmation, resolveSpaceForDeletion } from "../commands/client/space.js";

function makeSpace(overrides: Partial<Space>): Space {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Alpha",
    description: null,
    workspaceRoot: null,
    status: "active",
    pauseReason: null,
    pausedAt: null,
    issuePrefix: "ALP",
    issueCounter: 1,
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    requireOperatorApprovalForNewAgents: false,
    feedbackDataSharingEnabled: false,
    feedbackDataSharingConsentAt: null,
    feedbackDataSharingConsentByUserId: null,
    feedbackDataSharingTermsVersion: null,
    logoAssetId: null,
    logoUrl: null,
    defaultResponsibleUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
    primaryAgentId: overrides.primaryAgentId ?? null,
    interactionResolverPolicy: overrides.interactionResolverPolicy ?? {},
  };
}

describe("resolveSpaceForDeletion", () => {
  const spaces: Space[] = [
    makeSpace({
      id: "11111111-1111-1111-1111-111111111111",
      name: "Alpha",
      issuePrefix: "ALP",
    }),
    makeSpace({
      id: "22222222-2222-2222-2222-222222222222",
      name: "Outpost",
      issuePrefix: "PAP",
    }),
  ];

  it("resolves by ID in auto mode", () => {
    const result = resolveSpaceForDeletion(spaces, "22222222-2222-2222-2222-222222222222", "auto");
    expect(result.issuePrefix).toBe("PAP");
  });

  it("resolves by prefix in auto mode", () => {
    const result = resolveSpaceForDeletion(spaces, "pap", "auto");
    expect(result.id).toBe("22222222-2222-2222-2222-222222222222");
  });

  it("throws when selector is not found", () => {
    expect(() => resolveSpaceForDeletion(spaces, "MISSING", "auto")).toThrow(/No space found/);
  });

  it("respects explicit id mode", () => {
    expect(() => resolveSpaceForDeletion(spaces, "PAP", "id")).toThrow(/No space found by ID/);
  });

  it("respects explicit prefix mode", () => {
    expect(() => resolveSpaceForDeletion(spaces, "22222222-2222-2222-2222-222222222222", "prefix"))
      .toThrow(/No space found by shortname/);
  });
});

describe("assertDeleteConfirmation", () => {
  const space = makeSpace({
    id: "22222222-2222-2222-2222-222222222222",
    issuePrefix: "PAP",
  });

  it("requires --yes", () => {
    expect(() => assertDeleteConfirmation(space, { confirm: "PAP" })).toThrow(/requires --yes/);
  });

  it("accepts matching prefix confirmation", () => {
    expect(() => assertDeleteConfirmation(space, { yes: true, confirm: "pap" })).not.toThrow();
  });

  it("accepts matching id confirmation", () => {
    expect(() =>
      assertDeleteConfirmation(space, {
        yes: true,
        confirm: "22222222-2222-2222-2222-222222222222",
      })).not.toThrow();
  });

  it("rejects mismatched confirmation", () => {
    expect(() => assertDeleteConfirmation(space, { yes: true, confirm: "nope" }))
      .toThrow(/does not match target space/);
  });
});
