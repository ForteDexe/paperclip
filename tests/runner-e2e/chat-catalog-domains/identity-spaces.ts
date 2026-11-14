import { expect } from "@playwright/test";
import { checks, project, task, sameTask, entity } from "./internal-support.js";
import { identityDefinition, identityObservation, observeIdentity } from "./identity-support.js";

export function gradeSpaceRename(value: unknown) {
  const c = checks(); const o = identityObservation(value);
  c.add("complete-space-evidence", !!o, "Public space, records and audit evidence is required.");
  if (!o) return c.result();
  const before = entity(o.state, "space"); const other = entity(o.state, "otherSpace");
  c.add("same-space-renamed", o.space.id === before.id && o.space.name === "Acorn Studio"
    && o.spaces.filter(row => row.id === before.id).length === 1, "The saved identity changes on the original space ID.");
  c.add("other-space-preserved", o.spaces.find(row => row.id === other.id)?.name === other.name
    && o.spaces.length === o.state.spaceCount, "A similarly named space remains unchanged and no duplicate space is created.");
  c.add("work-retained", sameTask(entity(o.state, "task"), o.tasks.find(row => row.id === entity(o.state, "task").id))
    && o.projects.some(row => row.id === entity(o.state, "project").id), "Original task and project remain attached to the same space.");
  // PATCH /spaces/{id} (space.updated) and PATCH /spaces/{id}/branding (space.branding_updated)
  // are both supported routes that save the space name; either audit record proves the rename.
  c.add("agent-attributed-identity-change", o.activity.some(row => ["space.updated", "space.branding_updated"].includes(String(row.action)) && row.entityId === before.id
    && row.agentId === o.leadId && row.details?.name === "Acorn Studio"), "The requested mutation is recorded for the acting CEO on a supported space-name route.");
  c.add("memberships-preserved", Array.isArray(o.state.membersBefore) && o.state.membersBefore.length > 0
    && JSON.stringify(o.state.membersBefore) === JSON.stringify(o.state.membersAfter), "The original member IDs, principals, roles and permissions remain unchanged.");
  return c.result();
}
export const spaceIdentityCases = [identityDefinition("spaces.rename-space", async ctx => {
  const space = await ctx.input.api.get(`/api/spaces/${ctx.input.fixtures.space.id}`);
  const otherSpace = await ctx.input.api.post("/api/spaces", { name: "Acorn Studios" });
  const p = await project(ctx); const t = await task(ctx, "Website task", p.id);
  const spaces = await ctx.input.api.get<unknown[]>("/api/spaces");
  return { space, otherSpace, spaceCount: spaces.length, project: p, task: t, membersBefore: await membershipSnapshot(ctx) };
}, gradeSpaceRename, {
  oracleVersion: "outpost.chat-catalog.space-rename.routes.v2",
  async observe(ctx, state) { state.membersAfter = await membershipSnapshot(ctx); return observeIdentity(ctx, state); },
  async verifyResult(ctx) {
    await ctx.input.page.reload({ waitUntil: "domcontentloaded" });
    await expect(ctx.input.page.getByText("Acorn Studio", { exact: true }).first()).toBeVisible();
    await expect(ctx.input.page.getByTestId("task-chat-composer-input")).toBeVisible();
  },
  async cleanup(ctx, state) { await ctx.input.api.delete(`/api/spaces/${entity(state, "otherSpace").id}`, { allowNotFound: true }); },
})] as const;
async function membershipSnapshot(ctx: Parameters<typeof project>[0]) {
  const { members } = await ctx.input.api.get<{ members: Array<Record<string, unknown>> }>(`/api/spaces/${ctx.input.fixtures.space.id}/members`);
  return members.map(row => ({ id: row.id, principalType: row.principalType, principalId: row.principalId,
    membershipRole: row.membershipRole, status: row.status, grants: row.grants })).sort((a, b) => String(a.id).localeCompare(String(b.id)));
}
