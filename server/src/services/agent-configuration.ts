import { isDeepStrictEqual } from "node:util";
import { currentPluginInteractionOrigin } from "./plugin-interaction-context.js";
import { assertAgentInteraction } from "./agent-interaction-policy.js";
import { preserveAgentInteractionPermissions } from "../lib/agent-interaction-permissions.js";
import { assertEphemeralAgentInstructions } from "./agent-instructions.js";
import { notifyStrandedAgentStatus } from "./live-run-recovery-notifications.js";
import { notifyDeferredExecutionEligibility } from "./deferred-execution-notifications.js";
import { notifyRunDispatch } from "./run-dispatch-notifications.js";
import { notifyAttentionRetentionWork } from "./retention-work-notifications.js";
import { notifySkillVersionPinChange } from "./skill-version-retention-notifications.js";
import { DELIVERY_QUEUES, notifyDeliveryWork } from "./delivery-work-notifications.js";
import { notifyExternalConversationSettlement } from "./external-conversation-settlement-notifications.js";
import { and, eq } from "drizzle-orm";
import { agents, assets, agentConfigRevisions, agentTaskSessions, agentRuntimeState, type Db } from "@outpost/db";
import { normalizeAgentUrlKey, extractAgentMentionIds } from "@outpost/shared";
import { normalizeOutpostRunnerAdapterConfig } from "@outpost/adapter-utils/server-utils";
import { conflict, forbidden, notFound, unprocessable } from "../errors.js";
import { agentRecordQueries, type UpdateAgentOptions, type AgentConfigurationPatch, type AgentConfigurationRecord, isPlainRecord, buildConfigSnapshot,
  hasConfigPatchFields, changedPendingApprovalConfigFields, diffConfigSnapshot, jsonEqual } from "../lib/agent-records.js";
import { normalizeAgentPermissions } from "../lib/agent-permissions.js";
import type { ActivityPublication } from "../types/activity-publication.js";
import { secretService, assertClaudeOAuthBindingInvariant } from "./secrets.js";
import { agentCredentialService } from "./agent-credentials.js";
import { clearDefaultAgent } from "./default-agent.js";
import { budgetServiceInTransaction } from "./budgets.js";

export async function lockAgentConfigurationInteractions(tx: Db, id: string, data: AgentConfigurationPatch, options?: UpdateAgentOptions) {
  const pluginOrigin = currentPluginInteractionOrigin();
  if (pluginOrigin) options = { ...options, recordRevision: { ...options?.recordRevision,
    createdByAgentId: pluginOrigin.agentId, createdByUserId: null, source: options?.recordRevision?.source ?? "plugin_agent" } };
  const interactionActorId = pluginOrigin?.agentId ?? options?.recordRevision?.createdByAgentId;
  if (interactionActorId) {
    const [target] = await tx.select({ spaceId: agents.spaceId }).from(agents).where(eq(agents.id, id));
    if (!target) return options;
    await assertAgentInteraction(tx, { spaceId: target.spaceId, actorAgentId: interactionActorId,
      operation: "configure", targetAgentId: id, lockAgentIds: configurationText(data).flatMap(extractAgentMentionIds), lock: "update" });
  }
  return options;
}

