import type { AggregatorAppsResponse, ArcadeDiscoverySetupInput } from "@outpost/shared/aggregator-apps";
import type { ComposioAppAccountInput, ComposioAppSetupInput, ComposioAppSetupResult, ComposioAppSnapshot, ComposioAppsResponse } from "@outpost/shared";
import type {
  ToolApplication,
  ConfigureRailwaySsh,
  RailwaySshSetup,
  ToolConnection,
  ToolConnectionInstall,
  ToolConnectionInstallSnapshot,
  ToolConnectionRemovalSummary,
  ConnectToolAppResult,
  ConnectToolApp,
  FinishToolAppResult,
  ToolCatalogEntry,
  ToolRuntimeSlot,
  ToolPolicy,
  ToolConnectionHealthCheckResult,
  ToolCatalogRefreshResult,
  ToolAccessDecision,
  ToolAccessDecisionInput,
  CreateToolPolicy,
  DuplicateToolPolicy,
  McpJsonImportPreview,
  ToolRuntimeHealthSummary,
  ToolRunDecisionLookup,
  ToolOAuthStartResult,
  ToolStdioCommandTemplate,
  ToolProfileBinding,
  ToolProfileBindingTargetType,
  ToolProfileDefaultAction,
  ToolProfileEffectiveSummary,
  ToolProfileEntry,
  ToolProfileEntryEffect,
  ToolProfileEntrySelectorType,
  ToolProfileStatus,
  ToolProfileWithDetails,
  ToolProfileConfiguration,
  ToolProfileNewToolReviewDecision,
  ToolProfileNewToolsReview,
  ToolProfileNewToolsReviewResult,
  ToolRiskLevel,
  UpdateToolPolicy,
  ReorderToolPolicies,
  AppDefinition,
  ToolAppsAttentionResponse,
  ToolConnectionReviewCounts,
  ToolConnectionActivityResponse,
  ToolConnectionLifecycleEventType,
  ToolConnectionTestAgentsResponse,
  ToolConnectionTestAgentAccessResponse,
  ToolConnectionTestCallResult,
  ToolConnectionTestCallStatus,
  ToolActionRequest,
  ToolActionRequestStatus,
  ToolActionRequestsResponse,
  ToolMcpGatewayWithTokens,
  ToolMcpGatewayTokenCreated,
  ToolMcpGatewayToken,
  CreateToolMcpGateway,
  CreateToolMcpGatewayToken,
  UpdateToolMcpGateway,
  CreateToolTrustRuleFromActionRequest,
  ToolRedactedValueSummary,
  ConnectionGrant,
  ConnectionGrantKind,
  ConnectionGrantDelegation,
  ConnectionGrantsResponse,
  ToolConnectionCreateCapabilities,
  ToolAppMetadataPreflightResult,
} from "@outpost/shared";
import { api, detachInflightGet, type RequestOptions } from "./client";

/**
 * Tools & Access API client (Phase 6, PAP-10389).
 *
 * Mirrors the controlled MCP/tool-access contracts shipped by Phases 2-5
 * (`server/src/routes/tool-access.ts` and `tool-gateway.ts`). The UI consumes
 * server-side enforcement contracts directly instead of faking tool access in
 * the browser.
 */

