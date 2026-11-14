import type { Agent } from "../../../packages/shared/src/types/agent.js";
import type { BudgetOverview } from "../../../packages/shared/src/types/budget.js";
import type { HeartbeatRun } from "../../../packages/shared/src/types/heartbeat.js";
import { updateAgentPermissionsSchema } from "../../../packages/shared/src/validators/agent.js";
import type { ChatCatalogContext } from "../chat-catalog-contract.js";
import type { ChatRun } from "../chat-flow.js";
import { pollUntil } from "../api.js";

/** Use the permission-specific public route; ordinary agent updates reject permissions. */
export async function grantCaseTaskAssignment(ctx: ChatCatalogContext, agentId: string) {
  const before = await ctx.input.api.get<Agent>(`/api/agents/${agentId}`);
  if (before.id !== agentId || before.spaceId !== ctx.input.fixtures.space.id) throw new Error("Case assignment prerequisite agent scope mismatch");
  const permissions = updateAgentPermissionsSchema.parse({ ...before.permissions, canAssignTasks: true });
  await ctx.input.api.patch(`/api/agents/${agentId}/permissions`, permissions);
  const after = await ctx.input.api.get<Agent>(`/api/agents/${agentId}`);
  if (after.id !== before.id || after.spaceId !== before.spaceId || !after.permissions.canAssignTasks
    || after.permissions.canCreateAgents !== before.permissions.canCreateAgents) throw new Error("Case assignment prerequisite public readback failed");
  await ctx.input.evidence(`chat-case-assignment-${agentId}.json`, { agentId, spaceId: before.spaceId, beforePermissions: before.permissions, requestedPermissions: permissions, afterPermissions: after.permissions });
}

type CancellationIdentity = { spaceId: string; agentId: string; issueId: string; runId: string };
type CancellationSnapshot = { run: Pick<HeartbeatRun, "id" | "spaceId" | "agentId" | "issueId" | "status" | "finishedAt">; nativeRun: ChatRun | undefined; overview: BudgetOverview };
export function caseCancellationAccountingReady(expected: CancellationIdentity, value: CancellationSnapshot): boolean {
  const { run, nativeRun, overview } = value;
  if (run.id !== expected.runId || run.spaceId !== expected.spaceId || run.agentId !== expected.agentId || run.issueId !== expected.issueId
    || run.status !== "cancelled" || !run.finishedAt || nativeRun?.id !== run.id || nativeRun.spaceId !== run.spaceId
    || nativeRun.agentId !== run.agentId || nativeRun.runtimeMode !== "native" || nativeRun.status !== "cancelled"
    || nativeRun.contextSnapshot?.issueId !== expected.issueId || overview.spaceId !== expected.spaceId) return false;
  const relevant = overview.policies.filter(policy => policy.isActive && (policy.scopeType === "space" && policy.scopeId === expected.spaceId || policy.scopeType === "agent" && policy.scopeId === expected.agentId));
  // Public pendingRunCount includes terminal runs awaiting final accounting. Both
  // funded scopes must be observable; absence of policies is not readiness.
  return ["space", "agent"].every(scope => relevant.some(policy => policy.scopeType === scope))
    && relevant.every(policy => policy.spaceId === expected.spaceId && policy.hardStopEnabled && policy.amount > 0
      && policy.unpricedUsagePolicy === "allow" && policy.pendingRunCount === 0 && policy.status !== "hard_stop" && !policy.paused && policy.remainingAmount > 0);
}

export async function waitCaseCancellationAccounting(ctx: ChatCatalogContext, expected: CancellationIdentity) {
  const snapshot = await pollUntil({ label: "owned cancelled case prerequisite final accounting before canonical admission", deadlineAt: Date.now() + 60_000, intervalMs: 1000,
    load: async (): Promise<CancellationSnapshot> => ({ run: await ctx.input.api.get<HeartbeatRun>(`/api/heartbeat-runs/${expected.runId}`),
      nativeRun: (await ctx.allRuns()).find(run => run.id === expected.runId), overview: await ctx.input.api.get<BudgetOverview>(`/api/spaces/${expected.spaceId}/budgets/overview`) }),
    accept: value => caseCancellationAccountingReady(expected, value) });
  await ctx.input.evidence("chat-case-cancelled-prerequisite-accounting.json", { expected, ...snapshot });
}
