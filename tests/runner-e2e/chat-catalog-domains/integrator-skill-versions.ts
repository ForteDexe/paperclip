import type { SpaceSkillVersion, SpaceSkillVersionSummary } from "../../../packages/shared/src/types/space-skill.js";
import type { RunnerApi } from "../api.js";
/** Version listings intentionally omit bytes. Read each immutable detail before
 * evaluating its content or comparing complete revision history. */
export async function readSkillVersionHistory(api: Pick<RunnerApi,"get">, spaceId: string, skillId: string, currentVersionId?: string | null): Promise<SpaceSkillVersion[]> {
  const root = `/api/spaces/${encodeURIComponent(spaceId)}/skills/${encodeURIComponent(skillId)}/versions`;
  const rows = await api.get<SpaceSkillVersionSummary[]>(root);
  const metadata = ["id", "spaceId", "spaceSkillId", "revisionNumber", "authorAgentId", "authorUserId"] as const;
  if (!spaceId || !skillId || !Array.isArray(rows) || rows.some(row => !row || metadata.some(key => !Object.hasOwn(row,key)) || typeof row.id !== "string" || !row.id || row.spaceId !== spaceId || row.spaceSkillId !== skillId || !Number.isSafeInteger(row.revisionNumber) || row.revisionNumber < 1 || ![row.authorAgentId,row.authorUserId].every(author => author === null || typeof author === "string" && !!author) || !Array.isArray(row.fileInventory) || row.fileInventory.some(file => !file || typeof file.path !== "string" || !file.path || typeof file.kind !== "string")) || new Set(rows.map(row=>row.id)).size !== rows.length || currentVersionId && !rows.some(row=>row.id===currentVersionId)) throw new Error("Skill version summary identity is missing or inconsistent");
  return Promise.all(rows.map(async row => {
    const detail = await api.get<SpaceSkillVersion>(`${root}/${encodeURIComponent(row.id)}`);
    const inventory = (files: Array<{path:string;kind:string}>) => JSON.stringify(files.map(file=>({path:file.path,kind:file.kind})).sort((a,b)=>a.path.localeCompare(b.path)));
    if (!detail || metadata.some(key => !Object.hasOwn(detail,key) || detail[key] !== row[key]) || !Array.isArray(detail.fileInventory) || detail.fileInventory.some(file=>!file || typeof file.path!=="string" || !file.path || typeof file.content!=="string") || new Set(detail.fileInventory.map(file=>file.path)).size!==detail.fileInventory.length || inventory(detail.fileInventory)!==inventory(row.fileInventory)) throw new Error("Skill version detail identity or saved file bytes are missing or inconsistent");
    return detail;
  }));
}
