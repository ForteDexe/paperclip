import { assertAgentInteraction } from "./agent-interaction-policy.js";
import { assertNoInitialAgentInteractionPermissions, preserveAgentInteractionPermissions } from "../lib/agent-interaction-permissions.js";
import { assertEphemeralAgentInstructions } from "./agent-instructions.js";
import { initializeDurableAgentFiles } from "./agent-file-durability.js";
import { notifyAttentionRetentionWork } from "./retention-work-notifications.js";
import { notifySkillVersionRetention, notifySkillVersionPinChange } from "./skill-version-retention-notifications.js";
import { agentAppearanceSchema, randomAgentAppearance } from "@outpost/shared";
import { normalizeOutpostRunnerAdapterConfig } from "@outpost/adapter-utils/server-utils";
import { agents, toolConnectionInstalls, principalPermissionGrants, type Db } from "@outpost/db";
import { eq } from "drizzle-orm";
import { unprocessable } from "../errors.js";
import { agentRecordQueries, isPlainRecord, configPatchFromApprovalPayload, normalizeRuntimeConfigForNewAgent,
  deduplicateAgentName, type CreateAgentData, type CreateAgentOptions, type AgentConfigurationPatch, type AgentCreationRecord } from "../lib/agent-records.js";
import { normalizeAgentPermissions, permissionsImplyLowTrust, NEW_STANDARD_AGENT_DEFAULT_GRANT_KEYS,
  newStandardAgentGrantScope } from "../lib/agent-permissions.js";
import { secretService, assertClaudeOAuthBindingInvariant } from "./secrets.js";
import { agentCredentialService } from "./agent-credentials.js";
import { agentIdentityService } from "./agent-identity.js";
import { initializeDefaultAgent } from "./default-agent.js";
import { resolveAgentRunnerTaskDriverForSpace, resolveNewAgentRunnerForSpace } from "./agent-runner-selection.js";
import { instanceSettingsService } from "./instance-settings.js";
import { assertProviderApiPlacementPolicy, isProviderApiSetupDraft, resolveProviderApiPlacement } from "./native-runtime/provider-api-placement.js";

export async function prepareAgentCreation(db: Db, spaceId: string, input: CreateAgentData, options?: CreateAgentOptions): Promise<CreateAgentData> {
  assertNoInitialAgentInteractionPermissions(input.permissions);
  await assertAgentInteraction(db, { spaceId, actorAgentId: options?.createdByAgentId, actorSpaceId: options?.createdByAgentSpaceId,
    operation: "mention", texts: [JSON.stringify(input), ...(options?.interactionTexts ?? [])], lock: "update" });
  await notifyAttentionRetentionWork(db, { spaceId });
  const { runner, ...data } = input;
  const selection = options?.runnerResolved
    ? { adapterType: data.adapterType ?? "process", adapterConfig: isPlainRecord(data.adapterConfig) ? data.adapterConfig : {} }
    : await resolveNewAgentRunnerForSpace(db, spaceId, {
        ...data, adapterConfig: isPlainRecord(data.adapterConfig) ? data.adapterConfig : {}, runner,
      });
  data.adapterType = selection.adapterType;
  data.adapterConfig = selection.adapterConfig;
  const { ensureLeadAgent } = agentRecordQueries(db);
  if (data.appearance?.customAvatarAssetId) throw unprocessable("Create the agent before uploading its avatar");
  if (data.leadAgentId) {
    await ensureLeadAgent(spaceId, data.leadAgentId);
  }

  const existingAgents = await db
    .select({ id: agents.id, name: agents.name, status: agents.status })
    .from(agents)
    .where(eq(agents.spaceId, spaceId));
  const uniqueName = deduplicateAgentName(data.name, existingAgents.filter(agent => agent.id !== options?.setupAgentId));

  const role = data.role ?? "general";
  const normalizedPermissions = normalizeAgentPermissions(data.permissions, { context: "create" });
  const runtimeConfig = normalizeRuntimeConfigForNewAgent(data.runtimeConfig);
  const adapterType = data.adapterType ?? "process";
  const rawAdapterConfig = isPlainRecord(data.adapterConfig)
    ? await secretService(db).normalizeAdapterConfigForPersistence(spaceId, data.adapterConfig, { adapterType })
    : {};
  const adapterConfig = normalizeOutpostRunnerAdapterConfig(adapterType, rawAdapterConfig);
  const profile = { adapterType, adapterConfig };
  const providerApiDraft = options?.setupOnly === true && isProviderApiSetupDraft(profile);
  const providerApi = providerApiDraft ? null : resolveProviderApiPlacement({ agent: profile });
  if (providerApi) assertProviderApiPlacementPolicy(await instanceSettingsService(db).getGeneral());
  if (!providerApiDraft && !providerApi && adapterType === "outpost_runner" && !["openai_dot", "grok_bot", "muse"].includes(String(adapterConfig.provider)) &&
      (await resolveAgentRunnerTaskDriverForSpace(db, spaceId, data.defaultEnvironmentId))?.warmTaskVersion === 1) {
    adapterConfig.lifecycleMode = "warm";
  }
  await agentCredentialService(db).enforceClaudeOAuthBindingClaim(db, {
    spaceId, consume: true, environmentId: data.defaultEnvironmentId ?? null,
    childAdapterConfig: adapterConfig, claudeLogin: options?.claudeLogin,
    decision: assertClaudeOAuthBindingInvariant({ adapterType, nextConfig: adapterConfig }),
  });
  if (options?.setupAgentId) await notifySkillVersionRetention(db, spaceId);
  return { ...data, name: uniqueName,
    appearance: data.appearance == null ? randomAgentAppearance() : agentAppearanceSchema.parse(data.appearance),
    role, adapterType, adapterConfig, permissions: normalizedPermissions, runtimeConfig };
}

