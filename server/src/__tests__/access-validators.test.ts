import { describe, expect, it } from "vitest";
import { updateSpaceMemberWithPermissionsSchema } from "@outpost/shared";

describe("access validators", () => {
  it("defaults omitted combined member grants to an empty list", () => {
    const result = updateSpaceMemberWithPermissionsSchema.parse({
      membershipRole: "operator",
    });

    expect(result.grants).toEqual([]);
  });
});
