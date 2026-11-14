import { readFile } from "node:fs/promises";
import type { RunnerApi } from "./api.js";
import { PLAN_SKILLS, planHash, type PlanVariant } from "./plan-task-cases.js";

type SkillApi = Pick<RunnerApi, "get" | "post">;
export type PlanSkillSource = {
  originalKey: string; key: string; id: string; sourcePath: string;
  sha256: string; bytes: number; words: number; selected: boolean;
};

/** Bundled/catalog files are read-only and core inventory is automatically
 * restored. Editable space copies preserve the source bytes and names;
 * selection, rather than deletion, implements the unassigned control. */
export async function preparePlanSkills(api: SkillApi, spaceId: string, variant: PlanVariant) {
  const space = `/api/spaces/${spaceId}`;
  const skills: PlanSkillSource[] = [];
  for (const skill of PLAN_SKILLS) {
    const relative = variant === "current" ? skill.current : skill.short;
    const content = await readFile(new URL(`../../${relative}`, import.meta.url), "utf8");
    const name = skill.key.split("/").at(-1)!;
    const created = await api.post<{ id: string; key: string; sourceType: string }>(`${space}/skills`, {
      name, slug: `eval-${name}`, markdown: content, sharingScope: "space",
    });
    if (created.sourceType !== "managed") throw new Error("Planning fixture did not create an editable space skill");
    const served = await api.get<{ content: string; editable: boolean }>(`${space}/skills/${created.id}/files?path=SKILL.md`);
    if (!served.editable || planHash(served.content) !== planHash(content)) throw new Error(`Served skill differs from editable source ${relative}`);
    skills.push({ originalKey: skill.key, key: created.key, id: created.id, sourcePath: relative,
      sha256: planHash(content), bytes: Buffer.byteLength(content), words: content.split(/\s+/).filter(Boolean).length,
      selected: variant !== "disabled" });
  }
  return skills;
}

export async function selectPlanSkills(api: SkillApi, spaceId: string, agentId: string, sources: PlanSkillSource[]) {
  const selected = sources.filter(s => s.selected).map(s => s.key);
  await api.post(`/api/agents/${agentId}/skills/sync?spaceId=${spaceId}`, { desiredSkills: selected, mode: "replace" });
  return verifyPlanSelection(api, spaceId, agentId, sources);
}

export async function verifyPlanSelection(api: Pick<RunnerApi, "get">, spaceId: string, agentId: string, sources: PlanSkillSource[]) {
  const selected = sources.filter(s => s.selected).map(s => s.key);
  const snapshot = await api.get<{ desiredSkills: string[] }>(`/api/agents/${agentId}/skills?spaceId=${spaceId}`);
  if (JSON.stringify([...(snapshot.desiredSkills ?? [])].sort()) !== JSON.stringify([...selected].sort())) {
    throw new Error("Planning skill selection differs from selected variant; comparison is uncomparable");
  }
  return snapshot;
}

export async function verifyPlanSkills(api: Pick<RunnerApi, "get">, spaceId: string, sources: PlanSkillSource[]) {
  for (const skill of sources) {
    const served = await api.get<{ content: string }>(`/api/spaces/${spaceId}/skills/${skill.id}/files?path=SKILL.md`);
    if (planHash(served.content) !== skill.sha256) throw new Error("Planning guidance changed during execution; comparison is uncomparable");
  }
}
