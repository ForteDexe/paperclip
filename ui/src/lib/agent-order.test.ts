import { describe, expect, it } from "vitest";
import type { Agent } from "@paperclipai/shared";
import { sortAgentsByDefaultSidebarOrder, sortAgentsByStoredOrder } from "./agent-order";

function makeAgent(overrides: Partial<Agent> & { id: string; name: string }): Agent {
  return {
    role: "general",
    reportsTo: null,
    ...overrides,
  } as Agent;
}

describe("sortAgentsByDefaultSidebarOrder", () => {
  it("orders root peers alphabetically without interpreting titles as rank", () => {
    const agents = [
      makeAgent({ id: "builder", name: "Builder", role: "general" }),
      makeAgent({ id: "lead", name: "Lead", role: "general" }),
      makeAgent({ id: "ada", name: "Ada", role: "engineer" }),
    ];
    const sorted = sortAgentsByDefaultSidebarOrder(agents);
    expect(sorted.map((a) => a.id)).toEqual(["ada", "builder", "lead"]);
  });

  it("keeps reports grouped after their coordinator while ordering siblings alphabetically", () => {
    const agents = [
      makeAgent({ id: "lead", name: "Sam", role: "general" }),
      makeAgent({ id: "eng", name: "Zoe", role: "engineer", reportsTo: "lead" }),
      makeAgent({ id: "tool", name: "Amy", role: "general", reportsTo: "lead" }),
    ];
    const sorted = sortAgentsByDefaultSidebarOrder(agents);
    expect(sorted.map((a) => a.id)).toEqual(["lead", "tool", "eng"]);
  });

  it("respects an explicit stored order over the alphabetical default", () => {
    const agents = [
      makeAgent({ id: "lead", name: "Sam", role: "general" }),
      makeAgent({ id: "builder", name: "Builder", role: "general" }),
    ];
    const sorted = sortAgentsByStoredOrder(agents, ["lead", "builder"]);
    expect(sorted.map((a) => a.id)).toEqual(["lead", "builder"]);
  });
});