export async function initializeAgentCreation(txDb: Db, created: AgentCreationRecord, options?: CreateAgentOptions) {
  const tx = txDb;
  const spaceId = created.spaceId;
  assertEphemeralAgentInstructions({ ...created, name: "" });
  await initializeDurableAgentFiles(txDb, created);
  await agentIdentityService(txDb).ensureAgentIdentity(spaceId, created.id);
  // New standard agents receive the standard direct grants at activation.
  // Low-trust agents keep their explicit, narrower grants.
  if (!options?.setupOnly && created.status !== "pending_approval" && !permissionsImplyLowTrust(created.permissions)) {
    await tx.insert(principalPermissionGrants).values(
      NEW_STANDARD_AGENT_DEFAULT_GRANT_KEYS.map((permissionKey) => ({
        spaceId,
        principalType: "agent" as const,
        principalId: created.id,
        permissionKey,
        scope: newStandardAgentGrantScope(permissionKey, created.id),
      })),
    ).onConflictDoNothing();
  }
  if (options?.aiConnectionInstall) {
    const install = options.aiConnectionInstall;
    const connectionIds = [...new Set([install.connectionId, ...(install.memberConnectionIds ?? [])])];
    await tx.insert(toolConnectionInstalls).values(connectionIds.map(connectionId => ({
      spaceId, connectionId,
      targetType: "agent" as const, targetId: created.id,
      createdByUserId: install.createdByUserId,
    }))).onConflictDoNothing();
  }
  await agentCredentialService(txDb).syncAgentSecretBindings(created, txDb);
  if (!options?.setupOnly && options?.createdByUserId) {
    await initializeDefaultAgent(txDb, spaceId, options.createdByUserId, created.id);
  }
}

export async function prepareAgentCreationApproval(txDb: Db, existing: AgentCreationRecord, approvedPayload?: Record<string, unknown> | null): Promise<AgentConfigurationPatch> {
  const approvedPatch = approvedPayload ? configPatchFromApprovalPayload(approvedPayload) : {};
  const patch = { ...approvedPatch } as AgentConfigurationPatch;
  const hasApprovedAdapterConfig = Object.prototype.hasOwnProperty.call(patch, "adapterConfig") && isPlainRecord(patch.adapterConfig);
  if (
    Object.prototype.hasOwnProperty.call(patch, "adapterConfig") &&
    isPlainRecord(patch.adapterConfig)
  ) {
    const normalizedAdapterConfig = await secretService(txDb).normalizeAdapterConfigForPersistence(
      existing.spaceId, patch.adapterConfig, { adapterType: (patch.adapterType ?? existing.adapterType) as string },
    );
    patch.adapterConfig = normalizeOutpostRunnerAdapterConfig(
      (patch.adapterType ?? existing.adapterType) as string,
      normalizedAdapterConfig,
    );
  } else if (
    Object.prototype.hasOwnProperty.call(patch, "adapterType")
    && isPlainRecord(existing.adapterConfig)
  ) {
    patch.adapterConfig = normalizeOutpostRunnerAdapterConfig(
      patch.adapterType as string,
      existing.adapterConfig,
    );
  }
  if (patch.permissions !== undefined) {
    // The pending-approval activation replays the original create
    // request, so the new-creation default applies.
    patch.permissions = normalizeAgentPermissions(preserveAgentInteractionPermissions(existing.permissions, patch.permissions), { context: "create" });
  }
  if (hasApprovedAdapterConfig) {
    await agentCredentialService(txDb).enforceClaudeOAuthBindingClaim(txDb, {
      spaceId: existing.spaceId, consume: false, environmentId: null,
      childAdapterConfig: patch.adapterConfig,
      decision: assertClaudeOAuthBindingInvariant({ adapterType: patch.adapterType ?? existing.adapterType,
        nextConfig: patch.adapterConfig, priorConfig: existing.adapterConfig }),
    });
  }
  if (patch.adapterConfig !== undefined) await notifySkillVersionPinChange(txDb, existing.spaceId, existing.adapterConfig ?? {}, patch.adapterConfig);
  assertEphemeralAgentInstructions({ ...existing, ...patch, name: "" });
  return patch;
}

export async function completeAgentCreationApproval(txDb: Db, updated: AgentCreationRecord, existing: AgentCreationRecord) {
  const tx = txDb;
  await agentCredentialService(txDb).syncAgentSecretBindings(updated, txDb, existing.adapterConfig);
  if (!permissionsImplyLowTrust(updated.permissions)) {
    await tx.insert(principalPermissionGrants).values(
      NEW_STANDARD_AGENT_DEFAULT_GRANT_KEYS.map((permissionKey) => ({
        spaceId: updated.spaceId,
        principalType: "agent" as const,
        principalId: updated.id,
        permissionKey,
        scope: newStandardAgentGrantScope(permissionKey, updated.id),
      })),
    ).onConflictDoNothing();
  }
}