export async function prepareAgentConfiguration(db: Db, existing: AgentConfigurationRecord, data: AgentConfigurationPatch, options?: UpdateAgentOptions): Promise<AgentConfigurationPatch> {
  await assertAgentInteraction(db, { spaceId: existing.spaceId, actorAgentId: options?.recordRevision?.createdByAgentId,
    operation: "mention", texts: changedConfigurationText(data, existing) });
  if (data.permissions !== undefined) data = { ...data, permissions: preserveAgentInteractionPermissions(existing.permissions, data.permissions) };
  if (options?.recordRevision?.createdByAgentId && data.budgetMonthlyCents !== undefined && data.budgetMonthlyCents !== existing.budgetMonthlyCents) {
    throw forbidden("Only operators can change agent budgets");
  }
  await notifyAttentionRetentionWork(db, { spaceId: existing.spaceId });
  const id = existing.id;
  const { ensureLeadAgent, assertNoCycle, assertSpaceShortnameAvailable } = agentRecordQueries(db);
  if (existing.status === "pending_approval" && !options?.allowPendingApprovalConfigUpdate) {
    const changedFields = changedPendingApprovalConfigFields(agentRecordQueries(db).normalizeAgentRow(existing), data);
    if (changedFields.length > 0) {
      throw conflict("Pending approval agent configuration cannot be changed before operator approval", {
        code: "pending_approval_agent_config_frozen",
        agentId: id,
        fields: changedFields,
      });
    }
  }

  if (data.leadAgentId !== undefined) {
    if (data.leadAgentId) {
      await ensureLeadAgent(existing.spaceId, data.leadAgentId);
    }
    await assertNoCycle(id, data.leadAgentId);
  }

  if (data.name !== undefined) {
    const previousShortname = normalizeAgentUrlKey(existing.name);
    const nextShortname = normalizeAgentUrlKey(data.name);
    if (previousShortname !== nextShortname) {
      await assertSpaceShortnameAvailable(existing.spaceId, data.name, { excludeAgentId: id });
    }
  }

  if (data.appearance?.customAvatarAssetId) {
    const [asset] = await db.select().from(assets).where(and(
      eq(assets.id, data.appearance.customAvatarAssetId), eq(assets.spaceId, existing.spaceId),
      eq(assets.createdByAgentId, id),
    ));
    if (!asset || asset.contentType !== "image/png" || !asset.objectKey.startsWith(`${existing.spaceId}/agent-avatars/${id}/`)) {
      throw unprocessable("Use the avatar upload endpoint to set this agent's image");
    }
  }
  const normalizedPatch = { ...data } as AgentConfigurationPatch;
  if (options?.recordRevision?.createdByAgentId) delete normalizedPatch.budgetMonthlyCents;
  if (data.permissions !== undefined) {
    normalizedPatch.permissions = normalizeAgentPermissions(data.permissions);
  }
  if (
    Object.prototype.hasOwnProperty.call(normalizedPatch, "adapterConfig") &&
    isPlainRecord(normalizedPatch.adapterConfig)
  ) {
    const normalizedAdapterConfig = await secretService(db).normalizeAdapterConfigForPersistence(
      existing.spaceId,
      normalizedPatch.adapterConfig,
      { adapterType: (normalizedPatch.adapterType ?? existing.adapterType) as string },
    );
    normalizedPatch.adapterConfig = normalizeOutpostRunnerAdapterConfig(
      (normalizedPatch.adapterType ?? existing.adapterType) as string,
      normalizedAdapterConfig,
    );
  } else if (
    Object.prototype.hasOwnProperty.call(normalizedPatch, "adapterType")
    && isPlainRecord(existing.adapterConfig)
  ) {
    normalizedPatch.adapterConfig = normalizeOutpostRunnerAdapterConfig(
      normalizedPatch.adapterType as string,
      existing.adapterConfig,
    );
  }
  if(normalizedPatch.adapterType!==undefined&&normalizedPatch.adapterType!==existing.adapterType
    ||normalizedPatch.adapterConfig!==undefined&&!jsonEqual(normalizedPatch.adapterConfig,existing.adapterConfig))
  await notifyStrandedAgentStatus(db, { spaceId: existing.spaceId, agentId: existing.id });
  await notifyRunDispatch(db, { spaceId: existing.spaceId });
  await notifyDeferredExecutionEligibility(db, { spaceId: existing.spaceId });
  if (normalizedPatch.runtimeConfig !== undefined || normalizedPatch.leadAgentId !== undefined) {
    await notifyDeliveryWork(db, DELIVERY_QUEUES.agentTimers);
  }
  if (normalizedPatch.adapterConfig !== undefined) {
    await notifySkillVersionPinChange(db, existing.spaceId, existing.adapterConfig ?? {}, normalizedPatch.adapterConfig);
  }
  assertEphemeralAgentInstructions({ ...existing, ...normalizedPatch });
  return normalizedPatch;
}

