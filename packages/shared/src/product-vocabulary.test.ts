import { describe, expect, it } from "vitest";
import { countedProductLabel, PRODUCT_VOCABULARY, productLabel } from "./product-vocabulary.js";

describe("product vocabulary", () => {
  it("provides structured title and lowercase forms", () => {
    expect(PRODUCT_VOCABULARY.northStar).toEqual({
      singular: "North Star",
      plural: "North Stars",
      lowerSingular: "north star",
      lowerPlural: "north stars",
    });
  });

  it("selects singular, plural, and casing without changing domain identifiers", () => {
    expect(productLabel("space")).toBe("Space");
    expect(productLabel("space", { count: 2 })).toBe("Spaces");
    expect(productLabel("defaultAgent", { casing: "lower" })).toBe("default agent");
    expect(productLabel("coordinationLead")).toBe("Coordination lead");
    expect(productLabel("agentHierarchy", { count: 2, casing: "lower" })).toBe("agent hierarchies");
    expect(productLabel("operator", { count: 2, casing: "lower" })).toBe("operators");
    expect(countedProductLabel("artifact", 1)).toBe("1 artifact");
    expect(countedProductLabel("artifact", 3)).toBe("3 artifacts");
  });
});
