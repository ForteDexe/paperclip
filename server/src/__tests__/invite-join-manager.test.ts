import { describe, expect, it } from "vitest";
import { resolveJoinRequestAgentManagerId } from "../routes/access.js";

describe("resolveJoinRequestAgentManagerId", () => {
  it("selects a root peer when no default agent is set", () => {
    const managerId = resolveJoinRequestAgentManagerId([
      { id: "a1", role: "engineering_lead", reportsTo: null },
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

  it("does not prioritize a Default agent title over the first root peer", () => {
    const managerId = resolveJoinRequestAgentManagerId([
      { id: "lead-child", role: "lead", reportsTo: "manager-1" },
      { id: "manager-1", role: "engineering_lead", reportsTo: null },
      { id: "lead-root", role: "lead", reportsTo: null },
    ]);

    expect(managerId).toBe("manager-1");
  });

  it("prefers an available root peer over nested agents", () => {
    const managerId = resolveJoinRequestAgentManagerId([
      { id: "lead-1", role: "lead", reportsTo: "mgr" },
      { id: "lead-2", role: "lead", reportsTo: "mgr" },
      { id: "mgr", role: "engineering_lead", reportsTo: null },
    ]);

    expect(managerId).toBe("mgr");
  });

  it("returns null for an empty Space", () => {
    expect(resolveJoinRequestAgentManagerId([])).toBeNull();
  });
});