export type ToolApplicationsResponse = { applications: ToolApplication[] };
export type ToolConnectionsResponse = { connections: ToolConnection[] };
export type ToolCatalogResponse = { catalog: ToolCatalogEntry[] };
export type ToolRuntimeSlotsResponse = { runtimeSlots: ToolRuntimeSlot[] };
export type ToolRuntimeHealthResponse = ToolRuntimeHealthSummary;
export type ToolTrustRulesResponse = { trustRules: ToolPolicy[] };
export type ToolPoliciesResponse = { policies: ToolPolicy[] };
export type ToolProfilesResponse = { profiles: ToolProfileWithDetails[] };
export type ToolGalleryResponse = {
  apps: AppDefinition[];
  /** Server-authoritative OAuth callback URI, omitted when this deployment has no supported browser origin. */
  oauthCallbackUrl?: string;
  capabilities: ToolConnectionCreateCapabilities;
  credentialSources: {
    vercelConnect: {
      available: boolean;
      enabled: boolean;
      authentication: "workload_oidc" | "access_token" | null;
      manageUrl: string;
      reason: string | null;
    };
  };
};
export type ToolMcpGatewaysResponse = { gateways: ToolMcpGatewayWithTokens[] };
export type CloudConnectorEnrollmentStatus = {
  configured: boolean;
  status: "not_configured" | "unenrolled" | "pending" | "active" | "suspended" | "unverified";
  brokerBaseUrl: string;
  instanceId: string | null;
  environment: "development" | "test" | "staging" | "production";
  origins: string[];
  verificationUrl?: string;
  expiresAt?: string;
};
export type CreateGatewayTokenInput = Omit<CreateToolMcpGatewayToken, "expiresAt"> & {
  expiresAt?: string | Date | null;
};
/** Gateway update payload — `spaceId` is injected by the client method. */
export type UpdateGatewayInput = Omit<UpdateToolMcpGateway, "spaceId">;
export type ReviewNewToolsInput = {
  decisions: Array<{ catalogEntryId: string; decision: ToolProfileNewToolReviewDecision }>;
};

export type StdioTemplateSummary = ToolStdioCommandTemplate;
export type StdioTemplatesResponse = { templates: StdioTemplateSummary[] };

/** Admin "run your own" command-template create input (M8b, PAP-10862). */
export interface CreateStdioTemplateInput {
  templateId: string;
  name: string;
  description?: string | null;
  command: string;
  args?: string[];
  envKeys?: string[];
}

