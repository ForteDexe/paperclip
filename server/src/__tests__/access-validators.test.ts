import { describe, expect, it } from "vitest";
import { updateCompanyMemberWithPermissionsSchema } from "@paperclipai/shared";

describe("access validators", () => {
  it("defaults omitted combined member grants to an empty list", () => {
    const result = updateCompanyMemberWithPermissionsSchema.parse({
      membershipRole: "operator",
    });

    expect(result.grants).toEqual([]);
  });
});