export async function completeAgentConfiguration(txDb: Db, existing: AgentConfigurationRecord, updated: AgentConfigurationRecord, normalizedPatch: AgentConfigurationPatch, options: UpdateAgentOptions | undefined, publications: ActivityPublication[]) {
  const id = updated.id;
  const shouldRecordRevision = Boolean(options?.recordRevision) && hasConfigPatchFields(normalizedPatch);
  const beforeConfig = shouldRecordRevision
    ? buildConfigSnapshot(agentRecordQueries(txDb).normalizeAgentRow(existing))
    : null;
  if (updated.status === "terminated") {
    await clearDefaultAgent(txDb, updated.spaceId, id);
  }

  const priorAdapterConfig = isPlainRecord(existing.adapterConfig) ? existing.adapterConfig : {};
  const afterConfig = isPlainRecord(updated.adapterConfig) ? updated.adapterConfig : {};
  const changedExecution = updated.adapterType !== existing.adapterType
    || (updated.adapterType === "outpost_runner" && ["provider", "acpxAgent", "model"].some(
      (key) => priorAdapterConfig[key] !== afterConfig[key],
    ));
  if (changedExecution) {
    await notifyExternalConversationSettlement(txDb, { spaceId: existing.spaceId });
    await txDb.delete(agentTaskSessions).where(and(eq(agentTaskSessions.spaceId, existing.spaceId), eq(agentTaskSessions.agentId, id)));
    await txDb.update(agentRuntimeState).set({ adapterType: updated.adapterType, sessionId: null, stateJson: {}, updatedAt: new Date() })
      .where(and(eq(agentRuntimeState.spaceId, existing.spaceId), eq(agentRuntimeState.agentId, id)));
  }

  if (Object.prototype.hasOwnProperty.call(normalizedPatch, "adapterConfig")) {
    await agentCredentialService(txDb).enforceClaudeOAuthBindingClaim(txDb, {
      spaceId: existing.spaceId, consume: false, environmentId: null,
      childAdapterConfig: updated.adapterConfig, claudeLogin: options?.claudeLogin,
      decision: assertClaudeOAuthBindingInvariant({ adapterType: updated.adapterType,
        nextConfig: updated.adapterConfig, priorConfig: existing.adapterConfig }),
    });
    await agentCredentialService(txDb).syncAgentSecretBindings(
      updated, txDb,
      existing.adapterConfig,
      options?.recordRevision,
    );
  }

  if (normalizedPatch.budgetMonthlyCents !== undefined) {
    await budgetServiceInTransaction(txDb, publications).upsertPolicy(existing.spaceId, {
      scopeType: "agent", scopeId: id, amount: normalizedPatch.budgetMonthlyCents,
      isActive: normalizedPatch.budgetMonthlyCents > 0, windowKind: "calendar_month_utc",
    }, options?.recordRevision?.createdByUserId ?? null);
  }
  const normalizedUpdated = await agentRecordQueries(txDb).getById(updated.id);
  if (!normalizedUpdated) {
    throw notFound("Agent not found");
  }

  if (shouldRecordRevision && beforeConfig) {
    const afterConfig = buildConfigSnapshot(normalizedUpdated);
    const changedKeys = diffConfigSnapshot(beforeConfig, afterConfig);
    if (changedKeys.length > 0) {
      await txDb.insert(agentConfigRevisions).values({
        spaceId: normalizedUpdated.spaceId,
        agentId: normalizedUpdated.id,
        createdByAgentId: options?.recordRevision?.createdByAgentId ?? null,
        createdByUserId: options?.recordRevision?.createdByUserId ?? null,
        source: options?.recordRevision?.source ?? "patch",
        rolledBackFromRevisionId: options?.recordRevision?.rolledBackFromRevisionId ?? null,
        changedKeys,
        beforeConfig: beforeConfig as unknown as Record<string, unknown>,
        afterConfig: afterConfig as unknown as Record<string, unknown>,
      });
    }
  }
}

function configurationText(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(configurationText);
  if (value && typeof value === "object") return Object.values(value).flatMap(configurationText);
  return [];
}

function changedConfigurationText(next: unknown, previous: unknown): string[] {
  if (isDeepStrictEqual(next, previous)) return [];
  if (typeof next === "string") return [next];
  if (next && typeof next === "object") {
    const prior = previous && typeof previous === "object" ? previous as Record<string, unknown> : {};
    return Object.entries(next).flatMap(([key, value]) => changedConfigurationText(value, prior[key]));
  }
  return [];
}