export interface CreateToolApplicationInput {
  name: string;
  description?: string | null;
  type: ToolApplication["type"];
  pluginId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface UpdateToolApplicationInput {
  name?: string;
  description?: string | null;
  status?: ToolApplication["status"];
  metadata?: Record<string, unknown> | null;
}

export interface CreateToolConnectionInput {
  applicationId?: string;
  applicationName?: string;
  name: string;
  transport: NonNullable<ToolConnection["transport"]>;
  status?: ToolConnection["status"];
  config?: Record<string, unknown>;
  credentialRefs?: ToolConnection["credentialRefs"];
  enabled?: boolean;
}

export interface UpdateToolConnectionInput {
  agentInstructions?: import("@outpost/shared").ConnectionAgentInstructions | null;
  name?: string;
  status?: ToolConnection["status"];
  config?: Record<string, unknown>;
  transportConfig?: Record<string, unknown>;
  credentialRefs?: ToolConnection["credentialRefs"];
  enabled?: boolean;
}

export interface ToolProfileEntryInput {
  selectorType: ToolProfileEntrySelectorType;
  effect?: ToolProfileEntryEffect;
  applicationId?: string | null;
  connectionId?: string | null;
  catalogEntryId?: string | null;
  toolName?: string | null;
  riskLevel?: ToolRiskLevel | null;
  conditions?: Record<string, unknown> | null;
}

export interface CreateToolProfileInput {
  profileKey: string;
  name: string;
  description?: string | null;
  status?: ToolProfileStatus;
  defaultAction?: ToolProfileDefaultAction;
  metadata?: Record<string, unknown> | null;
  entries?: ToolProfileEntryInput[];
}

export interface UpdateToolProfileInput {
  profileKey?: string;
  name?: string;
  description?: string | null;
  status?: ToolProfileStatus;
  defaultAction?: ToolProfileDefaultAction;
  metadata?: Record<string, unknown> | null;
  entries?: ToolProfileEntryInput[];
}

export interface ToolProfileBindingInput {
  targetType: ToolProfileBindingTargetType;
  targetId: string;
  priority?: number;
  metadata?: Record<string, unknown> | null;
}

export type UnbindToolProfileInput = Pick<ToolProfileBindingInput, "targetType" | "targetId">;

/** Redacted tool-gateway audit row (subset of `activity_log`). */
export interface ToolGatewayAuditRow {
  id: string;
  spaceId: string;
  action: string;
  actorType: string | null;
  actorId: string | null;
  entityType: string | null;
  entityId: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

/** Normalized outcome for the humanized Activity feed. */
export type ToolAuditOutcome =
  | "allowed"
  | "blocked"
  | "asked_first"
  | "waiting"
  | "failed"
  | "unknown";

/**
 * Audit row enriched server-side with humanized display names and a normalized
 * outcome — the shape returned by `GET /tool-gateway/audit`.
 */
export interface ToolGatewayActivityEvent extends ToolGatewayAuditRow {
  agentId: string | null;
  runId: string | null;
  applicationId: string | null;
  connectionId: string | null;
  agentDisplayName: string | null;
  actorDisplayName?: string | null;
  appDisplayName: string | null;
  applicationDisplayName: string | null;
  connectionDisplayName: string | null;
  toolDisplayName: string | null;
  lifecycleType?: ToolConnectionLifecycleEventType | null;
  normalizedOutcome: ToolAuditOutcome;
  invocation: {
    id: string;
    toolName: string;
    status: string;
    policyDecision: string | null;
    approvalState: string;
    argumentsSummary: ToolRedactedValueSummary | null;
    resultSummary: ToolRedactedValueSummary | null;
    resultSizeBytes: number | null;
    errorCode: string | null;
    errorMessage: string | null;
    startedAt: string | null;
    completedAt: string | null;
  } | null;
}

export type ToolGatewayActivityResponse = {
  events: ToolGatewayActivityEvent[];
  nextCursor: string | null;
};

export type ToolAuditWindow = "1h" | "24h" | "7d" | "30d" | "all";

export interface ListActivityParams {
  gateway?: string | null;
  app?: string | null;
  agent?: string | null;
  outcome?: string | null;
  window?: ToolAuditWindow;
  search?: string | null;
  limit?: number;
  cursor?: string | null;
}

export type ToolPolicyTestResponse = {
  decision: ToolAccessDecision;
  auditEvent: unknown | null;
};

export const toolsApi = {
  getCloudConnectorEnrollment: () =>
    api.get<CloudConnectorEnrollmentStatus>("/tools/oauth/cloud-connector/enrollment"),
  startCloudConnectorEnrollment: (spaceId: string, label?: string, returnTo?: string) =>
    api.post<CloudConnectorEnrollmentStatus>("/tools/oauth/cloud-connector/enrollment", { spaceId, label, returnTo }),
  // --- Applications ---
  listGallery: (spaceId: string) =>
    api.get<ToolGalleryResponse>(`/spaces/${spaceId}/tools/gallery`),
  preflightAppMetadata: (spaceId: string, galleryKey: string, methodKey?: string | null) => {
    const query = methodKey ? `?methodKey=${encodeURIComponent(methodKey)}` : "";
    return api.get<ToolAppMetadataPreflightResult>(
      `/spaces/${spaceId}/tools/apps/${encodeURIComponent(galleryKey)}/preflight${query}`,
    );
  },
  connectApp: (spaceId: string, input: ConnectToolApp) =>
    api.post<ConnectToolAppResult>(`/spaces/${spaceId}/tools/apps/connect`, input),
  startOAuth: (
    connectionId: string,
    input: {
      asCurrentUser?: boolean;
      asAgentId?: string;
      interactionId?: string;
      workspaceServices?: import("@outpost/shared").GoogleWorkspaceServiceSelection;
    } = {},
  ) =>
    api.post<ToolOAuthStartResult>(`/tools/oauth/${connectionId}/start`, input),
  finalizeOAuthAccess: (
    spaceId: string,
    connectionId: string,
    input: { grantKind: ConnectionGrantKind },
  ) =>
    api.post<FinishToolAppResult>(
      `/spaces/${spaceId}/tools/apps/${connectionId}/finalize-oauth-access`,
      input,
    ),
  finishApp: (spaceId: string, connectionId: string, input: {
    enabledCatalogEntryIds: string[];
    askFirstCatalogEntryIds: string[];
    reviewedCatalogEntryIds?: string[];
    agentInstructions?: import("@outpost/shared").ConnectionAgentInstructions | null;
    access: "all_agents" | { agentIds: string[] };
  }) =>
    api.post<FinishToolAppResult>(
      `/spaces/${spaceId}/tools/apps/${connectionId}/finish`,
      input,
    ),
  getConnectionReviewCounts: (connectionId: string) =>
    api.get<ToolConnectionReviewCounts>(`/tool-connections/${connectionId}/review-counts`),
  listAppsAttention: (spaceId: string) =>
    api.get<ToolAppsAttentionResponse>(`/spaces/${spaceId}/tools/apps/attention`),
  listApplications: (spaceId: string, options?: RequestOptions) =>
    options ? api.get<ToolApplicationsResponse>(`/spaces/${spaceId}/tools/applications`, options)
      : api.get<ToolApplicationsResponse>(`/spaces/${spaceId}/tools/applications`),
  createApplication: (spaceId: string, input: CreateToolApplicationInput) =>
    api.post<ToolApplication>(`/spaces/${spaceId}/tools/applications`, input),
  updateApplication: (applicationId: string, input: UpdateToolApplicationInput) =>
    api.patch<ToolApplication>(`/tool-applications/${applicationId}`, input),
  deleteApplication: (applicationId: string) =>
    api.delete<ToolApplication>(`/tool-applications/${applicationId}`),

  // --- Connections ---
  listConnections: (spaceId: string, options?: RequestOptions) =>
    options ? api.get<ToolConnectionsResponse>(`/spaces/${spaceId}/tools/connections`, options)
      : api.get<ToolConnectionsResponse>(`/spaces/${spaceId}/tools/connections`),
  getConnection: (connectionId: string) =>
    api.get<ToolConnection>(`/tool-connections/${connectionId}`),
  // --- Installs (Phase 3b, PAP-13618): which agents carry this connection's
  // tools in their runtime context. `installed ⊆ permitted`; the server
  // auto-extends access (adds profile bindings) for any newly-installed target.
  getConnectionInstalls: (connectionId: string) =>
    api.get<{ connectionId: string; installs: ToolConnectionInstall[] }>(
      `/tool-connections/${connectionId}/installs`,
    ),
  putConnectionInstalls: (
    connectionId: string,
    installs: Array<{ targetType: "space" | "agent"; targetId: string }>,
  ) =>
    api.put<ToolConnectionInstallSnapshot>(
      `/tool-connections/${connectionId}/installs`,
      { installs },
    ),
  // --- Identity grants (PAP-17835): who a connection acts as. The response
  // carries server-computed capabilities and the audience member directory, so
  // the UI never rebuilds the permission matrix from `membershipRole`.
  listConnectionGrants: (connectionId: string, options?: RequestOptions) =>
    api.get<ConnectionGrantsResponse>(`/tool-connections/${connectionId}/grants`, { timeoutMs: 15_000, ...options }),
  createConnectionGrantDelegation: (connectionId: string, grantId: string, agentId: string) =>
    api.post<ConnectionGrantDelegation>(
      `/tool-connections/${connectionId}/grants/${grantId}/delegations`,
      { agentId },
    ),
  revokeConnectionGrantDelegation: (
    connectionId: string,
    grantId: string,
    delegationId: string,
  ) => api.delete<ConnectionGrantDelegation>(
    `/tool-connections/${connectionId}/grants/${grantId}/delegations/${delegationId}`,
  ),
  revokeConnectionGrant: (connectionId: string, grantId: string) =>
    api.delete<ConnectionGrant>(`/tool-connections/${connectionId}/grants/${grantId}`),
  // An empty `memberUserIds` is the canonical "all organization members".
  // Replacement is atomic server-side, so this never partially widens access.
  replaceConnectionGrantMembers: (connectionId: string, grantId: string, memberUserIds: string[]) =>
    api.put<ConnectionGrant>(
      `/tool-connections/${connectionId}/grants/${grantId}/members`,
      { memberUserIds },
    ),
  /**
   * Start the signed-in user's own personal authorization. `subjectUserId` must
   * be the caller: the server refuses any other subject, so there is no way to
   * initiate consent on someone else's behalf.
   */
  startPersonalAuthorization: (
    spaceId: string,
    connectionId: string,
    input: { subjectUserId: string; scopes?: string[]; returnTo?: string },
  ) =>
    api.post<{ url: string; handoff?: ToolOAuthStartResult["handoff"] }>(
      `/spaces/${spaceId}/tools/connections/${connectionId}/start-authorization`,
      input,
    ),
  createConnection: (spaceId: string, input: CreateToolConnectionInput) =>
    api.post<ToolConnection>(`/spaces/${spaceId}/tools/connections`, input),
  updateConnection: (connectionId: string, input: UpdateToolConnectionInput) =>
    api.patch<ToolConnection>(`/tool-connections/${connectionId}`, input),
  configureRailwaySsh: (connectionId: string, input: ConfigureRailwaySsh) =>
    api.post<RailwaySshSetup | null>(`/tool-connections/${connectionId}/railway/ssh`, input),
  // Removal is a credential-revoking teardown (PAP-17119), so the response
  // carries the cleanup receipt alongside the archived connection.
  archiveConnection: (connectionId: string) =>
    api.delete<ToolConnection & { removal: ToolConnectionRemovalSummary }>(
      `/tool-connections/${connectionId}`,
    ),
  checkConnectionHealth: (connectionId: string) =>
    api.post<ToolConnectionHealthCheckResult>(`/tool-connections/${connectionId}/health-check`, {}),
  reconnectConnection: (connectionId: string, credentialValues: Record<string, string>) =>
    api.post<ToolConnectionHealthCheckResult>(`/tool-connections/${connectionId}/reconnect`, {
      credentialValues,
    }),
  refreshCatalog: (connectionId: string) =>
    api.post<ToolCatalogRefreshResult>(`/tool-connections/${connectionId}/catalog/refresh`, {}),
  listCatalog: (connectionId: string) =>
    api.get<ToolCatalogResponse>(`/tool-connections/${connectionId}/catalog`),
  listConnectionActivity: (connectionId: string, limit = 20) =>
    api.get<ToolConnectionActivityResponse>(
      `/tool-connections/${connectionId}/activity?limit=${limit}`,
    ),
  listTestAgents: (connectionId: string) =>
    api.get<ToolConnectionTestAgentsResponse>(
      `/tool-connections/${connectionId}/test-agents`,
    ),
  getTestAgentAccess: (connectionId: string, agentId: string) =>
    api.get<ToolConnectionTestAgentAccessResponse>(
      `/tool-connections/${connectionId}/test-agents/${agentId}/access`,
    ),
  setupComposioApp: (connectionId: string, toolkit: string, input: ComposioAppSetupInput) =>
    api.post<ComposioAppSetupResult>(`/tool-connections/${connectionId}/composio/apps/${encodeURIComponent(toolkit)}/setup`, input),
  listAggregatorApps: (connectionId: string) => {
    const path = `/tool-connections/${connectionId}/aggregator/apps`;
    // React Query already deduplicates within a viewing-user key. Path-only
    // request coalescing could hand a previous user's in-flight response to a new account.
    detachInflightGet(path);
    return api.get<AggregatorAppsResponse>(path, { cache: "no-store" });
  },
  syncAggregatorApps: (connectionId: string, force = false) => api.post<AggregatorAppsResponse>(`/tool-connections/${connectionId}/aggregator/apps/sync`, { force }),
  refreshAggregatorApps: (connectionId: string, toolkits: string[] = []) => api.post<AggregatorAppsResponse>(`/tool-connections/${connectionId}/aggregator/apps/refresh`, { toolkits }),
  configureArcadeDiscovery: (connectionId: string, input: ArcadeDiscoverySetupInput) => api.put<AggregatorAppsResponse>(`/tool-connections/${connectionId}/aggregator/discovery`, input),
  listComposioApps: (connectionId: string) => api.get<ComposioAppsResponse>(`/tool-connections/${connectionId}/composio/apps`),
  syncComposioApps: (connectionId: string, force = false) => api.post<ComposioAppsResponse>(`/tool-connections/${connectionId}/composio/apps/sync`, { force }),
  refreshComposioApps: (connectionId: string, toolkits: string[]) => api.post<ComposioAppsResponse>(`/tool-connections/${connectionId}/composio/apps/refresh`, { toolkits }),
  manageComposioAppAccount: (connectionId: string, toolkit: string, input: ComposioAppAccountInput) =>
    api.post<ComposioAppSetupResult & { apps: ComposioAppSnapshot[] }>(`/tool-connections/${connectionId}/composio/apps/${encodeURIComponent(toolkit)}/accounts`, input),
  runTestCall: (
    connectionId: string,
    input: { agentId: string; toolName: string; parameters?: Record<string, unknown> },
  ) =>
    api.post<ToolConnectionTestCallResult>(
      `/tool-connections/${connectionId}/test-calls`,
      input,
    ),
  getTestCallStatus: (connectionId: string, actionRequestId: string) =>
    api.get<ToolConnectionTestCallStatus>(
      `/tool-connections/${connectionId}/test-calls/${actionRequestId}`,
    ),
  importMcpJson: (spaceId: string, body: { mcpJson: unknown }) =>
    api.post<McpJsonImportPreview>(`/spaces/${spaceId}/tools/mcp/import-json`, body),
  listStdioTemplates: (spaceId: string) =>
    api.get<StdioTemplatesResponse>(`/spaces/${spaceId}/tools/stdio-templates`),
  createStdioTemplate: (spaceId: string, input: CreateStdioTemplateInput) =>
    api.post<StdioTemplateSummary>(`/spaces/${spaceId}/tools/stdio-templates`, input),
  disableStdioTemplate: (spaceId: string, templateId: string, reason?: string | null) =>
    api.post<StdioTemplateSummary>(
      `/spaces/${spaceId}/tools/stdio-templates/${encodeURIComponent(templateId)}/disable`,
      { reason: reason ?? null },
    ),

  // --- Profiles ---
  listConnectionProfileConfiguration: (connectionId: string) =>
    api.get<{ profiles: ToolProfileConfiguration[] }>(`/tool-connections/${connectionId}/profile-configuration`),
  listProfiles: (spaceId: string) =>
    api.get<ToolProfilesResponse>(`/spaces/${spaceId}/tools/profiles`),
  getProfileNewTools: (profileId: string) =>
    api.get<ToolProfileNewToolsReview>(`/tool-profiles/${profileId}/new-tools`),
  reviewProfileNewTools: (profileId: string, input: ReviewNewToolsInput) =>
    api.post<ToolProfileNewToolsReviewResult>(`/tool-profiles/${profileId}/new-tools/review`, input),
  createProfile: (spaceId: string, input: CreateToolProfileInput) =>
    api.post<ToolProfileWithDetails>(`/spaces/${spaceId}/tools/profiles`, input),
  updateProfile: (profileId: string, input: UpdateToolProfileInput) =>
    api.patch<ToolProfileWithDetails>(`/tool-profiles/${profileId}`, input),
  duplicateProfile: (
    profileId: string,
    input: { name: string; includeAssignments?: boolean },
  ) => api.post<ToolProfileWithDetails>(`/tool-profiles/${profileId}/duplicate`, input),
  deleteProfile: (
    profileId: string,
    input: { force?: boolean; reassignToProfileId?: string } = {},
  ) => api.delete<{ deleted: true }>(`/tool-profiles/${profileId}`, input),
  addProfileEntry: (profileId: string, input: ToolProfileEntryInput) =>
    api.post<ToolProfileEntry>(`/tool-profiles/${profileId}/entries`, input),
  updateProfileEntry: (entryId: string, input: Partial<ToolProfileEntryInput>) =>
    api.patch<ToolProfileEntry>(`/tool-profile-entries/${entryId}`, input),
  deleteProfileEntry: (entryId: string) =>
    api.delete<ToolProfileEntry>(`/tool-profile-entries/${entryId}`),
  bindProfile: (spaceId: string, profileId: string, input: ToolProfileBindingInput) =>
    api.post<ToolProfileBinding>(`/spaces/${spaceId}/tools/profiles/${profileId}/bind`, input),
  unbindProfile: (spaceId: string, profileId: string, input: UnbindToolProfileInput) =>
    api.post<{ unbound: number }>(`/spaces/${spaceId}/tools/profiles/${profileId}/unbind`, input),
  getEffectiveProfilesForAgent: (spaceId: string, agentId: string) =>
    api.get<ToolProfileEffectiveSummary>(
      `/spaces/${spaceId}/tools/profiles/effective/agents/${encodeURIComponent(agentId)}`,
    ),

  // --- Runtime ---
  listRuntimeSlots: (spaceId: string) =>
    api.get<ToolRuntimeSlotsResponse>(`/spaces/${spaceId}/tools/runtime-slots`),
  stopRuntimeSlot: (spaceId: string, slotId: string) =>
    api.post<ToolRuntimeSlot>(`/spaces/${spaceId}/tools/runtime-slots/${slotId}/stop`, {}),
  restartRuntimeSlot: (spaceId: string, slotId: string) =>
    api.post<ToolRuntimeSlot>(`/spaces/${spaceId}/tools/runtime-slots/${slotId}/restart`, {}),
  getRuntimeHealth: (spaceId: string) =>
    api.get<ToolRuntimeHealthResponse>(`/spaces/${spaceId}/tools/runtime-health`),
  getRunDecisionLookup: (spaceId: string, runId: string) =>
    api.get<ToolRunDecisionLookup>(`/spaces/${spaceId}/tools/runs/${runId}/decisions`),
  listLiveRuntimeSlots: (spaceId: string) =>
    api.get<ToolRuntimeSlot[]>(`/tool-gateway/runtime-slots?spaceId=${encodeURIComponent(spaceId)}`),

  // --- Policies (trust rules + decision simulator) ---
  listPolicies: (spaceId: string) =>
    api.get<ToolPoliciesResponse>(`/spaces/${spaceId}/tools/policies`),
  createPolicy: (spaceId: string, input: CreateToolPolicy) =>
    api.post<ToolPolicy>(`/spaces/${spaceId}/tools/policies`, input),
  reorderPolicies: (spaceId: string, input: ReorderToolPolicies) =>
    api.post<ToolPoliciesResponse>(`/spaces/${spaceId}/tools/policies/reorder`, input),
  duplicatePolicy: (spaceId: string, policyId: string, input: DuplicateToolPolicy = {}) =>
    api.post<ToolPolicy>(`/spaces/${spaceId}/tools/policies/${policyId}/duplicate`, input),
  updatePolicy: (spaceId: string, policyId: string, input: UpdateToolPolicy) =>
    api.patch<ToolPolicy>(`/spaces/${spaceId}/tools/policies/${policyId}`, input),
  deletePolicy: (spaceId: string, policyId: string) =>
    api.delete<ToolPolicy>(`/spaces/${spaceId}/tools/policies/${policyId}`),
  listTrustRules: (spaceId: string) =>
    api.get<ToolTrustRulesResponse>(`/spaces/${spaceId}/tools/trust-rules`),
  revokeTrustRule: (spaceId: string, policyId: string, reason?: string | null) =>
    api.post<ToolPolicy>(`/spaces/${spaceId}/tools/trust-rules/${policyId}/revoke`, {
      reason: reason ?? null,
    }),
  testPolicy: (spaceId: string, input: Omit<ToolAccessDecisionInput, "spaceId">) =>
    api.post<ToolPolicyTestResponse>(`/spaces/${spaceId}/tools/policy/test`, input),

  // --- Review queue (Ask first) ---
  listActionRequests: (spaceId: string, status: ToolActionRequestStatus = "pending") =>
    api.get<ToolActionRequestsResponse>(
      `/spaces/${spaceId}/tools/action-requests?status=${encodeURIComponent(status)}`,
    ),
  approveActionRequest: (spaceId: string, actionRequestId: string, rememberAction = false) =>
    api.post<ToolActionRequest>(`/tool-gateway/action-requests/${actionRequestId}/approve`, { spaceId, rememberAction }),
  declineActionRequest: (spaceId: string, actionRequestId: string, reason?: string) =>
    api.post<ToolActionRequest>(`/tool-gateway/action-requests/${actionRequestId}/decline`, { spaceId, reason }),
  createTrustRuleFromActionRequest: (
    spaceId: string,
    actionRequestId: string,
    input: CreateToolTrustRuleFromActionRequest = {},
  ) =>
    api.post<ToolPolicy>(
      `/spaces/${spaceId}/tools/action-requests/${actionRequestId}/trust-rule`,
      input,
    ),

  // --- Named MCP gateways ---
  listGateways: (spaceId: string) =>
    api.get<ToolMcpGatewaysResponse>(`/spaces/${spaceId}/tools/gateways`),
  createGateway: (spaceId: string, input: CreateToolMcpGateway) =>
    api.post<ToolMcpGatewayWithTokens>(`/spaces/${spaceId}/tools/gateways`, input),
  updateGateway: (spaceId: string, gatewayId: string, input: UpdateGatewayInput) =>
    api.patch<ToolMcpGatewayWithTokens>(`/tool-gateway/gateways/${gatewayId}`, { ...input, spaceId }),
  createGatewayToken: (spaceId: string, gatewayId: string, input: CreateGatewayTokenInput) =>
    api.post<ToolMcpGatewayTokenCreated>(`/tool-gateway/gateways/${gatewayId}/tokens`, { ...input, spaceId }),
  revealGatewayToken: (spaceId: string, tokenId: string) =>
    api.post<ToolMcpGatewayTokenCreated>(`/tool-gateway/gateway-tokens/${tokenId}/reveal`, { spaceId }),
  revokeGatewayToken: (spaceId: string, tokenId: string) =>
    api.post<ToolMcpGatewayToken>(`/tool-gateway/gateway-tokens/${tokenId}/revoke`, { spaceId }),

  // --- Audit / Activity ---
  /**
   * Humanized Activity feed with server-side filters and cursor pagination.
   * Returns `{ events, nextCursor }`.
   */
  listActivity: (spaceId: string, params: ListActivityParams = {}) => {
    const search = new URLSearchParams({ spaceId });
    if (params.gateway) search.set("gateway", params.gateway);
    if (params.app) search.set("app", params.app);
    if (params.agent) search.set("agent", params.agent);
    if (params.outcome) search.set("outcome", params.outcome);
    // Omitting the window is the API's canonical all-time request. This also
    // keeps the page usable during a rolling restart against an older server
    // that does not recognize the newer explicit `all` value.
    if (params.window && params.window !== "all") search.set("window", params.window);
    if (params.search) search.set("search", params.search);
    if (params.cursor) search.set("cursor", params.cursor);
    search.set("limit", String(params.limit ?? 50));
    return api.get<ToolGatewayActivityResponse>(`/tool-gateway/audit?${search.toString()}`);
  },
  /** Flat audit sample (no pagination) — used by derived counters/banners. */
  listAudit: (spaceId: string, limit = 100) =>
    api
      .get<ToolGatewayActivityResponse>(
        `/tool-gateway/audit?spaceId=${encodeURIComponent(spaceId)}&window=30d&limit=${Math.min(limit, 100)}`,
      )
      .then((res) => res.events),
};
