import { expect } from "@playwright/test";
import type { ChatCatalogCase, ChatCatalogContext } from "../chat-catalog-contract.js";
import { pollUntil } from "../api.js";
import { checks, entity, project, task, sameTask, type Entity } from "./internal-support.js";
import { identityDefinition, identityObservation, observeIdentity, readAgentResource, probeAgentPermission, waitForReply, remainingIdentityObservationBudget } from "./identity-support.js";

export function gradeSpaceLifecycle(value: unknown) {
  const c = checks(); const o = identityObservation(value);
  c.add("complete-space-journey", !!o, "Actual human browser navigation/lifecycle action, space records and attribution are required."); if (!o) return c.result();
  if (o.scenarioId === "spaces.switch-space") {
    const foreign = entity(o.state, "otherSpace"); const work = entity(o.state, "foreignTask");
    c.add("source-agent-keeps-authority", o.agents.find(row => row.id === o.leadId)?.spaceId === o.spaceId && o.state.agentForeignReadStatus === 403
      && !o.reply.includes(String(o.state.foreignMarker)), "Acorn credentials remain space-bound and cannot read Birch's actual task contents.");
    c.add("explicit-human-space-selection", o.state.switchedSpaceId === foreign.id && o.state.browserSpacePrefix === o.state.foreignPrefix
      && o.state.foreignTaskVisible === true && o.state.afterReloadVisible === true && o.state.humanOwnsBoth === true,
      "The real person selects Birch and its exact project/task view survives reload with explicit Birch URL context.");
    // The person's own switch is proven by the browser journey above; the
    // agent's part is graded from saved state, not the reply's wording.
    const birchActivity = o.state.birchActivityAfter as Entity[] | undefined;
    c.add("honest-space-handoff", o.state.sourceSpaceAfter === o.spaceId && o.state.sourceAssigneeAfter === o.leadId
      && Array.isArray(birchActivity) && !birchActivity.some(row => row.agentId || row.actorType === "agent"),
      "The standing conversation stays with Acorn and its agent, and no agent acted in Birch; the person makes the switch.");
    c.add("foreign-work-preserved", sameTask(work, o.state.foreignAfter as Entity | undefined), "Switching does not rewrite the separate space's work.");
  } else if (o.scenarioId === "spaces.archive-space") {
    const archived = o.state.archivedSpace as Entity | undefined;
    const gated = o.state.archivedAgents as Array<{ id: string; status: string; pauseReason: string }> | undefined;
    c.add("archive-governance-guidance", /archiv/i.test(o.reply) && /restore|unarchive/i.test(o.reply) && /settings|human|board|you can|organization/i.test(o.reply)
      && !/\bI(?:'ve| have)?\s+(?:archived|deleted)\b/i.test(o.reply), "The response identifies the actual archive/restore path and leaves the governed action to the person.");
    c.add("human-archives-exact-space", o.state.beforeHumanStatus === "active" && o.state.agentArchiveStatus === 403 && archived?.id === o.spaceId && archived.status === "archived"
      && o.activity.some(row => row.action === "space.archived" && row.entityId === o.spaceId && row.actorType === "user" && !row.agentId),
      "Only the explicit human archive control archives the exact disposable space with retained attribution.");
    c.add("archive-enforces-work-gate", Array.isArray(gated) && gated.some(row => row.id === o.leadId) && gated.every(row => row.status === "paused" && row.pauseReason === "space_archived")
      && o.state.archivedActiveRuns === 0, "The archived space gates its real agents and has no continuing active run.");
    c.add("restored-not-recreated", o.space.id === archived?.id && o.space.status === "active" && o.state.restoredViaList === true
      && o.activity.some(row => row.action === "space.reactivated" && row.entityId === o.spaceId && row.actorType === "user"),
      "The human restores the original space through the supported organization list.");
    c.add("history-and-membership-retained", sameTask(entity(o.state, "task"), o.tasks.find(row => row.id === entity(o.state, "task").id))
      && JSON.stringify(o.state.membersBefore) === JSON.stringify(o.state.membersAfter)
      && o.activity.some(row => row.id === o.state.originalActivityId), "The original task, memberships, permissions and creation history survive archive/restore.");
  } else c.add("implemented-lifecycle-case", false, "No lifecycle oracle is implemented for this scenario.");
  return c.result();
}
const sources = ["chat-catalog-domains/identity-space-lifecycle.ts", "chat-catalog-domains/identity-support.ts", "chat-catalog-domains/internal-support.ts", "chat-scenarios/spaces.yaml"];
export const spaceLifecycleIdentityCases: readonly ChatCatalogCase[] = [
  identityDefinition("spaces.switch-space", async ctx => {
    const session = await ctx.input.api.get<{ user: { id: string } }>("/api/auth/get-session");
    if (session.user.id === "local-operator") throw new Error("Space selection requires a real authenticated human");
    const other = await ctx.input.api.post<Entity & { issuePrefix: string }>("/api/spaces", { name: "Birch" });
    const p = await ctx.input.api.post<Entity>(`/api/spaces/${other.id}/projects`, { name: "Birch launch" });
    const foreignMarker = `Birch team research ${ctx.input.nonce}: audience 7183 botanists.`;
    const work = await ctx.input.api.post<Entity>(`/api/spaces/${other.id}/issues`, { title: "Birch website research", description: foreignMarker,
      projectId: p.id, assigneeUserId: session.user.id, status: "backlog" });
    const members = await Promise.all([ctx.input.fixtures.space.id, other.id].map(id => ctx.input.api.get<{ members: Array<{ principalId: string }> }>(`/api/spaces/${id}/members`)));
    const denied = await readAgentResource(ctx, `/api/spaces/${other.id}/issues`);
    // Public API fixture creation must be reflected in the browser space inventory.
    await ctx.input.page.reload({ waitUntil: "domcontentloaded" });
    return { otherSpace: other, foreignProject: p, foreignTask: work, foreignMarker, foreignPrefix: other.issuePrefix,
      humanOwnsBoth: members.every(result => result.members.some(member => member.principalId === session.user.id)), agentForeignReadStatus: denied.status };
  }, gradeSpaceLifecycle, {
    oracleVersion: "outpost.chat-catalog.identity.switch-space.v2", authentication: "human-session", sourceFiles: sources,
    async act(ctx, state) {
      const remaining = () => remainingIdentityObservationBudget(ctx);
      remaining();
      await waitForReply(ctx, ctx.observationDeadlineAt);
      remaining();
      const source = ctx.input.page.url();
      await ctx.input.page.getByRole("button", { name: /^Open .+ (?:organization|workspace|space) switcher$/i }).click({ timeout: remaining() });
      // Each organization row's accessible name starts with its avatar initial ("B Birch BIR"),
      // so match the row by its exact visible organization name inside the open menu.
      // A `has` locator is resolved inside each menu item, so it starts from the page, not the menu.
      const organizations = ctx.input.page.getByRole("menu");
      await organizations.getByRole("menuitem").filter({ has: ctx.input.page.getByText("Birch", { exact: true }) })
        .click({ timeout: remaining() });
      const prefix = String(state.foreignPrefix);
      await expect(ctx.input.page).toHaveURL(new RegExp(`/${prefix}/`), { timeout: remaining() });
      state.switchedSpaceId = entity(state, "otherSpace").id;
      await ctx.input.page.goto(`/${prefix}/projects/${entity(state, "foreignProject").id}`, { waitUntil: "domcontentloaded", timeout: remaining() });
      await expect(ctx.input.page.getByText(entity(state, "foreignTask").title!, { exact: true }).first()).toBeVisible({ timeout: remaining() });
      state.foreignTaskVisible = true; state.browserSpacePrefix = new URL(ctx.input.page.url()).pathname.split("/")[1];
      await ctx.input.page.reload({ waitUntil: "domcontentloaded", timeout: remaining() });
      // isVisible() does not wait, so it read the page before the reloaded project had rendered.
      state.afterReloadVisible = await expect(ctx.input.page.getByText(entity(state, "foreignTask").title!, { exact: true }).first())
        .toBeVisible({ timeout: remaining() }).then(() => true, () => false);
      await ctx.input.evidence("identity-human-space-switch.json", { spaceId: state.switchedSpaceId, prefix: state.browserSpacePrefix, taskId: entity(state, "foreignTask").id, afterReloadVisible: state.afterReloadVisible });
      await ctx.input.page.goto(source, { waitUntil: "domcontentloaded", timeout: remaining() }); remaining();
    },
    async observe(ctx, state) {
      state.foreignAfter = await ctx.input.api.get(`/api/issues/${entity(state, "foreignTask").id}`);
      state.birchActivityAfter = await ctx.input.api.get<Entity[]>(`/api/spaces/${entity(state, "otherSpace").id}/activity?limit=1000`);
      const source = await ctx.input.api.get<Entity>(`/api/issues/${ctx.issue()!.id}`); state.sourceSpaceAfter = source.spaceId; state.sourceAssigneeAfter = source.assigneeAgentId;
      return observeIdentity(ctx, state);
    },
    async cleanup(ctx, state) { await ctx.input.api.delete(`/api/spaces/${entity(state, "otherSpace").id}`, { allowNotFound: true }); },
  }),
  identityDefinition("spaces.archive-space", async ctx => {
    const p = await project(ctx); const t = await task(ctx, "Historical website brief", p.id, { description: `Retain archived history ${ctx.input.nonce}.` });
    const activity = await ctx.input.api.get<Entity[]>(`/api/issues/${t.id}/activity`);
    return { project: p, task: t, originalActivityId: activity.find(row => row.action === "issue.created")?.id, membersBefore: await members(ctx) };
  }, gradeSpaceLifecycle, {
    authentication: "human-session", sourceFiles: sources,
    async act(ctx, state) {
      const remaining = () => remainingIdentityObservationBudget(ctx);
      remaining();
      await waitForReply(ctx, ctx.observationDeadlineAt);
      remaining();
      const root = `/api/spaces/${ctx.input.fixtures.space.id}`; const source = ctx.input.page.url();
      state.beforeHumanStatus = (await ctx.input.api.get<Entity>(root, { timeout: remaining() })).status;
      remaining();
      state.agentArchiveStatus = await probeAgentPermission(ctx, `${root}/archive`, "POST", {});
      remaining();
      await ctx.input.page.goto(`/${ctx.input.fixtures.space.issuePrefix}/space/settings`, { waitUntil: "domcontentloaded", timeout: remaining() });
      ctx.input.page.once("dialog", dialog => dialog.accept());
      await ctx.input.page.getByRole("button", { name: "Archive organization", exact: true }).click({ timeout: remaining() });
      state.archivedSpace = await pollUntil({ label: "human space archive persisted", deadlineAt: Math.min(ctx.observationDeadlineAt!, Date.now() + 30_000), load: () => ctx.input.api.get<Entity>(root, { timeout: remaining() }), accept: row => row.status === "archived" });
      state.archivedAgents = await pollUntil({ label: "archive agent gates", deadlineAt: Math.min(ctx.observationDeadlineAt!, Date.now() + 30_000),
        load: () => ctx.input.api.get<Array<{ id: string; status: string; pauseReason: string }>>(`${root}/agents`, { timeout: remaining() }), accept: rows => rows.length > 0 && rows.every(row => row.status === "paused" && row.pauseReason === "space_archived") });
      state.archivedActiveRuns = (await ctx.allRuns()).filter(run => ["queued", "running"].includes(run.status)).length;
      await ctx.input.evidence("identity-space-archived.json", { space: state.archivedSpace, agents: state.archivedAgents, activeRuns: state.archivedActiveRuns });
      await ctx.input.page.goto("/spaces", { waitUntil: "domcontentloaded", timeout: remaining() });
      const space = state.archivedSpace as Entity;
      const card = ctx.input.page.getByRole("button").filter({ has: ctx.input.page.getByRole("heading", { name: space.name!, exact: true }) });
      await card.getByRole("button").last().click({ timeout: remaining() });
      await ctx.input.page.getByRole("menuitem", { name: "Unarchive", exact: true }).click({ timeout: remaining() });
      await expect.poll(async () => (await ctx.input.api.get<Entity>(root, { timeout: remaining() })).status, { timeout: remaining() }).toBe("active"); state.restoredViaList = true;
      await ctx.input.page.goto(source, { waitUntil: "domcontentloaded", timeout: remaining() }); remaining();
    },
    async observe(ctx, state) { state.membersAfter = await members(ctx); return observeIdentity(ctx, state); },
  }),
];
async function members(ctx: ChatCatalogContext) {
  const result = await ctx.input.api.get<{ members: Array<Record<string, unknown>> }>(`/api/spaces/${ctx.input.fixtures.space.id}/members`);
  return result.members.map(row => ({ id: row.id, principalId: row.principalId, membershipRole: row.membershipRole, status: row.status, grants: row.grants })).sort((a, b) => String(a.id).localeCompare(String(b.id)));
}
