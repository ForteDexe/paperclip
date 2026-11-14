import { notifyBudgetResumeAgentReady } from "./budget-resume-continuation.js";
import { currentControllerProcessStamp } from "./controller-process-identity.js";
import { notifyStrandedAgentStatus } from "./live-run-recovery-notifications.js";
import { notifyDeferredExecutionEligibility } from "./deferred-execution-notifications.js";
import { notifyRunDispatch } from "./run-dispatch-notifications.js";
import { notifyAttentionRetentionWork } from "./retention-work-notifications.js";
import { notifyNativeReviewResponse } from "./native-review-response-notifications.js";
import { isAgentStatusInvokable } from "@outpost/shared";
import { notifyNativeResponsePresentation } from "./native-response-presentation-notifications.js";
import { notifyChatInboundWakeNotices } from "./chat-inbound-wake-notice-notifications.js";
import { logger } from "../middleware/logger.js";
import { agents, spaces, type Db } from "@outpost/db";
import { and, eq } from "drizzle-orm";
import { persistActivity, type ActivityPublication } from "./activity-log.js";
import * as lifecycle from "../modules/agent-lifecycle/index.js";
import { withAccountingTransaction } from "./accounting-transaction.js";
import { budgetServiceInTransaction, policyBlocks, type BudgetServiceHooks } from "./budgets.js";
import { recordAgentStatusEvent, recordResourceCreationEvent } from "./resource-lifecycle-events.js";
import { clearDefaultAgent } from "./default-agent.js";
import { deleteAgentDependencies } from "./agent-deletion.js";
import { lockAgentConfigurationInteractions, prepareAgentConfiguration, completeAgentConfiguration } from "./agent-configuration.js";
import { prepareAgentCreation, initializeAgentCreation, prepareAgentCreationApproval, completeAgentCreationApproval } from "./agent-creation.js";
import { DELIVERY_QUEUES, notifyDeliveryWork } from "./delivery-work-notifications.js";
import { fenceActiveSpaceAgentStopsInTransaction as fenceActiveSpaceStops } from "../modules/agent-lifecycle/index.js";
import { applyAgentPolicyHoldsInTransaction } from "../modules/agent-lifecycle/index.js";
import { trackIdleWork } from "./task-admission.js";
import { environmentService } from "./environments.js";
import { instanceSettingsService } from "./instance-settings.js";
import { pluginEnvironmentRequiresAgent, pluginForAgentEnvironment } from "./plugin-environment-driver.js";
import { isProviderApiSetupDraft } from "./native-runtime/provider-api-placement.js";

export { scheduleAgentLifecycle, processAgentLifecycle } from "../modules/agent-lifecycle/index.js";
export type { LifecycleDriver, LifecycleAgent } from "../modules/agent-lifecycle/index.js";

export function createAgentLifecycleEffects(_hooks: BudgetServiceHooks = {}): lifecycle.LifecycleEffects {
  return {
    async setupRequiresPreparation(db, spaceId, environmentId, profile) {
      if (isProviderApiSetupDraft(profile)) return false;
      const id = environmentId ?? (await instanceSettingsService(db).get()).defaultEnvironmentId;
      const environment = id ? await environmentService(db).getById(id) : null;
      if (!environment || !await pluginEnvironmentRequiresAgent(db, environment)) return false;
      const [space] = await db.select({ requiresApproval: spaces.requireOperatorApprovalForNewAgents }).from(spaces).where(eq(spaces.id, spaceId));
      if (!space || space.requiresApproval) return false;
      const bound = await environmentService(db).listBoundSpaceIds(environment.id);
      if (bound.length && !bound.includes(spaceId)) throw new lifecycle.AgentLifecycleConflict("The environment belongs to another space");
      return true;
    },
    async environmentRequiresNewPlugin(db, environmentId, selectedPluginIds) {
      const id = environmentId ?? (await instanceSettingsService(db).get()).defaultEnvironmentId;
      const environment = id ? await environmentService(db).getById(id) : null;
      const plugin = environment ? await pluginForAgentEnvironment(db, environment) : null;
      return plugin !== null && !selectedPluginIds?.includes(plugin.id);
    },
    notifyWork: tx => notifyDeliveryWork(tx, DELIVERY_QUEUES.agentLifecycle),
    leaseHolder: () => currentControllerProcessStamp(),
    beforeConnectionEligibilityRestore: async (tx, spaceId, agentId) => {
    },
    async beforeStatusChange(tx, spaceId, agentId, before, after) {
      await notifyAttentionRetentionWork(tx, { spaceId });
      if (before !== after) {
        await notifyStrandedAgentStatus(tx, { spaceId, agentId });
        await notifyRunDispatch(tx, { spaceId });
        await notifyDeferredExecutionEligibility(tx, { spaceId });
        await notifyDeliveryWork(tx, DELIVERY_QUEUES.agentTimers);
      }
      if (!isAgentStatusInvokable(before) && isAgentStatusInvokable(after)) {
        await notifyNativeResponsePresentation(tx, { spaceId, agentId });
        await notifyNativeReviewResponse(tx, { spaceId, agentId });
        await notifyChatInboundWakeNotices(tx, { spaceId });
        await notifyBudgetResumeAgentReady(tx, agentId);
      }
    },
    reportFailure(context, error) {
      const code = lifecycle.lifecycleFailureCode(error);
      logger.warn({ ...context, failureCode: code ?? "unclassified" }, "Agent lifecycle operation failed");
    },
    transaction: withAccountingTransaction,
    deleteDependencies: deleteAgentDependencies,
    policyBlocks,
    setAgentBudget: (db, publications, spaceId, agentId, amount, userId, isActive) =>
      budgetServiceInTransaction(db, publications).upsertPolicy(spaceId, {
        scopeType: "agent", scopeId: agentId, amount, isActive, windowKind: "calendar_month_utc",
      }, userId),
    recordCreation: (db, spaceId, agentId) => recordResourceCreationEvent(db, spaceId, "agent", agentId),
    recordStatus: recordAgentStatusEvent,
    clearPrimary: clearDefaultAgent,
    lockConfigurationInteractions: lockAgentConfigurationInteractions,
    prepareConfiguration: prepareAgentConfiguration,
    completeConfiguration: completeAgentConfiguration,
    prepareCreate: prepareAgentCreation,
    initializeCreate: initializeAgentCreation,
    prepareCreationApproval: prepareAgentCreationApproval,
    completeCreationApproval: completeAgentCreationApproval,
  };
}

