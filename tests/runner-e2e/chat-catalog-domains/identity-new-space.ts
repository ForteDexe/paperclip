import { expect } from "@playwright/test";
import type { ChatCatalogCase, ChatCatalogContext } from "../chat-catalog-contract.js";
import type { Agent } from "../../../packages/shared/src/types/agent.js";
import { finishNativeNewSpace, type NewSpaceNativeReceipt } from "./identity-new-space-native.js";
import { NEW_SPACE_NATIVE_MODEL } from "./identity-new-space-native-proof.js";
import { checks, type Entity } from "./internal-support.js";
import { identityDefinition, identityObservation, observeIdentity, readAgentResource, remainingIdentityObservationBudget, waitForReply } from "./identity-support.js";

const spaces = new WeakMap<ChatCatalogContext, string>();
const connections = new WeakMap<ChatCatalogContext, Array<{ spaceId: string; connectionId: string; grantId: string }>>();
export function gradeNewSpace(value: unknown) {
  const c = checks(); const o = identityObservation(value); c.add("complete-human-space-onboarding", !!o, "Actual human wizard, first-account readiness and separate space/agent authority are required."); if (!o) return c.result();
  const wizard = o.state.wizard as NewSpaceNativeReceipt | undefined; const agent = o.state.newAgent as Agent | undefined;
  c.add("guidance-before-human-creation", o.state.spaceCountAfterReply === 1 && /website|business/i.test(o.reply) && /onboarding|creat.*(?:space|organization)|space.*(?:flow|wizard|switcher)|organization.*(?:wizard|switcher)/i.test(o.reply)
    && !/\bI(?:'ve| have)?\s+(?:created|set up)\s+(?:a |the |your )?(?:new )?(?:space|organization)/i.test(o.reply), "The source agent preserves the website-business request and guides the actual person without claiming it created another space.");
  c.add("actual-ready-space-and-ceo", !!wizard && wizard.spaceId !== o.spaceId && agent?.id === wizard.firstAgentId && agent.spaceId === wizard.spaceId
    && agent.role === "ceo" && agent.lifecycleState === "ready" && wizard.firstAgentReady && wizard.hiredThroughPublicSetup && wizard.actualHarness === "opencode_local"
    && wizard.model === NEW_SPACE_NATIVE_MODEL && wizard.noAgentBeforeRouteDeparture && wizard.savedSetupAgentId === agent.id
    && wizard.helloCount === 1 && wizard.hireCount === 1 && wizard.exactPublicGrantAndAgentInstall
    && wizard.hello.checks.some(check => check.code === "opencode_hello_probe_passed") && wizard.account.ownership === "personal"
    && wizard.account.ownerUserId === o.state.humanId && wizard.account.responsibleUserId === o.state.humanId && o.state.humanRoleConfigurationStatus === 200,
    "The human creates a real space and reuses its saved first-CEO setup through the public OpenCode1017 local native test and hire; account/grant, space and agent remain independently bound.");
  c.add("distinct-human-and-agent-authority", !!wizard && wizard.spaceId !== wizard.firstAgentId && wizard.firstAgentId !== o.leadId
    && o.state.newSpaceOwnedByHuman === true && o.state.oldAgentForeignReadStatus === 403 && o.state.newAgentVisible === true && o.state.oldAgentStillSourceSpace === true,
    "The same real human owns the new space, its CEO is a separate actual agent, and the original agent retains only its source-space access.");
  c.add("no-duplicate-or-secret-leak", !!wizard && wizard.beforeSpaceIds.length === 1 && wizard.beforeSpaceIds[0] === o.spaceId
    && wizard.afterSpaceIds.length === 2 && new Set(wizard.afterSpaceIds).size === 2 && wizard.afterAgentIds.length === 1
    && wizard.draftContainsCredential === false && wizard.publicAgentContainsCredential === false && wizard.heartbeatRunIds.length === 0
    && o.state.sourceMembershipsUnchanged === true && o.state.sourceAccountsUnchanged === true, "The human flow creates one space/first agent without duplicating source identities, dispatching nonexistent work, leaking credentials or changing original memberships.");
  return c.result();
}
export const newSpaceIdentityCases: readonly ChatCatalogCase[] = [identityDefinition("onboarding.new-space", async ctx => {
  if (!ctx.input.privateInputs?.credentials.OPENROUTER_API_KEY) throw new Error("Setup blocker: human space onboarding needs declared private OPENROUTER_API_KEY for the actual native1017 setup");
  const session = await ctx.input.api.get<{ user: { id: string } }>("/api/auth/get-session");
  return { sourceAccounts: await ctx.input.api.get(`/api/spaces/${ctx.input.fixtures.space.id}/ai-connections`), humanId: session.user.id, sourceMembers: await ctx.input.api.get(`/api/spaces/${ctx.input.fixtures.space.id}/members`) };
}, gradeNewSpace, {
  authentication: "human-session", requiredCredentials: ["OPENROUTER_API_KEY"], attemptTimeoutMs: 600_000,
  sourceFiles: ["chat-catalog-domains/identity-new-space.ts", "chat-catalog-domains/identity-new-space-native.ts", "chat-catalog-domains/identity-new-space-native-proof.ts", "chat-catalog-domains/identity-wizard.ts", "chat-catalog-domains/identity-private-browser.ts", "chat-catalog-domains/identity-private-browser-worker.ts", "chat-catalog-domains/identity-support.ts", "chat-catalog-domains/internal-support.ts", "chat-scenarios/onboarding.yaml"],
  async act(ctx, state) {
    remainingIdentityObservationBudget(ctx);
    const originalDeadlineAt = ctx.observationDeadlineAt!;
    await waitForReply(ctx, originalDeadlineAt);
    remainingIdentityObservationBudget(ctx);
    state.spaceCountAfterReply = (await ctx.input.api.get<unknown[]>("/api/spaces")).length;
    if (state.spaceCountAfterReply !== 1) throw new Error("The source agent changed space identities before the human wizard");
    remainingIdentityObservationBudget(ctx);
    const credential = ctx.input.privateInputs!.credentials.OPENROUTER_API_KEY!; ctx.input.privateSecrets!.push(credential); const source = ctx.input.page.url();
    const wizard = await finishNativeNewSpace({ page: ctx.input.page, origin: ctx.input.api.baseURL, spaceName: `Acorn Website Business ${ctx.input.nonce}`, agentName: "Website business CEO", credential,
      deadlineAt: Math.min(originalDeadlineAt, Date.now() + 360_000), evidence: ctx.input.evidence, onSpace(id) { spaces.set(ctx, id); },
      onConnection(spaceId, connectionId, grantId) { connections.set(ctx, [...(connections.get(ctx) ?? []), { spaceId, connectionId, grantId }]); } });
    state.wizard = wizard;
    // Retain the explicit authenticated human role configuration/readback.
    // The normal first-agent dialog already selected CEO for this empty space.
    const configured = await ctx.input.page.context().request.patch(`${ctx.input.api.baseURL}/api/agents/${wizard.firstAgentId}`, { data: { role: "ceo", title: "Website business CEO" }, headers: { Origin: ctx.input.api.baseURL } });
    state.humanRoleConfigurationStatus = configured.status(); if (!configured.ok()) throw new Error("Human public CEO configuration failed");
    state.newAgent = await ctx.input.api.get<Agent>(`/api/agents/${wizard.firstAgentId}`);
    const membership = await ctx.input.api.get<{ members: Array<{ principalId: string; membershipRole: string }> }>(`/api/spaces/${wizard.spaceId}/members`);
    state.newSpaceOwnedByHuman = membership.members.some(member => member.principalId === state.humanId && member.membershipRole === "owner");
    state.oldAgentForeignReadStatus = (await readAgentResource(ctx, `/api/spaces/${wizard.spaceId}/agents`)).status;
    const space = await ctx.input.api.get<Entity & { issuePrefix: string }>(`/api/spaces/${wizard.spaceId}`);
    await ctx.input.page.goto(`/${space.issuePrefix}/agents/${wizard.firstAgentId}`, { waitUntil: "domcontentloaded" });
    await expect(ctx.input.page.getByText("Website business CEO", { exact: true }).first()).toBeVisible(); state.newAgentVisible = true;
    await ctx.input.evidence("identity-human-new-space-authority.json", { sourceSpaceId: ctx.input.fixtures.space.id, newSpaceId: wizard.spaceId, newAgentId: wizard.firstAgentId,
      humanId: state.humanId, actualCeoRole: (state.newAgent as Agent).role, roleStep: "authenticated-human-public-configuration", originalAgentForeignReadStatus: state.oldAgentForeignReadStatus });
    await ctx.input.page.goto(source, { waitUntil: "domcontentloaded" });
  },
  async observe(ctx, state) {
    state.oldAgentStillSourceSpace = (await ctx.input.api.get<Agent>(`/api/agents/${ctx.input.fixtures.agent.id}`)).spaceId === ctx.input.fixtures.space.id;
    state.sourceAccountsUnchanged = JSON.stringify(state.sourceAccounts) === JSON.stringify(await ctx.input.api.get(`/api/spaces/${ctx.input.fixtures.space.id}/ai-connections`));
    state.sourceMembershipsUnchanged = JSON.stringify(state.sourceMembers) === JSON.stringify(await ctx.input.api.get(`/api/spaces/${ctx.input.fixtures.space.id}/members`));
    return observeIdentity(ctx, state);
  },
  async cleanup(ctx) {
    const id = spaces.get(ctx), owned = connections.get(ctx) ?? [];
    try { for (const connection of owned) if (connection.spaceId === id) await ctx.input.api.delete(`/api/tool-connections/${connection.connectionId}`, { allowNotFound: true }); }
    finally { try { if (id) await ctx.input.api.delete(`/api/spaces/${id}`, { allowNotFound: true }); } finally { spaces.delete(ctx); connections.delete(ctx); } }
  },
})];
