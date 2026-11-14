import { expect, it, vi } from "vitest";
import type { ChatCatalogContext } from "../chat-catalog-contract.js";
vi.mock("./integrator-support.js", async importOriginal => ({ ...await importOriginal<typeof import("./integrator-support.js")>(), observeInternal: vi.fn(async (_ctx: unknown,state:unknown)=>({scenarioId:"skills.author-skill",spaceId:"space",leadId:"ceo",state})) }));
import { integratorSkillsCases } from "./integrator-skills.js";
const summary={id:"version",spaceId:"space",spaceSkillId:"skill",revisionNumber:2,authorAgentId:"ceo",authorUserId:null,fileInventory:[{path:"SKILL.md",kind:"skill"}]};
const detail={...summary,fileInventory:[{path:"SKILL.md",kind:"skill",content:"# Actual saved bytes"}]};
it("the actual skill observer resolves summary metadata into exact saved version bytes",async()=>{
 const get=vi.fn(async(route:string)=>{
  if(route==="/api/spaces/space/skills")return[{id:"skill"}];
  if(route==="/api/spaces/space/skills/skill")return{id:"skill",spaceId:"space",currentVersionId:"version"};
  if(route==="/api/spaces/space/skills/skill/versions")return[summary];
  if(route==="/api/spaces/space/skills/skill/versions/version")return detail;
  if(route==="/api/spaces/space/skill-policy")return{};
  throw new Error("Unexpected observer read");
 });
 const ctx={input:{fixtures:{space:{id:"space"}},api:{get,post:async()=>({allowed:true})}}} as unknown as ChatCatalogContext;
 const o=await integratorSkillsCases[0]!.observe(ctx,{}) as {versions:Record<string,typeof detail[]>};
 expect(o.versions.skill?.[0]?.fileInventory[0]?.content).toBe("# Actual saved bytes");
 expect(get).toHaveBeenCalledWith("/api/spaces/space/skills/skill/versions/version");
});

import { readSkillVersionHistory } from "./integrator-skill-versions.js";
it.each(["wrong version","wrong skill","wrong space","wrong author","missing content","missing file","missing detail"])("rejects %s instead of borrowing current mutable skill bytes",async invalid=>{
 const changed=structuredClone(detail) as typeof detail | undefined;
 if(changed){
  if(invalid==="wrong version")changed.id="other";
  if(invalid==="wrong skill")changed.spaceSkillId="other";
  if(invalid==="wrong space")changed.spaceId="foreign";
  if(invalid==="wrong author")changed.authorAgentId="other";
  if(invalid==="missing content")delete(changed.fileInventory[0] as {content?:string}).content;
  if(invalid==="missing file")changed.fileInventory=[];
 }
 const get=vi.fn(async(route:string)=>route.endsWith("/versions")?[summary]:invalid==="missing detail"?undefined:changed);
 await expect(readSkillVersionHistory({get} as never,"space","skill","version")).rejects.toThrow("detail identity or saved file bytes");
});
it.each(["foreign summary","duplicate summary","missing selected version"])("refuses %s before any detail read",async invalid=>{
 const rows=invalid==="duplicate summary"?[summary,summary]:[{...summary,spaceId:invalid==="foreign summary"?"foreign":"space"}];
 const get=vi.fn(async()=>rows);
 await expect(readSkillVersionHistory({get} as never,"space","skill",invalid==="missing selected version"?"other":"version")).rejects.toThrow("summary identity");
 expect(get).toHaveBeenCalledOnce();
});
it("keeps complete multi-version history and does not invent immutable history for unversioned local imports",async()=>{
 const second={...summary,id:"older",revisionNumber:1,authorAgentId:null};
 const get=vi.fn(async(route:string)=>route.endsWith("/versions")?[summary,second]:route.endsWith("/older")?{...second,fileInventory:[{path:"SKILL.md",kind:"skill",content:"# Older actual bytes"}]}:detail);
 const versions=await readSkillVersionHistory({get} as never,"space","skill","version");
 expect(versions.map(row=>row.id)).toEqual(["version","older"]);expect(versions[1]!.fileInventory[0]!.content).toBe("# Older actual bytes");
 await expect(readSkillVersionHistory({get:async()=>[]} as never,"space","skill")).resolves.toEqual([]);
});