export function createAgentLifecycle(db: Db, hooks: BudgetServiceHooks = {}) {
  return lifecycle.createAgentLifecycle(db, createAgentLifecycleEffects(hooks));
}

export function initializeImportedAgentConfigurationInTransaction(tx: Db, publications: ActivityPublication[],
  id: string, data: Parameters<typeof lifecycle.initializeImportedAgentConfigurationInTransaction>[4]) {
  return lifecycle.initializeImportedAgentConfigurationInTransaction(tx, createAgentLifecycleEffects(), publications, id, data);
}

export function requestAgentCreationInTransaction(tx: Db, publications: ActivityPublication[],
  ...args: Parameters<ReturnType<typeof createAgentLifecycle>["requestCreation"]>) {
  return lifecycle.requestAgentCreationInTransaction(tx, createAgentLifecycleEffects(), publications, ...args);
}

function trackedDriver(driver: lifecycle.LifecycleDriver): lifecycle.LifecycleDriver {
  return { ...driver, runHost: agent => trackIdleWork(driver.runHost(agent)),
    runPlugin: (agent, pluginId) => trackIdleWork(driver.runPlugin(agent, pluginId)) };
}

export function configureAgentLifecycle(db: Db, driver: lifecycle.LifecycleDriver, canRun = () => true) {
  return lifecycle.configureAgentLifecycle(db, createAgentLifecycleEffects(), trackedDriver(driver), canRun);
}

export function startAgentLifecycle(db: Db, driver: lifecycle.LifecycleDriver, canRun: () => boolean) {
  return lifecycle.startAgentLifecycle(db, createAgentLifecycleEffects(), trackedDriver(driver), canRun);
}

/** Budget evaluation owns the transaction and supplies the aggregate agent decision. */
/** Pass the transaction's post-commit `publications` so the entry reaches live
 * subscribers after commit; without them it publishes nothing until reload. */
export async function applyAgentBudgetHoldInTransaction(tx: Db, spaceId: string, agentId: string, blocked: boolean,
  publications?: ActivityPublication[]) {
  const [before] = await tx.select({ holds: agents.lifecycleHolds }).from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.spaceId, spaceId)));
  const updated = await applyAgentPolicyHoldsInTransaction(tx, createAgentLifecycleEffects(), spaceId, agentId, { budget: blocked });
  // A budget pause is a policy stop: record it, and its release, with the
  // reason, in the transaction that applies it.
  const had = before?.holds?.includes("budget") ?? false;
  const has = updated?.lifecycleHolds?.includes("budget") ?? had;
  if (updated && had !== has) {
    const { publication } = await persistActivity(tx, { spaceId, actorType: "system", actorId: "budget",
      // Releasing the budget hold resumes the agent only when no other hold
      // (a manual or space pause) still keeps it paused.
      agentId, action: has ? "agent.paused" : updated.lifecycleHolds.length === 0 ? "agent.resumed" : "agent.budget_hold_released",
      entityType: "agent", entityId: agentId,
      details: { reason: "budget", lifecycleState: updated.lifecycleState, holds: updated.lifecycleHolds } });
    if (publication) publications?.push(publication);
  }
  return updated;
}

export function fenceActiveSpaceAgentStopsInTransaction(tx: Db, spaceId: string, status: "paused" | "archived") {
  return fenceActiveSpaceStops(tx, createAgentLifecycleEffects(), spaceId, status);
}
