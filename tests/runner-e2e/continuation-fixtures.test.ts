import { expect, it, vi } from "vitest";
import type { RunnerApi } from "./api.js";
import { prepareLegacyContinuationSkill, prepareContinuationBudget } from "./continuation-fixtures.js";
it("initializes the production library and assigns the operational skill before execution", async () => {
  const post = vi.fn();
  const get = vi.fn(async () => [{ key: "outpost/outpost/outpost" }]);
  await prepareLegacyContinuationSkill({ get, post } as unknown as RunnerApi, "space", "agent");
  expect(get).toHaveBeenCalledWith("/api/spaces/space/skills");
  expect(post).toHaveBeenCalledWith("/api/agents/agent/skills/sync?spaceId=space", { desiredSkills: ["outpost/outpost/outpost"], mode: "add" });
  get.mockResolvedValue([]);
  await expect(prepareLegacyContinuationSkill({ get, post } as unknown as RunnerApi, "space", "agent")).rejects.toThrow("missing the bundled");
  expect(post).toHaveBeenCalledTimes(1);
});

it("persists and reads both continuation budget hard stops before returning", async () => {
  const calls: string[] = [];
  const api = { patch: vi.fn(async (url: string) => { calls.push(`patch:${url}`); }),
    get: vi.fn(async (url: string) => { calls.push(`get:${url}`); return { budgetMonthlyCents: 1_000 }; }) };
  await expect(prepareContinuationBudget(api as unknown as RunnerApi, "space", "agent"))
    .resolves.toEqual({ spaceMonthlyCents: 1_000, agentMonthlyCents: 1_000 });
  expect(calls).toEqual(["patch:/api/spaces/space/budgets", "patch:/api/agents/agent/budgets",
    "get:/api/spaces/space", "get:/api/agents/agent"]);
});
it.each(["space", "agent"])("rejects a missing %s budget instead of starting paid work", async target => {
  const api = { patch: vi.fn(), get: vi.fn(async (url: string) =>
    ({ budgetMonthlyCents: url.endsWith(target) ? 0 : 1_000 })) };
  await expect(prepareContinuationBudget(api as unknown as RunnerApi, "space", "agent"))
    .rejects.toThrow("hard stops were not persisted");
});
