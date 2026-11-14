import type { AgentPublicIdentity } from "@outpost/shared";
import type { AgentProjectAccess } from "@outpost/shared";
import type {
  Agent,
  EnvironmentProbeResult,
  ConnectionIntentInteraction,
  AgentDesiredSkillEntry,
  AgentSkillAssignmentMode,
  AgentPermissions,
  AgentDetail,
  AgentInstructionsBundle,
  AgentInstructionHistory,
  AgentInstructionCandidate,
  ResolveAgentInstructionCandidate,
  AgentInstructionDiff,
  AgentInstructionSnapshot,
  AgentInstructionsFileDetail,
  AgentSkillSnapshot,
  AdapterEnvironmentTestResult,
  AdapterAuthSignalResponse,
  AdapterAuthSessionResponse,
  AdapterAuthSessionOwnerResponse,
  ClaudeSetupTokenSessionResponse,
  ClaudeSetupTokenSessionOwnerResponse,
  ClaudeSetupTokenSessionPrompt,
  ClaudeSetupTokenCompletionResponse,
  ClaudeSetupTokenOverwrite,
  ClaudeOAuthTokenStatusResponse,
  SubmitBrowserCodeRequest,
  AgentKeyCreated,
  AgentRuntimeState,
  AgentTaskSession,
  AgentWakeupResponse,
  ChatFailedRunRetryResponse,
  HeartbeatRun,
  Approval,
  AgentConfigRevision,
  ClearAgentErrorResponse,
  AgentApiKeyScope,
} from "@outpost/shared";
import { isUuidLike, normalizeAgentUrlKey } from "@outpost/shared";
import { ApiError, api, type RequestOptions } from "./client";

export interface AgentKey {
  id: string;
  name: string;
  scope: AgentApiKeyScope;
  createdAt: Date;
  revokedAt: Date | null;
}

export interface AdapterModel {
  id: string;
  label: string;
}

export interface DetectedAdapterModel {
  model: string;
  provider: string;
  source: string;
  candidates?: string[];
}

export interface ClaudeLoginResult {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  loginUrl: string | null;
  stdout: string;
  stderr: string;
}

export interface OrgNode {
  id: string;
  name: string;
  role: string;
  status: string;
  reports: OrgNode[];
}

export interface AgentCreationResponse {
  agent: Agent;
  approval: Approval | null;
}

export interface AgentPermissionUpdate {
  canCreateAgents: boolean;
  canCreateSkills: boolean;
  canAssignTasks: boolean;
  trustPreset?: AgentPermissions["trustPreset"];
  authorizationPolicy?: AgentPermissions["authorizationPolicy"];
}

export interface AgentWakeRequest {
  source?: "timer" | "assignment" | "on_demand" | "automation";
  triggerDetail?: "manual" | "ping" | "callback" | "system";
  reason?: string | null;
  payload?: Record<string, unknown> | null;
  idempotencyKey?: string | null;
  forceFreshSession?: boolean;
  debug?: { providerTrace: "raw" };
}

