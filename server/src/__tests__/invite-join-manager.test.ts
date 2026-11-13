import { describe, expect, it } from "vitest";
import { resolveJoinRequestAgentManagerId } from "../routes/access.js";

describe("resolveJoinRequestAgentManagerId", () => {
  it("selects a root peer when no default agent is set", () => {
    const managerId = resolveJoinRequestAgentManagerId([
      { id: "a1", role: "cto", reportsTo: null },
      { id: "a2", role: "engineer", reportsTo: "a1" },
    ]);

    expect(managerId).toBe("a1");
  });

  it("prefers the explicit default agent", () => {
    const managerId = resolveJoinRequestAgentManagerId([
      { id: "root", role: "general", reportsTo: null },
      { id: "primary", role: "general", reportsTo: "root" },
    ], "primary");

    expect(managerId).toBe("primary");
  });

  it("does not prioritize a CEO title over the first root peer", () => {
    const managerId = resolveJoinRequestAgentManagerId([
      { id: "ceo-child", role: "ceo", reportsTo: "manager-1" },
      { id: "manager-1", role: "cto", reportsTo: null },
      { id: "ceo-root", role: "ceo", reportsTo: null },
    ]);

    expect(managerId).toBe("manager-1");
  });

  it("prefers an available root peer over nested agents", () => {
    const managerId = resolveJoinRequestAgentManagerId([
      { id: "ceo-1", role: "ceo", reportsTo: "mgr" },
      { id: "ceo-2", role: "ceo", reportsTo: "mgr" },
      { id: "mgr", role: "cto", reportsTo: null },
    ]);

    expect(managerId).toBe("mgr");
  });

  it("returns null for an empty Space", () => {
    expect(resolveJoinRequestAgentManagerId([])).toBeNull();
  });
});
