export const queryKeys = {
  linkPreview: (spaceId: string, userId: string | null, url: string) =>
    ["link-preview", spaceId, userId, url] as const,
  workspacePreferences: {
    mine: (userId: string | null) => ["workspace-preferences", userId] as const,
  },
  agentCommentary: {
    list: (spaceId: string, filters: object) => ["agent-commentary", spaceId, "list", filters] as const,
    detail: (spaceId: string, id: string | null) => ["agent-commentary", spaceId, "detail", id] as const,
  },
  skillSources: {
    projects: (spaceId: string) => ['project-skill-repositories', spaceId] as const,
    preview: (spaceId: string, repositoryUrl: string, connectionId: string | null, commitSha: string | null, skillPath: string, filePath: string) => ['skill-sources', spaceId, 'preview', repositoryUrl, connectionId, commitSha, skillPath, filePath] as const,
    all: (spaceId: string) => ["skill-sources", spaceId] as const,
    repositories: (spaceId: string) => ["skill-source-repositories", spaceId] as const,
  },
  agentChats: {
    list: (spaceId: string | null, userId?: string | null) =>
      ["agent-chats", spaceId, userId] as const,
    detail: (spaceId: string | null, userId: string | null, agentId: string | undefined) =>
      ["agent-chat", spaceId, userId, agentId] as const,
  },
  spaces: {
    /**
     * Prefix for everything space-shaped. Matches the list, details and stats
     * below, so an `invalidateQueries` against it still reaches all of them.
     * Not a cache entry of its own — the list lives under `list()`.
     */
    all: ["spaces"] as const,
    /**
     * The space list, scoped to the account it was fetched for. Which
     * spaces you belong to is an answer about *you*, and a single shared
     * entry made it look like an answer about the app: for 30 seconds after an
     * account change the previous account's list was served to anyone who
     * asked. A different account is a different entry, so there is nothing to
     * mistake. `null` is the signed-out/local_trusted key.
     */
    list: (userId: string | null) =>
      ["spaces", "list", userId ?? "anonymous"] as const,
    directory: (userId: string | null) =>
      ["spaces", "directory", userId ?? "anonymous"] as const,
    detail: (id: string) => ["spaces", id] as const,
    stats: ["spaces", "stats"] as const,
    exportFidelity: (spaceId: string) =>
      ["spaces", spaceId, "export-fidelity"] as const,
  },
  apps: {
    gallery: (spaceId: string) => ["apps", spaceId, "gallery"] as const,
    attention: (spaceId: string) => ["apps", spaceId, "attention"] as const,
    connectionReviewCounts: (spaceId: string, connectionId: string) =>
      ["apps", spaceId, "attention", "connection", connectionId, "review-counts"] as const,
  },
  chatEndpoints: {
    list: (spaceId: string) => ["chat-endpoints", spaceId] as const,
    detail: (endpointId: string) => ["chat-endpoints", "detail", endpointId] as const,
    resources: (endpointId: string) => ["chat-endpoints", endpointId, "resources"] as const,
    principals: (endpointId: string) => ["chat-endpoints", endpointId, "principals"] as const,
    conversations: (endpointId: string) => ["chat-endpoints", endpointId, "conversations"] as const,
    activity: (endpointId: string) => ["chat-endpoints", endpointId, "activity"] as const,
  },
  tools: {
    aggregatorApps: (connectionId: string, userId: string | null) => ["tools", "aggregator-apps", connectionId, userId] as const,
    composioApps: (connectionId: string) => ["tools", "composio-apps", connectionId] as const,
    applications: (spaceId: string) =>
      ["tools", spaceId, "applications"] as const,
    connections: (spaceId: string) =>
      ["tools", spaceId, "connections"] as const,
    connection: (connectionId: string) =>
      ["tools", "connection", connectionId] as const,
    connectionInstalls: (connectionId: string) =>
      ["tools", "connection", connectionId, "installs"] as const,
    connectionGrants: (connectionId: string) =>
      ["tools", "connection", connectionId, "grants"] as const,
    catalog: (connectionId: string) => ["tools", "connection", connectionId, "catalog"] as const,
    connectionActivity: (connectionId: string) =>
      ["tools", "connection", connectionId, "activity"] as const,
    testAgents: (connectionId: string) =>
      ["tools", "connection", connectionId, "test-agents"] as const,
    testAgentAccesses: () => ["tools", "test-agent-access"] as const,
    testAgentAccessesForConnection: (connectionId: string) =>
      ["tools", "test-agent-access", connectionId] as const,
    testAgentAccess: (connectionId: string, agentId: string) =>
      ["tools", "test-agent-access", connectionId, agentId] as const,
    testCallStatus: (connectionId: string, actionRequestId: string) =>
      [
        "tools",
        "connection",
        connectionId,
        "test-calls",
        actionRequestId,
      ] as const,
    actionRequests: (spaceId: string, status: string) =>
      ["tools", spaceId, "action-requests", status] as const,
    gateways: (spaceId: string) => ["tools", "gateways", spaceId] as const,
    connectionProfileConfiguration: (spaceId: string, connectionId: string) =>
      ["tools", spaceId, "profiles", "connection-configuration", connectionId] as const,
    profiles: (spaceId: string) => ["tools", spaceId, "profiles"] as const,
    profileNewTools: (profileId: string) =>
      ["tools", "profiles", profileId, "new-tools"] as const,
    effectiveProfilesForAgent: (spaceId: string, agentId: string) =>
      ["tools", spaceId, "profiles", "effective", "agent", agentId] as const,
    stdioTemplates: (spaceId: string) =>
      ["tools", spaceId, "stdio-templates"] as const,
    runtimeSlots: (spaceId: string) =>
      ["tools", spaceId, "runtime-slots"] as const,
    runtimeHealth: (spaceId: string) =>
      ["tools", spaceId, "runtime-health"] as const,
    runDecisions: (spaceId: string, runId: string) =>
      ["tools", spaceId, "runs", runId, "decisions"] as const,
    liveRuntimeSlots: (spaceId: string) =>
      ["tools", spaceId, "runtime-slots", "live"] as const,
    policies: (spaceId: string) => ["tools", spaceId, "policies"] as const,
    trustRules: (spaceId: string) =>
      ["tools", spaceId, "trust-rules"] as const,
    audit: (spaceId: string, limit: number) =>
      ["tools", spaceId, "audit", limit] as const,
    activity: (
      spaceId: string,
      filters: { gateway?: string; app?: string; agent?: string; outcome?: string; window?: string; search?: string },
    ) =>
      [
        "tools",
        spaceId,
        "activity",
        filters.gateway ?? "__all",
        filters.app ?? "__all",
        filters.agent ?? "__all",
        filters.outcome ?? "__all",
        filters.window ?? "24h",
        filters.search ?? "",
      ] as const,
  },
  audit: {
    runs: (spaceId: string, agentId?: string | null) =>
      ["audit", spaceId, "runs", agentId ?? "__all"] as const,
    agentActions: (
      spaceId: string,
      filters: {
        actorScope?: "agents" | "all" | null;
        agentId?: string | null;
        responsibleUserId?: string | null;
        runId?: string | null;
        entityType?: string | null;
        entityId?: string | null;
        action?: string | null;
        from?: string | null;
        to?: string | null;
        actorType?: string | null;
      },
    ) =>
      [
        "audit",
        spaceId,
        "agent-actions",
        filters.actorScope ?? "agents",
        filters.agentId ?? "__all",
        filters.responsibleUserId ?? "__all",
        filters.runId ?? "__all",
        filters.entityType ?? "__all",
        filters.entityId ?? "__all",
        filters.action ?? "__all",
        filters.actorType ?? "__all",
        filters.from ?? "",
        filters.to ?? "",
      ] as const,
  },
  smokeLab: {
    services: (spaceId: string) =>
      ["smoke-lab", spaceId, "services"] as const,
    runs: (spaceId: string) => ["smoke-lab", spaceId, "runs"] as const,
    run: (spaceId: string, runId: string) =>
      ["smoke-lab", spaceId, "runs", runId] as const,
  },
  spaceSkills: {
    list: (spaceId: string) => ["outpost-skills", spaceId] as const,
    listRecent: (spaceId: string) =>
      ["outpost-skills", spaceId, "recent-updated"] as const,
    detail: (spaceId: string, skillId: string) =>
      ["outpost-skills", spaceId, skillId] as const,
    versions: (spaceId: string, skillId: string) =>
      ["outpost-skills", spaceId, skillId, "versions"] as const,
    comments: (spaceId: string, skillId: string) =>
      ["outpost-skills", spaceId, skillId, "comments"] as const,
    updateStatus: (spaceId: string, skillId: string) =>
      ["outpost-skills", spaceId, skillId, "update-status"] as const,
    forkPrecheck: (spaceId: string, skillId: string) =>
      ["outpost-skills", spaceId, skillId, "fork-precheck"] as const,
    file: (spaceId: string, skillId: string, relativePath: string) =>
      ["outpost-skills", spaceId, skillId, "file", relativePath] as const,
    testInputs: (spaceId: string, skillId: string) =>
      ["outpost-skills", spaceId, skillId, "test-inputs"] as const,
    testRunTemplates: (spaceId: string) =>
      ["outpost-skills", spaceId, "test-run-templates"] as const,
    testRuns: (spaceId: string, skillId: string, inputId?: string | null) =>
      [
        "outpost-skills",
        spaceId,
        skillId,
        "test-runs",
        inputId ?? "__all-inputs__",
      ] as const,
    testRunDetail: (spaceId: string, skillId: string, runId: string) =>
      ["outpost-skills", spaceId, skillId, "test-run", runId] as const,
  },
  agents: {
    projectAccess: (id: string) => ["agents", "detail", id, "project-access"] as const,
    identity: (id: string) => ["agents", "identity", id] as const,
    list: (spaceId: string) => ["agents", spaceId] as const,
    detail: (id: string) => ["agents", "detail", id] as const,
    runtimeState: (id: string) => ["agents", "runtime-state", id] as const,
    taskSessions: (id: string) => ["agents", "task-sessions", id] as const,
    skills: (id: string) => ["agents", "skills", id] as const,
    instructionsBundle: (id: string) =>
      ["agents", "instructions-bundle", id] as const,
    instructionCandidates: (id: string) =>
      ["agents", "instruction-candidates", id] as const,
    instructionsFile: (id: string, relativePath: string) =>
      ["agents", "instructions-bundle", id, "file", relativePath] as const,
    keys: (agentId: string) => ["agents", "keys", agentId] as const,
    configRevisions: (agentId: string) =>
      ["agents", "config-revisions", agentId] as const,
    adapterModels: (
      spaceId: string,
      adapterType: string,
      environmentId?: string | null,
      provider?: string,
    ) =>
      [
        "agents",
        spaceId,
        "adapter-models",
        adapterType,
        environmentId ?? null,
        provider ?? null,
      ] as const,
    detectModel: (spaceId: string, adapterType: string) =>
      ["agents", spaceId, "detect-model", adapterType] as const,
    authSignal: (spaceId: string, adapterType: string, environmentId?: string | null) =>
      ["agents", spaceId, "auth-signal", adapterType, environmentId ?? null] as const,
    activeLoginSession: (spaceId: string, adapterType: string) =>
      ["agents", spaceId, "active-login-session", adapterType] as const,
  },
  issues: {
    recoveryActions: (id: string, actionId: string | null, runId: string | null) =>
      ["issues", id, "recovery-actions", actionId, runId] as const,
    allRecoveryActions: (id: string) => ["issues", id, "recovery-actions"] as const,
    list: (spaceId: string) => ["issues", spaceId] as const,
    onboardingFirstTask: (spaceId: string) =>
      ["issues", spaceId, "onboarding-first-task"] as const,
    mentionPool: (spaceId: string) =>
      ["issues", spaceId, "mention-pool"] as const,
    search: (
      spaceId: string,
      q: string,
      projectId?: string,
      limit?: number,
    ) =>
      [
        "issues",
        spaceId,
        "search",
        q,
        projectId ?? "__all-projects__",
        limit ?? "__no-limit__",
      ] as const,
    listAssignedToMe: (spaceId: string) =>
      ["issues", spaceId, "assigned-to-me"] as const,
    listMineByMe: (spaceId: string) =>
      ["issues", spaceId, "mine-by-me"] as const,
    listTouchedByMe: (spaceId: string) =>
      ["issues", spaceId, "touched-by-me"] as const,
    listUnreadTouchedByMe: (spaceId: string) =>
      ["issues", spaceId, "unread-touched-by-me"] as const,
    listBlockedAttention: (spaceId: string) =>
      ["issues", spaceId, "blocked-attention"] as const,
    countBlockedAttention: (spaceId: string) =>
      ["issues", spaceId, "blocked-attention", "count"] as const,
    labels: (spaceId: string) => ["issues", spaceId, "labels"] as const,
    listByProject: (spaceId: string, projectId: string) =>
      ["issues", spaceId, "project", projectId] as const,
    listPluginOperationsByProject: (
      spaceId: string,
      projectId: string,
      originKindPrefix: string,
    ) =>
      [
        "issues",
        spaceId,
        "project",
        projectId,
        "plugin-operations",
        originKindPrefix,
      ] as const,
    listParticipatedByAgent: (spaceId: string, agentId: string) =>
      ["issues", spaceId, "participated-by-agent", agentId] as const,
    listByParent: (spaceId: string, parentId: string) =>
      ["issues", spaceId, "parent", parentId] as const,
    listCreatedFromIssue: (spaceId: string, issueId: string) =>
      ["issues", spaceId, "created-from", issueId] as const,
    listByDescendantRoot: (spaceId: string, rootIssueId: string) =>
      ["issues", spaceId, "descendants", rootIssueId] as const,
    listByExecutionWorkspace: (
      spaceId: string,
      executionWorkspaceId: string,
    ) =>
      [
        "issues",
        spaceId,
        "execution-workspace",
        executionWorkspaceId,
      ] as const,
    summaries: (spaceId: string) => ["issues", spaceId, "summaries"] as const,
    summaryBatch: (spaceId: string, userId: string | null | undefined, sortedIds: readonly string[]) =>
      ["issues", spaceId, "summaries", userId ?? "__local_operator__", sortedIds] as const,
    detail: (id: string) => ["issues", "detail", id] as const,
    comments: (issueId: string) => ["issues", "comments", issueId] as const,
    acknowledgedComments: (issueId: string) => ["issues", "comments", issueId, "acknowledged"] as const,
    earlierComments: (issueId: string) => ["issues", "comments", issueId, "earlier"] as const,
    commentsList: (issueId: string) =>
      ["issues", "comments", issueId, "list"] as const,
    queuedComments: (issueId: string) =>
      ["issues", "queued-comments", issueId] as const,
    interactions: (issueId: string) =>
      ["issues", "interactions", issueId] as const,
    acceptedPlanDecompositions: (issueId: string) =>
      ["issues", "accepted-plan-decompositions", issueId] as const,
    feedbackVotes: (issueId: string) =>
      ["issues", "feedback-votes", issueId] as const,
    costSummary: (issueId: string, options: { excludeRoot?: boolean } = {}) =>
      options.excludeRoot
        ? (["issues", "cost-summary", issueId, "exclude-root"] as const)
        : (["issues", "cost-summary", issueId] as const),
    privacyConstraints: (issueId: string) => ["issues", "privacy-constraints", issueId] as const,
    accessGrants: (issueId: string) => ["issues", "access-grants", issueId] as const,
    attachments: (issueId: string) => ["issues", "attachments", issueId] as const,
    attachmentPreview: (attachmentId: string) => ["issues", "attachment-preview", attachmentId] as const,
    documents: (issueId: string) => ["issues", "documents", issueId] as const,
    document: (issueId: string, key: string) =>
      ["issues", "document", issueId, key] as const,
    documentRevisions: (issueId: string, key: string) =>
      ["issues", "document-revisions", issueId, key] as const,
    documentAnnotations: (
      issueId: string,
      key: string,
      status: "open" | "resolved" | "all" = "all",
    ) => ["issues", "document-annotations", issueId, key, status] as const,
    activity: (issueId: string) => ["issues", "activity", issueId] as const,
    runs: (issueId: string) => ["issues", "runs", issueId] as const,
    approvals: (issueId: string) => ["issues", "approvals", issueId] as const,
    liveRuns: (issueId: string) => ["issues", "live-runs", issueId] as const,
    activeRun: (issueId: string) => ["issues", "active-run", issueId] as const,
    contextUsage: (issueId: string, assigneeAgentId: string | null) =>
      ["issues", "context-usage", issueId, assigneeAgentId] as const,
    runnerGoal: (issueId: string, agentId?: string | null) =>
      ["issues", "runner-goal", issueId, agentId ?? "__effective__"] as const,
    workProducts: (issueId: string) =>
      ["issues", "work-products", issueId] as const,
    workProductPullRequestRefresh: (issueId: string) =>
      ["issues", "work-product-pr-refresh", issueId] as const,
    fileResources: (
      issueId: string,
      options: {
        workspace?: string;
        projectId?: string | null;
        workspaceId?: string | null;
        path?: string | null;
        mode?: string;
        q?: string | null;
        limit?: number;
        offset?: number;
      } = {},
    ) => ["issues", "file-resources", issueId, "list", options] as const,
    fileResource: (
      issueId: string,
      query: {
        path: string;
        workspace?: string;
        projectId?: string | null;
        workspaceId?: string | null;
      },
    ) => ["issues", "file-resources", issueId, "resolve", query] as const,
    fileResourceContent: (
      issueId: string,
      query: {
        path: string;
        workspace?: string;
        projectId?: string | null;
        workspaceId?: string | null;
      },
    ) => ["issues", "file-resources", issueId, "content", query] as const,
    /**
     * Batched availability preflight. `refKeys` are the deduplicated,
     * lexicographically sorted reference keys in the request so identical
     * batches share one cache entry.
     */
    fileResourceAvailability: (issueId: string, refKeys: readonly string[]) =>
      ["issues", "file-resources", issueId, "availability", refKeys] as const,
  },
  routines: {
    list: (spaceId: string, filters?: { projectId?: string | null }) =>
      [
        "routines",
        spaceId,
        filters?.projectId ?? "__all-projects__",
      ] as const,
    detail: (id: string) => ["routines", "detail", id] as const,
    runs: (id: string) => ["routines", "runs", id] as const,
    revisions: (id: string) => ["routines", "revisions", id] as const,
    activity: (spaceId: string, id: string) =>
      ["routines", "activity", spaceId, id] as const,
    documentAnnotations: (
      routineId: string,
      key: "description",
      status: "open" | "resolved" | "all" = "all",
    ) => ["routines", "document-annotations", routineId, key, status] as const,
  },
  folders: {
    list: (spaceId: string, kind: string) =>
      ["folders", spaceId, kind] as const,
  },
  executionWorkspaces: {
    list: (
      spaceId: string,
      filters?: Record<string, string | boolean | undefined>,
    ) => ["execution-workspaces", spaceId, filters ?? {}] as const,
    summaryList: (
      spaceId: string,
      filters?: Record<string, string | boolean | undefined>,
    ) => ["execution-workspaces", spaceId, "summary", filters ?? {}] as const,
    overview: (
      spaceId: string,
      filters?: Record<string, string | number | boolean | undefined>,
    ) =>
      ["execution-workspaces", spaceId, "overview", filters ?? {}] as const,
    detail: (id: string) => ["execution-workspaces", "detail", id] as const,
    closeReadiness: (id: string) =>
      ["execution-workspaces", "close-readiness", id] as const,
    workspaceOperations: (id: string) =>
      ["execution-workspaces", "workspace-operations", id] as const,
  },
  environments: {
    list: (spaceId: string) => ["environments", spaceId] as const,
    capabilities: (spaceId: string) =>
      ["environment-capabilities", spaceId] as const,
    customImageTemplate: (environmentId: string) =>
      ["environments", environmentId, "custom-image-template"] as const,
    customImageSetupSession: (sessionId: string) =>
      ["environment-custom-image-setup-sessions", sessionId] as const,
  },
  projects: {
    environments: (spaceId: string) => ["project-environments", spaceId] as const,
    all: (spaceId: string) => ["projects", spaceId] as const,
    list: (spaceId: string, opts: { includeArchived?: boolean } = {}) =>
      [
        "projects",
        spaceId,
        { includeArchived: opts.includeArchived === true },
      ] as const,
    detail: (id: string) => ["projects", "detail", id] as const,
    accessMembers: (id: string) => ["projects", "access-members", id] as const,
  },
  cases: {
    handoffs: (id: string) => ["cases", "handoffs", id] as const,
    list: (spaceId: string) => ["cases", spaceId] as const,
    detail: (id: string) => ["cases", "detail", id] as const,
    documents: (id: string) => ["cases", "documents", id] as const,
    documentAnnotations: (
      caseId: string,
      key: string,
      status: "open" | "resolved" | "all" = "all",
    ) => ["cases", "document-annotations", caseId, key, status] as const,
    events: (id: string) => ["cases", "events", id] as const,
    children: (parentId: string) => ["cases", "children", parentId] as const,
    revisions: (id: string, key: string) =>
      ["cases", "revisions", id, key] as const,
    forIssue: (issueId: string) => ["cases", "for-issue", issueId] as const,
  },
  externalObjects: {
    byIssue: (issueId: string) =>
      ["external-objects", "by-issue", issueId] as const,
    issueSummary: (issueId: string) =>
      ["external-objects", "issue-summary", issueId] as const,
    issueSummaries: (spaceId: string, issueIds: readonly string[]) =>
      ["external-objects", "issue-summaries", spaceId, issueIds] as const,
    projectSummary: (projectId: string) =>
      ["external-objects", "project-summary", projectId] as const,
  },
  goals: {
    list: (spaceId: string) => ["goals", spaceId] as const,
    detail: (id: string) => ["goals", "detail", id] as const,
  },
  artifacts: {
    list: (
      spaceId: string,
      kind?: string,
      q?: string,
      groupBy?: string,
      groupIssueId?: string,
    ) =>
      [
        "artifacts",
        spaceId,
        kind ?? "all",
        q ?? "",
        groupBy ?? "none",
        groupIssueId ?? "",
      ] as const,
    byAgent: (spaceId: string, agentId: string) =>
      ["artifacts", spaceId, "by-agent", agentId] as const,
  },
  budgets: {
    overview: (spaceId: string) =>
      ["budgets", "overview", spaceId] as const,
  },
  approvals: {
    list: (spaceId: string, status?: string) =>
      ["approvals", spaceId, status] as const,
    detail: (approvalId: string) =>
      ["approvals", "detail", approvalId] as const,
    comments: (approvalId: string) =>
      ["approvals", "comments", approvalId] as const,
    issues: (approvalId: string) =>
      ["approvals", "issues", approvalId] as const,
  },
  access: {
    invites: (spaceId: string, state: string = "all", limit: number = 20) =>
      ["access", "invites", "paginated-v1", spaceId, state, limit] as const,
    joinRequests: (spaceId: string, status: string = "pending_approval") =>
      ["access", "join-requests", spaceId, status] as const,
    spaceMembers: (spaceId: string) =>
      ["access", "space-members", spaceId] as const,
    spaceUserDirectory: (spaceId: string) =>
      ["access", "outpost-user-directory", spaceId] as const,
    adminUsers: (query: string) => ["access", "admin-users", query] as const,
    invite: (token: string) => ["access", "invite", token] as const,
    currentOperatorAccess: ["access", "current-operator-access"] as const,
  },
  auth: {
    session: ["auth", "session"] as const,
  },
  inboxAgentPolicy: {
    mine: (spaceId: string) =>
      ["inbox-agent-policy", spaceId, "me"] as const,
  },
  sidebarPreferences: {
    spaceOrder: (userId: string) =>
      ["sidebar-preferences", "outpost-order", userId] as const,
    projectOrder: (spaceId: string, userId: string) =>
      ["sidebar-preferences", "project-order", spaceId, userId] as const,
  },
  defaultAgent: {
    mine: (spaceId: string, userId: string) => ["default-agent", spaceId, userId] as const,
  },
  resourceMemberships: {
    mine: (spaceId: string) =>
      ["resource-memberships", spaceId, "me"] as const,
  },
  instance: {
    settings: ["instance", "settings"] as const,
    generalSettings: ["instance", "general-settings"] as const,
    experimentalSettings: ["instance", "experimental-settings"] as const,
  },
  health: ["health"] as const,
  stagingCommit: ["staging-commit"] as const,
  cloud: {
    stacks: ["cloud", "stacks"] as const,
  },
  secrets: {
    list: (spaceId: string) => ["secrets", spaceId] as const,
    providers: (spaceId: string) => ["secret-providers", spaceId] as const,
    providerConfigs: (spaceId: string) =>
      ["secret-provider-configs", spaceId] as const,
    usage: (secretId: string) => ["secrets", "usage", secretId] as const,
    accessEvents: (secretId: string) =>
      ["secrets", "access-events", secretId] as const,
    userDefinitions: (spaceId: string) =>
      ["user-secret-definitions", spaceId] as const,
    userDefinitionCoverage: (spaceId: string, definitionId: string) =>
      ["user-secret-definitions", spaceId, definitionId, "coverage"] as const,
    myUserSecrets: (spaceId: string) =>
      ["my-user-secrets", spaceId] as const,
    proposals: (spaceId: string, status: string = "pending") =>
      ["secret-proposals", spaceId, status] as const,
  },
  spaceSearch: {
    search: (
      spaceId: string,
      q: string,
      scope: string,
      limit: number,
      offset: number,
    ) => ["outpost-search", spaceId, q, scope, limit, offset] as const,
  },
  dashboard: (spaceId: string) => ["dashboard", spaceId] as const,
  attention: (spaceId: string) => ["attention", spaceId] as const,
  decisions: {
    list: (spaceId: string, status?: string) =>
      ["decisions", spaceId, status ?? "__all-statuses__"] as const,
    detail: (id: string) => ["decisions", "detail", id] as const,
    forTargetIssue: (spaceId: string, issueId: string) =>
      ["decisions", spaceId, "target", issueId] as const,
    taskRecord: (spaceId: string, issueId: string, viewerId: string | null, decisionId: string | null) =>
      ["decisions", spaceId, "task-record", issueId, viewerId, decisionId] as const,
  },
  decisionQueues: {
    list: (spaceId: string) => ["decision-queues", spaceId] as const,
    items: (spaceId: string, key: string) =>
      ["decision-queues", spaceId, "items", key] as const,
    seedRules: (spaceId: string) =>
      ["decision-queues", spaceId, "seed-rules"] as const,
    triage: (spaceId: string, sourceKind: string, sourceId: string) =>
      ["decision-triage", spaceId, sourceKind, sourceId] as const,
  },
  workTimeline: (spaceId: string, lens?: string) =>
    ["work-timeline", spaceId, lens ?? "all"] as const,
  userProfile: (spaceId: string, userSlug: string) =>
    ["user-profile", spaceId, userSlug] as const,
  sidebarBadges: (spaceId: string) => ["sidebar-badges", spaceId] as const,
  inboxDismissals: (spaceId: string) =>
    ["inbox-dismissals", spaceId] as const,
  activity: (spaceId: string) => ["activity", spaceId] as const,
  costs: (spaceId: string, from?: string, to?: string) =>
    ["costs", spaceId, from, to] as const,
  usageByProvider: (spaceId: string, from?: string, to?: string) =>
    ["usage-by-provider", spaceId, from, to] as const,
  usageByBiller: (spaceId: string, from?: string, to?: string) =>
    ["usage-by-biller", spaceId, from, to] as const,
  financeSummary: (spaceId: string, from?: string, to?: string) =>
    ["finance-summary", spaceId, from, to] as const,
  financeByBiller: (spaceId: string, from?: string, to?: string) =>
    ["finance-by-biller", spaceId, from, to] as const,
  financeByKind: (spaceId: string, from?: string, to?: string) =>
    ["finance-by-kind", spaceId, from, to] as const,
  financeEvents: (
    spaceId: string,
    from?: string,
    to?: string,
    limit: number = 100,
  ) => ["finance-events", spaceId, from, to, limit] as const,
  usageWindowSpend: (spaceId: string) =>
    ["usage-window-spend", spaceId] as const,
  usageQuotaWindows: (spaceId: string) =>
    ["usage-quota-windows", spaceId] as const,
  heartbeats: (spaceId: string, agentId?: string) =>
    ["heartbeats", spaceId, agentId] as const,
  runDetail: (runId: string) => ["heartbeat-run", runId] as const,
  providerTraceMetadata: (spaceId: string, runIds: readonly string[]) =>
    ["provider-trace-metadata", spaceId, [...runIds].sort()] as const,
  runWorkspaceOperations: (runId: string) =>
    ["heartbeat-run", runId, "workspace-operations"] as const,
  liveRuns: (spaceId: string) => ["live-runs", spaceId] as const,
  runIssues: (runId: string) => ["run-issues", runId] as const,
  agentHierarchy: (spaceId: string) => ["agent-hierarchy", spaceId] as const,
  skills: {
    available: ["skills", "available"] as const,
  },
  plugins: {
    all: ["plugins"] as const,
    bundled: ["plugins", "bundled"] as const,
    detail: (pluginId: string) => ["plugins", pluginId] as const,
    health: (pluginId: string) => ["plugins", pluginId, "health"] as const,
    uiContributions: ["plugins", "ui-contributions"] as const,
    config: (pluginId: string, spaceId: string) =>
      ["plugins", pluginId, "spaces", spaceId, "config"] as const,
    localFolders: (pluginId: string, spaceId: string) =>
      ["plugins", pluginId, "spaces", spaceId, "local-folders"] as const,
    dashboard: (pluginId: string) =>
      ["plugins", pluginId, "dashboard"] as const,
    logs: (pluginId: string) => ["plugins", pluginId, "logs"] as const,
  },
  adapters: {
    all: ["adapters"] as const,
    availability: (spaceId: string | null, environmentId?: string | null) =>
      ["adapters", "availability", spaceId, environmentId ?? null] as const,
  },
};
