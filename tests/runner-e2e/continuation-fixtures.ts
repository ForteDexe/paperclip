import type { RunnerApi } from "./api.js";

/** Bare space creation does not populate its skill library. Match the
 * production onboarding setup before evaluating legacy API instructions. */
export async function prepareLegacyContinuationSkill(api: RunnerApi, spaceId: string, agentId: string) {
  const key = "outpost/outpost/outpost";
  const skills = await api.get<Array<{ key: string }>>(`/api/spaces/${spaceId}/skills`);
  if (!skills.some(skill => skill.key === key)) throw new Error("Continuation fixture is missing the bundled Outpost operational skill");
  await api.post(`/api/agents/${agentId}/skills/sync?spaceId=${spaceId}`, { desiredSkills: [key], mode: "add" });
}


/** Apply and verify both hard stops before any task can start. These are caps,
 * not estimates of provider invoices or unmetered local runtime costs. */
export async function prepareContinuationBudget(api: RunnerApi, spaceId: string, agentId: string) {
  const budgetMonthlyCents = 1_000;
  await api.patch(`/api/spaces/${spaceId}/budgets`, { budgetMonthlyCents });
  await api.patch(`/api/agents/${agentId}/budgets`, { budgetMonthlyCents });
  const [space, agent] = await Promise.all([
    api.get<{ budgetMonthlyCents: unknown }>(`/api/spaces/${spaceId}`),
    api.get<{ budgetMonthlyCents: unknown }>(`/api/agents/${agentId}`),
  ]);
  if (space.budgetMonthlyCents !== budgetMonthlyCents || agent.budgetMonthlyCents !== budgetMonthlyCents)
    throw new Error("Continuation space and agent budget hard stops were not persisted");
  return { spaceMonthlyCents: budgetMonthlyCents, agentMonthlyCents: budgetMonthlyCents };
}