function withSpaceScope(path: string, spaceId?: string) {
  if (!spaceId) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}spaceId=${encodeURIComponent(spaceId)}`;
}

function agentPath(id: string, spaceId?: string, suffix = "") {
  return withSpaceScope(`/agents/${encodeURIComponent(id)}${suffix}`, spaceId);
}

export const agentsApi = {
  projectAccess: (id: string) => api.get<AgentProjectAccess>(`/agents/${id}/project-access`),
  addProjectAccess: (id: string, projectIds: string[]) => api.post<AgentProjectAccess>(`/agents/${id}/project-access`, { projectIds }),
  qualifyRunner: (id: string, expectedEnvironmentId: string, spaceId?: string) =>
    api.post<EnvironmentProbeResult>(agentPath(id, spaceId, "/qualify-runner"), { expectedEnvironmentId }),
  setAvatar: (spaceId: string, agentId: string, imageBase64: string | null) =>
    api.put<{ agentId: string; appearance: import("@outpost/shared").AgentAppearance; avatarUrl: string }>(`/spaces/${spaceId}/agents/${agentId}/avatar`, { imageBase64 }),
  getIdentity: (id: string, spaceId?: string) =>
    api.get<AgentPublicIdentity | null>(agentPath(id, spaceId, "/identity")),
  adoptAiConnection: (agentId: string, interactionId: string, connectionId: string, spaceId: string) =>
    api.post<ConnectionIntentInteraction>(withSpaceScope(`/agents/${agentId}/connection-intents/${interactionId}/adopt`, spaceId), { connectionId }),

  list: (spaceId: string) => api.get<Agent[]>(`/spaces/${spaceId}/agents`),
  org: (spaceId: string) => api.get<OrgNode[]>(`/spaces/${spaceId}/org`),
  listConfigurations: (spaceId: string) =>
    api.get<Record<string, unknown>[]>(`/spaces/${spaceId}/agent-configurations`),
  get: async (id: string, spaceId?: string, options?: RequestOptions) => {
    try {
      return await api.get<AgentDetail>(agentPath(id, spaceId), options);
    } catch (error) {
      // Backward-compat fallback: if backend shortname lookup reports ambiguity,
      // resolve using space agent list while ignoring terminated agents.
      if (
        !(error instanceof ApiError) ||
        error.status !== 409 ||
        !spaceId ||
        isUuidLike(id)
      ) {
        throw error;
      }

      const urlKey = normalizeAgentUrlKey(id);
      if (!urlKey) throw error;

      const agents = await api.get<Agent[]>(`/spaces/${spaceId}/agents`, options);
      const matches = agents.filter(
        (agent) => agent.status !== "terminated" && normalizeAgentUrlKey(agent.urlKey) === urlKey,
      );
      if (matches.length !== 1) throw error;
      return api.get<AgentDetail>(agentPath(matches[0]!.id, spaceId), options);
    }
  },
  getConfiguration: (id: string, spaceId?: string) =>
    api.get<import("@outpost/shared").AgentConfigurationResponse>(agentPath(id, spaceId, "/configuration")),
  listConfigRevisions: (id: string, spaceId?: string) =>
    api.get<AgentConfigRevision[]>(agentPath(id, spaceId, "/config-revisions")),
  getConfigRevision: (id: string, revisionId: string, spaceId?: string) =>
    api.get<AgentConfigRevision>(agentPath(id, spaceId, `/config-revisions/${revisionId}`)),
  rollbackConfigRevision: (id: string, revisionId: string, spaceId?: string) =>
    api.post<Agent>(agentPath(id, spaceId, `/config-revisions/${revisionId}/rollback`), {}),
  create: (spaceId: string, data: Record<string, unknown>) =>
    api.post<Agent>(`/spaces/${spaceId}/agents`, data),
  requestCreation: (spaceId: string, data: Record<string, unknown>) =>
    api.post<AgentCreationResponse>(`/spaces/${spaceId}/agent-creations`, data),
  updateRuntimeSettings: (id: string, runtimeSettings: import("@outpost/shared").AgentRuntimeSettingsPatch, spaceId: string) =>
    api.patch<Agent>(agentPath(id, spaceId), { runtimeSettings }),
  update: (id: string, data: Record<string, unknown>, spaceId?: string) =>
    api.patch<Agent & import("@outpost/shared").AgentConfigurationResponse>(agentPath(id, spaceId), data),
  updatePermissions: (id: string, data: AgentPermissionUpdate, spaceId?: string) =>
    api.patch<AgentDetail>(agentPath(id, spaceId, "/permissions"), data),
  instructionsBundle: (id: string, spaceId?: string) =>
    api.get<AgentInstructionsBundle>(agentPath(id, spaceId, "/instructions-bundle")),
  updateInstructionsBundle: (
    id: string,
    data: {
      mode?: "managed" | "external";
      rootPath?: string | null;
      entryFile?: string;
      clearLegacyPromptTemplate?: boolean;
      requireExistingEntry?: boolean;
    },
    spaceId?: string,
  ) => api.patch<AgentInstructionsBundle>(agentPath(id, spaceId, "/instructions-bundle"), data),
  instructionsFile: (id: string, relativePath: string, spaceId?: string) =>
    api.get<AgentInstructionsFileDetail>(
      agentPath(id, spaceId, `/instructions-bundle/file?path=${encodeURIComponent(relativePath)}`),
    ),
  saveInstructionsFile: (
    id: string,
    data: { path: string; content: string; baseRevisionId?: string | null; baseHash?: string | null; clearLegacyPromptTemplate?: boolean },
    spaceId?: string,
  ) => api.put<AgentInstructionsFileDetail>(agentPath(id, spaceId, "/instructions-bundle/file"), data),
  instructionCandidates: (id: string, spaceId?: string) =>
    api.get<AgentInstructionCandidate[]>(agentPath(id, spaceId, "/instructions-bundle/candidates")),
  resolveInstructionCandidate: (id: string, runId: string, data: ResolveAgentInstructionCandidate, spaceId?: string) =>
    api.post<AgentInstructionsFileDetail>(agentPath(id, spaceId, `/instructions-bundle/candidates/${runId}/resolve`), data),
  instructionHistory: (id: string, path: string, spaceId?: string, cursor?: string) =>
    api.get<AgentInstructionHistory>(agentPath(id, spaceId, `/instructions-bundle/history?path=${encodeURIComponent(path)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)),
  instructionRevision: (id: string, path: string, revisionId: string, spaceId?: string) =>
    api.get<AgentInstructionSnapshot>(agentPath(id, spaceId, `/instructions-bundle/revision/${revisionId}?path=${encodeURIComponent(path)}`)),
  instructionDiff: (id: string, path: string, from: string, to: string, spaceId?: string) =>
    api.get<AgentInstructionDiff>(agentPath(id, spaceId, `/instructions-bundle/diff?path=${encodeURIComponent(path)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)),
  restoreInstructions: (id: string, data: { path: string; revisionId: string; baseRevisionId: string }, spaceId?: string) =>
    api.post<AgentInstructionsFileDetail>(agentPath(id, spaceId, "/instructions-bundle/restore"), data),
  downloadInstructionsFile: (id: string, relativePath: string, spaceId?: string) =>
    `/api${agentPath(id, spaceId, `/instructions-bundle/file?path=${encodeURIComponent(relativePath)}&download=true`)}`,
  deleteInstructionsFile: (id: string, relativePath: string, spaceId?: string, baseHash?: string) =>
    api.delete<AgentInstructionsBundle>(
      agentPath(id, spaceId, `/instructions-bundle/file?path=${encodeURIComponent(relativePath)}${baseHash ? `&baseHash=${baseHash}` : ""}`),
    ),
  retryLifecycle: (id: string, spaceId?: string) => api.post<Agent>(agentPath(id, spaceId, "/lifecycle/retry"), {}),
  pause: (id: string, spaceId?: string) => api.post<Agent>(agentPath(id, spaceId, "/pause"), {}),
  resume: (id: string, spaceId?: string) => api.post<Agent>(agentPath(id, spaceId, "/resume"), {}),
  clearError: (id: string, spaceId?: string) =>
    api.post<ClearAgentErrorResponse>(agentPath(id, spaceId, "/clear-error"), {}),
  approve: (id: string, spaceId?: string) => api.post<Agent>(agentPath(id, spaceId, "/approve"), {}),
  terminate: (id: string, spaceId?: string) => api.post<Agent>(agentPath(id, spaceId, "/terminate"), {}),
  remove: (id: string, spaceId?: string) => api.delete<{ ok: true }>(agentPath(id, spaceId)),
  listKeys: (id: string, spaceId?: string) => api.get<AgentKey[]>(agentPath(id, spaceId, "/keys")),
  skills: (id: string, spaceId?: string) =>
    api.get<AgentSkillSnapshot>(agentPath(id, spaceId, "/skills")),
  syncSkills: (
    id: string,
    desiredSkills: Array<string | AgentDesiredSkillEntry>,
    mode: AgentSkillAssignmentMode,
    spaceId?: string,
  ) => api.post<AgentSkillSnapshot>(agentPath(id, spaceId, "/skills/sync"), { desiredSkills, mode }),
  createKey: (id: string, name: string, spaceId?: string, scope?: AgentApiKeyScope) =>
    api.post<AgentKeyCreated>(agentPath(id, spaceId, "/keys"), { name, ...(scope ? { scope } : {}) }),
  revokeKey: (agentId: string, keyId: string, spaceId?: string) =>
    api.delete<{ ok: true }>(agentPath(agentId, spaceId, `/keys/${encodeURIComponent(keyId)}`)),
  runtimeState: (id: string, spaceId?: string) =>
    api.get<AgentRuntimeState>(agentPath(id, spaceId, "/runtime-state")),
  taskSessions: (id: string, spaceId?: string) =>
    api.get<AgentTaskSession[]>(agentPath(id, spaceId, "/task-sessions")),
  resetSession: (id: string, taskKey?: string | null, spaceId?: string) =>
    api.post<void>(agentPath(id, spaceId, "/runtime-state/reset-session"), { taskKey: taskKey ?? null }),
  adapterModels: (
    spaceId: string,
    type: string,
    options?: { refresh?: boolean; environmentId?: string | null; provider?: string; acpxAgent?: string; aiConnection?: import("@outpost/shared").AiConnectionBinding; agentId?: string; poolId?: string },
  ) => {
    const params = new URLSearchParams();
    if (options?.refresh) params.set("refresh", "1");
    if (options?.provider) params.set("provider", options.provider);
    if (options?.acpxAgent) params.set("acpxAgent", options.acpxAgent);
    if (options?.aiConnection) params.set("aiConnection", JSON.stringify(options.aiConnection));
    if (options?.agentId) params.set("agentId", options.agentId);
    if (options?.poolId) params.set("poolId", options.poolId);
    if (options?.environmentId) params.set("environmentId", options.environmentId);
    const query = params.size > 0 ? `?${params.toString()}` : "";
    return api.get<AdapterModel[]>(
      `/spaces/${encodeURIComponent(spaceId)}/adapters/${encodeURIComponent(type)}/models${query}`,
    );
  },
  detectModel: (spaceId: string, type: string) =>
    api.get<DetectedAdapterModel | null>(
      `/spaces/${encodeURIComponent(spaceId)}/adapters/${encodeURIComponent(type)}/detect-model`,
    ),
  testEnvironment: (
    spaceId: string,
    type: string,
    data: {
      adapterConfig: Record<string, unknown>;
      runner?: import("@outpost/shared").AgentRunnerChoice;
      aiConnection?: import("@outpost/shared").AiRuntimeConnectionBinding;
      agentId?: string;
      testCredentials?: Record<string, string>;
      environmentId?: string | null;
    },
    options?: RequestOptions,
  ) =>
    api.post<AdapterEnvironmentTestResult>(
      `/spaces/${spaceId}/adapters/${type}/test-environment`,
      data,
      options,
    ),
  getAdapterAuthSignal: (spaceId: string, type: string, environmentId?: string | null) => {
    const query = environmentId ? `?environmentId=${encodeURIComponent(environmentId)}` : "";
    return api.get<AdapterAuthSignalResponse>(
      `/spaces/${encodeURIComponent(spaceId)}/adapters/${encodeURIComponent(type)}/auth-signal${query}`,
    );
  },
  invoke: (id: string, spaceId?: string, data: AgentWakeRequest = {}) =>
    api.post<HeartbeatRun>(agentPath(id, spaceId, "/heartbeat/invoke"), data),
  wakeup: (
    id: string,
    data: AgentWakeRequest,
    spaceId?: string,
  ) => api.post<AgentWakeupResponse>(agentPath(id, spaceId, "/wakeup"), data),
  retryFailedRun: async (
    id: string,
    failedRunId: string,
    spaceId: string,
  ) => {
    const result = await api.post<
      AgentWakeupResponse | ChatFailedRunRetryResponse
    >(agentPath(id, spaceId, "/wakeup"), {
      source: "on_demand",
      triggerDetail: "manual",
      reason: "retry_failed_run",
      failedRunId,
    });
    if ("id" in result) {
      // Exact retries are idempotent: a repeated click can return a successor
      // that has already stopped. It does not mean a new attempt was queued.
      if (["failed", "timed_out", "cancelled", "interrupted"].includes(result.status)) {
        throw new Error(
          "The previous retry has already stopped. Refresh the task and retry its latest failed run.",
        );
      }
      return { runId: result.id, issueId: null };
    }
    if ("actionId" in result) {
      if (result.status === "failed" || result.status === "cancelled") {
        throw new Error(
          "This retry could not start. Open the task to review its current access and recovery state.",
        );
      }
      return { runId: result.runId, issueId: result.issueId };
    }
    throw new Error(result.message ?? "Retry was skipped.");
  },
  loginWithClaude: (id: string, spaceId?: string) =>
    api.post<ClaudeLoginResult>(agentPath(id, spaceId, "/claude-login"), {}),
  startAdapterAuthLogin: (
    spaceId: string,
    type: string,
    data: { environmentId: string; agentId?: string; ttlSeconds?: number; aiConnection?: import("@outpost/shared").AiConnectionLoginIntent },
  ) =>
    api.post<AdapterAuthSessionResponse>(
      `/spaces/${encodeURIComponent(spaceId)}/adapters/${encodeURIComponent(type)}/login-sessions`,
      data,
    ),
  // The owner response repeats the live prompt on every read while the
  // session holds an active public status, so this polling call carries the
  // same no-store request option as the active-session read below.
  getAdapterAuthLoginStatus: (spaceId: string, type: string, sessionId: string, options?: { signal?: AbortSignal }) =>
    api.get<AdapterAuthSessionOwnerResponse>(
      `/spaces/${encodeURIComponent(spaceId)}/adapters/${encodeURIComponent(type)}/login-sessions/${encodeURIComponent(sessionId)}`,
      { cache: "no-store", ...options },
    ),
  // Reads the caller's active login session for one space and adapter, with
  // no session id, so the browser rediscovers its own session after a reload
  // with no local state. A 404 means no active session for the caller.
  getActiveAdapterAuthLoginSession: (spaceId: string, type: string, options?: { signal?: AbortSignal; fresh?: boolean }) =>
    api.get<AdapterAuthSessionOwnerResponse>(
      `/spaces/${encodeURIComponent(spaceId)}/adapters/${encodeURIComponent(type)}/login-sessions/active`,
      { cache: "no-store", ...options },
    ),
  cancelAdapterAuthLogin: (spaceId: string, type: string, sessionId: string) =>
    api.post<AdapterAuthSessionOwnerResponse>(
      `/spaces/${encodeURIComponent(spaceId)}/adapters/${encodeURIComponent(type)}/login-sessions/${encodeURIComponent(sessionId)}/cancel`,
      {},
    ),
  // The Claude submitted-browser-code login uses the space-and-environment
  // setup-token routes. The route fixes the `claude_local` adapter. The start
  // response carries the panel mode; the authorization URL rides only through the
  // guarded prompt read. The completion response carries a non-secret
  // `storedSessionId` claim and no token.
  // Reads the stored Claude OAuth token status for the authenticated owner. A
  // 200 carries only the secret id and the latest version; a 404 means the owner
  // has no stored value (indistinguishable from a foreign value). The client
  // applies the stored token first and captures the version for a later
  // version-checked overwrite.
  getClaudeOAuthTokenStatus: (spaceId: string) =>
    api.get<ClaudeOAuthTokenStatusResponse>(
      `/spaces/${encodeURIComponent(spaceId)}/claude-oauth-token-status`,
    ),
  startClaudeSetupTokenLogin: (
    spaceId: string,
    data: { environmentId: string; agentId?: string; overwrite?: ClaudeSetupTokenOverwrite; aiConnection?: import("@outpost/shared").AiConnectionLoginIntent },
  ) =>
    api.post<ClaudeSetupTokenSessionOwnerResponse>(
      `/spaces/${encodeURIComponent(spaceId)}/setup-token-login-sessions`,
      { adapterType: "claude_local", ...data },
    ),
  getClaudeSetupTokenLoginStatus: (spaceId: string, sessionId: string, options?: { signal?: AbortSignal }) =>
    api.get<ClaudeSetupTokenSessionResponse>(
      `/spaces/${encodeURIComponent(spaceId)}/setup-token-login-sessions/${encodeURIComponent(sessionId)}`,
      options,
    ),
  // Reads the caller's active Claude setup-token login session, with no
  // session id, so the browser rediscovers its own session after a reload with
  // no local state. A 404 means no active session for the caller.
  getActiveClaudeSetupTokenLoginSession: (spaceId: string, options?: { signal?: AbortSignal; fresh?: boolean }) =>
    api.get<ClaudeSetupTokenSessionOwnerResponse>(
      `/spaces/${encodeURIComponent(spaceId)}/setup-token-login-sessions/active`,
      { cache: "no-store", ...options },
    ),
  getClaudeSetupTokenLoginPrompt: (spaceId: string, sessionId: string, options?: { signal?: AbortSignal }) =>
    api.get<ClaudeSetupTokenSessionPrompt>(
      `/spaces/${encodeURIComponent(spaceId)}/setup-token-login-sessions/${encodeURIComponent(sessionId)}/prompt`,
      options,
    ),
  submitClaudeSetupTokenBrowserCode: (spaceId: string, sessionId: string, browserCode: string) =>
    api.post<ClaudeSetupTokenSessionResponse>(
      `/spaces/${encodeURIComponent(spaceId)}/setup-token-login-sessions/${encodeURIComponent(sessionId)}/code`,
      { browserCode } satisfies SubmitBrowserCodeRequest,
    ),
  completeClaudeSetupTokenLogin: (spaceId: string, sessionId: string) =>
    api.post<ClaudeSetupTokenCompletionResponse>(
      `/spaces/${encodeURIComponent(spaceId)}/setup-token-login-sessions/${encodeURIComponent(sessionId)}/completion`,
      {},
    ),
  cancelClaudeSetupTokenLogin: (spaceId: string, sessionId: string) =>
    api.post<void>(
      `/spaces/${encodeURIComponent(spaceId)}/setup-token-login-sessions/${encodeURIComponent(sessionId)}/cancel`,
      {},
    ),
  availableSkills: () =>
    api.get<{ skills: AvailableSkill[] }>("/skills/available"),
};

export interface AvailableSkill {
  name: string;
  description: string;
  isOutpostManaged: boolean;
}
