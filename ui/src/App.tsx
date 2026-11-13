import { AgentChats } from "./pages/AgentChats";
import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { Navigate, Outlet, Route, Routes, useActiveCompanyPrefix, useLocation, useParams } from "@/lib/router";
import { Layout } from "./components/Layout";
import { ConferenceRoomChatGate } from "./components/ConferenceRoomChatGate";
import { CasesExperimentalGate } from "./components/CasesExperimentalGate";
import { StatusCardsExperimentalGate } from "./components/StatusCardsExperimentalGate";
import { CloudManagedPageGate } from "./components/CloudManagedPageGate";
import { HiddenSettingsPageGate } from "./components/HiddenSettingsPageGate";
import { IsolatedWorkspacesRouteGate } from "./components/IsolatedWorkspacesRouteGate";
import {
  ExecutionWorkspaceCompanyGate,
  UnprefixedExecutionWorkspaceRedirect,
} from "./components/UnprefixedExecutionWorkspaceRedirect";
import { useHiddenSettings } from "./hooks/useHiddenSettings";
import { CloudAccessGate } from "./components/CloudAccessGate";
import { ConnectionStatusBanner } from "./components/ConnectionStatusBanner";
import { ShellConfigurationGate } from "./components/ShellConfigurationGate";
import { PaperclipLoading } from "./components/AnimatedPaperclipIcon";
import { AGENT_FILTER_TABS } from "./lib/agent-filter-tabs";
import { useCombinedInboxTasksEnabled } from "./hooks/useCombinedInboxTasksEnabled";
import { NotFoundPage } from "./pages/NotFound";
import { useCompany } from "./context/CompanyContext";
import { loadLastInboxTab } from "./lib/inbox";
import { TASK_VIEW_PARAM, taskViewForInboxTab, type TaskViewKey } from "./lib/task-views";
import { filterHiddenInstanceSettingsPath, normalizeRememberedInstanceSettingsPath } from "./lib/instance-settings";
import { useStreamlinedUiEnabled } from "./hooks/useStreamlinedUiEnabled";

const AuthPage = lazy(() => import("./pages/Auth").then((module) => ({ default: module.AuthPage })));
const BoardClaimPage = lazy(() => import("./pages/BoardClaim").then((module) => ({ default: module.BoardClaimPage })));
const CliAuthPage = lazy(() => import("./pages/CliAuth").then((module) => ({ default: module.CliAuthPage })));
const ChatIdentityConfirm = lazy(() => import("./pages/apps/chat/ChatIdentityConfirm").then((module) => ({ default: module.ChatIdentityConfirm })));
const PaperclipCloudOAuthHandoffPage = lazy(() => import("./pages/apps/PaperclipCloudOAuthHandoff").then((module) => ({ default: module.PaperclipCloudOAuthHandoffPage })));
const McpConnectPage = lazy(() => import("./pages/McpConnect").then((module) => ({ default: module.McpConnectPage })));
const McpDevicePage = lazy(() => import("./pages/McpConnect").then((module) => ({ default: module.McpDevicePage })));
const AssistantConnectionsPage = lazy(() => import("./pages/McpConnect").then((module) => ({ default: module.AssistantConnectionsPage })));
const ProductionLayout = lazy(() => import("./components/Layout.production").then((module) => ({ default: module.Layout })));

const TaskChatLab = lazy(() => import("./pages/TaskChatLab").then((module) => ({ default: module.TaskChatLab })));
const loadIssues = () => import("./pages/Issues").then((module) => ({ default: module.Issues }));
const Issues = lazy(loadIssues);
let issueDetailLoad: Promise<{ default: typeof import("./pages/IssueDetail").IssueDetail }> | undefined;
const loadIssueDetail = () =>
  (issueDetailLoad ??= import("./pages/IssueDetail").then((module) => ({ default: module.IssueDetail })));
const IssueDetail = lazy(loadIssueDetail);
const AgentChat = lazy(() => import("./pages/AgentChat").then((module) => ({ default: module.AgentChat })));
const IssueChatLongThreadPerf = lazy(() => import("./pages/IssueChatLongThreadPerf").then((module) => ({ default: module.IssueChatLongThreadPerf })));
const loadInbox = () => import("./pages/Inbox").then((module) => ({ default: module.Inbox }));
const Inbox = lazy(loadInbox);
const BootstrapSetupUxLab = lazy(() => import("./pages/BootstrapSetupUxLab").then((module) => ({ default: module.BootstrapSetupUxLab })));
const ResponsibleUserDenialUxLab = lazy(() => import("./pages/ResponsibleUserDenialUxLab").then((module) => ({ default: module.ResponsibleUserDenialUxLab })));
const CrossIssueCollaborationUxLab = lazy(() => import("./pages/CrossIssueCollaborationUxLab").then((module) => ({ default: module.CrossIssueCollaborationUxLab })));
const Agents = lazy(() => import("./pages/Agents").then((module) => ({ default: module.Agents })));
const Cases = lazy(() => import("./pages/Cases").then((module) => ({ default: module.Cases })));
const CaseDetail = lazy(() => import("./pages/CaseDetail").then((module) => ({ default: module.CaseDetail })));
const Dashboard = lazy(() => import("./pages/Dashboard").then((module) => ({ default: module.Dashboard })));
const DashboardLive = lazy(() => import("./pages/DashboardLive").then((module) => ({ default: module.DashboardLive })));
const Timeline = lazy(() => import("./pages/Timeline").then((module) => ({ default: module.Timeline })));
const Companies = lazy(() => import("./pages/Companies").then((module) => ({ default: module.Companies })));
const AgentDetail = lazy(() => import("./pages/AgentDetailPage").then((module) => ({ default: module.AgentDetailPage })));
const Workspaces = lazy(() => import("./pages/Workspaces").then((module) => ({ default: module.Workspaces })));
const Search = lazy(() => import("./pages/Search").then((module) => ({ default: module.Search })));
const Routines = lazy(() => import("./pages/Routines").then((module) => ({ default: module.Routines })));
const StatusCards = lazy(() => import("./pages/StatusCards").then((module) => ({ default: module.StatusCards })));
const RoutineDetail = lazy(() => import("./pages/RoutineDetail").then((module) => ({ default: module.RoutineDetail })));
const ExecutionWorkspaceDetail = lazy(() => import("./pages/ExecutionWorkspaceDetail").then((module) => ({ default: module.ExecutionWorkspaceDetail })));
const Goals = lazy(() => import("./pages/Goals").then((module) => ({ default: module.Goals })));
const Artifacts = lazy(() => import("./pages/Artifacts").then((module) => ({ default: module.Artifacts })));
const GoalDetail = lazy(() => import("./pages/GoalDetail").then((module) => ({ default: module.GoalDetail })));
const Approvals = lazy(() => import("./pages/Approvals").then((module) => ({ default: module.Approvals })));
const ApprovalDetail = lazy(() => import("./pages/ApprovalDetail").then((module) => ({ default: module.ApprovalDetail })));
const CompanyActivity = lazy(() => import("./pages/audit/CompanyActivity").then((module) => ({ default: module.CompanyActivity })));
const AuditHub = lazy(() => import("./pages/audit/AuditHub").then((module) => ({ default: module.AuditHub })));
const WhatNeedsMe = lazy(() => import("./pages/WhatNeedsMe").then((module) => ({ default: module.WhatNeedsMe })));
const DecisionQueuePage = lazy(() => import("./pages/DecisionQueuePage").then((module) => ({ default: module.DecisionQueuePage })));
const BoardChat = lazy(() => import("./pages/BoardChat").then((module) => ({ default: module.BoardChat })));
const CompanySettings = lazy(() => import("./pages/CompanySettings").then((module) => ({ default: module.CompanySettings })));
const CompanyConnections = lazy(() => import("./pages/CompanyConnections").then((module) => ({ default: module.CompanyConnections })));
const CompanyEnvironments = lazy(() => import("./pages/CompanyEnvironments").then((module) => ({ default: module.CompanyEnvironments })));
const CompanySettingsPluginPage = lazy(() => import("./pages/CompanySettingsPluginPage").then((module) => ({ default: module.CompanySettingsPluginPage })));
const InstalledSkills = lazy(() => import("./pages/InstalledSkills").then((module) => ({ default: module.InstalledSkills })));
const Secrets = lazy(() => import("./pages/Secrets").then((module) => ({ default: module.Secrets })));
const CompanyImport = lazy(() => import("./pages/CompanyImport").then((module) => ({ default: module.CompanyImport })));
const DesignGuide = lazy(() => import("./pages/DesignGuide").then((module) => ({ default: module.DesignGuide })));
const InstanceExperimentalSettings = lazy(() => import("./pages/InstanceExperimentalSettings").then((module) => ({ default: module.InstanceExperimentalSettings })));
const PluginManager = lazy(() => import("./pages/PluginManager").then((module) => ({ default: module.PluginManager })));
const PluginSettings = lazy(() => import("./pages/PluginSettings").then((module) => ({ default: module.PluginSettings })));
const AdapterManager = lazy(() => import("./pages/AdapterManager").then((module) => ({ default: module.AdapterManager })));
const PluginPage = lazy(() => import("./pages/PluginPage").then((module) => ({ default: module.PluginPage })));
const NewAgent = lazy(() => import("./pages/NewAgent").then((module) => ({ default: module.NewAgent })));

const CompanyExport = lazy(() => import("./pages/CompanyExport").then((module) => ({ default: module.CompanyExport })));

const ProductionAgents = lazy(() => import("./pages/Agents.production").then((module) => ({ default: module.Agents })));
const ProductionRoutines = lazy(() => import("./pages/Routines.production").then((module) => ({ default: module.Routines })));
const ProductionRoutineDetail = lazy(() => import("./pages/RoutineDetail.production").then((module) => ({ default: module.RoutineDetail })));
const ProductionCompanyActivity = lazy(() => import("./pages/audit/CompanyActivity.production").then((module) => ({ default: module.CompanyActivity })));
const ProductionOrgChart = lazy(() => import("./pages/OrgChart.production").then((module) => ({ default: module.OrgChart })));

function ProductionSurface({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PaperclipLoading />}>{children}</Suspense>;
}

function boardRoutes(streamlinedUiEnabled: boolean, combinedInboxTasksEnabled: boolean) {
  // Combined Inbox + Task List (PAP-670) only exists in the streamlined shell.
  const mergedTasks = streamlinedUiEnabled && combinedInboxTasksEnabled;
  return (
    <>
      <Route index element={<Navigate to="dashboard" replace />} />
      <Route path="dashboard" element={<Dashboard />} />
      <Route path="dashboard/live" element={<DashboardLive />} />
      <Route
        path="timeline"
        element={streamlinedUiEnabled ? <AuditCompatibilityRedirect to="/activity/timeline" /> : <Timeline />}
      />
      <Route path="onboarding" element={<Navigate to="../dashboard" replace />} />
      <Route path="spaces" element={<Companies />} />
      <Route path="companies" element={<Navigate to="/spaces" replace />} />
      <Route path="company/settings" element={<CompanySettings />} />
      <Route path="company/settings/connections" element={<CompanyConnections />} />
      <Route path="company/settings/environments" element={<Navigate to="/company/settings/instance/environments" replace />} />
      <Route path="company/settings/cloud-upstream" element={<Navigate to="/company/export" replace />} />
      <Route path="company/settings/members" element={<Navigate to="/company/settings" replace />} />
      <Route path="company/settings/access" element={<Navigate to="/company/settings" replace />} />
      <Route path="company/settings/invites" element={<Navigate to="/company/settings" replace />} />
      <Route element={<HiddenSettingsPageGate pageKey="company.export" />}>
        <Route
          path="company/export/*"
          element={(
            <Suspense fallback={<PaperclipLoading />}>
              <CompanyExport />
            </Suspense>
          )}
        />
      </Route>
      <Route element={<CloudManagedPageGate />}>
        <Route element={<HiddenSettingsPageGate pageKey="company.import" />}>
          <Route path="company/import" element={<CompanyImport />} />
        </Route>
      </Route>
      <Route element={<HiddenSettingsPageGate pageKey="company.secrets" />}>
        <Route path="company/settings/secrets" element={<Secrets />} />
      </Route>
      <Route path="company/settings/tools/*" element={<Navigate to="/dashboard" replace />} />
      <Route path="tools/*" element={<Navigate to="/dashboard" replace />} />
      <Route path="apps/*" element={<Navigate to="/dashboard" replace />} />
      <Route path="company/settings/instance" element={<Navigate to="/company/settings" replace />} />
      <Route path="company/settings/instance/profile" element={<Navigate to="/company/settings" replace />} />
      <Route path="company/settings/instance/general" element={<Navigate to="/company/settings" replace />} />
      <Route path="company/settings/instance/heartbeats" element={<Navigate to="/company/settings" replace />} />
      <Route element={<HiddenSettingsPageGate pageKey="instance.environments" />}>
        <Route path="company/settings/instance/environments" element={<CompanyEnvironments />} />
        <Route path="company/settings/instance/environments/new" element={<CompanyEnvironments mode="create" />} />
        <Route path="company/settings/instance/environments/:environmentId/edit" element={<CompanyEnvironments mode="edit" />} />
      </Route>
      <Route path="company/settings/instance/access" element={<Navigate to="/company/settings" replace />} />
      <Route element={<HiddenSettingsPageGate pageKey="instance.experimental" />}>
        <Route path="company/settings/instance/experimental" element={<InstanceExperimentalSettings />} />
      </Route>
      <Route element={<HiddenSettingsPageGate pageKey="instance.plugins" />}>
        <Route path="company/settings/instance/plugins" element={<PluginManager />} />
        <Route path="company/settings/instance/plugins/:pluginId" element={<PluginSettings />} />
      </Route>
      <Route element={<HiddenSettingsPageGate pageKey="instance.adapters" />}>
        <Route path="company/settings/instance/adapters" element={<AdapterManager />} />
      </Route>
      <Route path="company/settings/:settingsRoutePath/*" element={<CompanySettingsPluginPage />} />
      <Route path="skills/sources/*" element={<Navigate to="/skills" replace />} />
      <Route path="skills/studio/*" element={<Navigate to="/skills" replace />} />
      <Route path="skills/:skillId/studio" element={<Navigate to="/skills" replace />} />
      <Route path="skills/*" element={<InstalledSkills />} />
      <Route path="settings" element={<LegacySettingsRedirect />} />
      <Route path="settings/*" element={<LegacySettingsRedirect />} />
      <Route path="plugins/:pluginId" element={<PluginPage />} />
      <Route
        path="org"
        element={streamlinedUiEnabled ? <Navigate to="/agents/all" replace /> : <ProductionSurface><ProductionOrgChart /></ProductionSurface>}
      />
      <Route path="agents" element={<Navigate to="/agents/all" replace />} />
      {AGENT_FILTER_TABS.map((tab) => (
        <Route
          key={tab}
          path={`agents/${tab}`}
          element={streamlinedUiEnabled ? <Agents /> : <ProductionSurface><ProductionAgents /></ProductionSurface>}
        />
      ))}
      <Route path="agents/new" element={<NewAgent />} />
      <Route path="agents/:agentId" element={<AgentDetail />} />
      <Route path="agents/:agentId/:tab" element={<AgentDetail />} />
      <Route path="agents/:agentId/runs/:runId" element={<AgentDetail />} />
      <Route path="projects/*" element={<Navigate to="/spaces" replace />} />
      <Route element={<IsolatedWorkspacesRouteGate />}>
        <Route path="workspaces" element={<Workspaces />} />
      </Route>
      <Route path="issues" element={<Issues />} />
      <Route path="tasks" element={<Navigate to="/issues" replace />} />
      <Route path="search" element={<Search />} />
      {mergedTasks ? (
        <>
          {/* Combined Inbox + Task List: the status presets are real views, not aliases of /issues. */}
          <Route path="issues/all" element={<TaskViewRedirect view="all" />} />
          <Route path="issues/active" element={<TaskViewRedirect view="active" />} />
          <Route path="issues/backlog" element={<TaskViewRedirect view="backlog" />} />
          <Route path="issues/done" element={<TaskViewRedirect view="done" />} />
          <Route path="issues/recent" element={<TaskViewRedirect view="recent" />} />
        </>
      ) : (
        <>
          <Route path="issues/all" element={<Navigate to="/issues" replace />} />
          <Route path="issues/active" element={<Navigate to="/issues" replace />} />
          <Route path="issues/backlog" element={<Navigate to="/issues" replace />} />
          <Route path="issues/done" element={<Navigate to="/issues" replace />} />
          <Route path="issues/recent" element={<Navigate to="/issues" replace />} />
        </>
      )}
      <Route path="chats" element={<AgentChats />} />
      <Route path="chats/:agentRef" element={<AgentChat />} />
      <Route path="issues/:issueId" element={<IssueDetail />} />
      {import.meta.env.DEV ? (
        <Route path="tests/perf/long-thread" element={<IssueChatLongThreadPerf />} />
      ) : null}
      <Route path="routines" element={streamlinedUiEnabled ? <Routines /> : <ProductionSurface><ProductionRoutines /></ProductionSurface>} />
      <Route
        path="cases"
        element={<CasesExperimentalGate><Cases /></CasesExperimentalGate>}
      />
      <Route
        path="cases/:caseIdentifier"
        element={<CasesExperimentalGate><CaseDetail /></CasesExperimentalGate>}
      />
      <Route
        path="status"
        element={<StatusCardsExperimentalGate><StatusCards /></StatusCardsExperimentalGate>}
      />
      <Route
        path="status/:cardId"
        element={<StatusCardsExperimentalGate><StatusCards /></StatusCardsExperimentalGate>}
      />
      {/* Back-compat: the board lived at /status-cards before PAP-15223. */}
      <Route path="status-cards" element={<StatusCardsLegacyRedirect />} />
      <Route path="status-cards/:cardId" element={<StatusCardsLegacyRedirect />} />
      <Route path="routines/:routineId" element={streamlinedUiEnabled ? <RoutineDetail /> : <ProductionSurface><ProductionRoutineDetail /></ProductionSurface>} />
      <Route path="routines/:routineId/:section" element={streamlinedUiEnabled ? <RoutineDetail /> : <ProductionSurface><ProductionRoutineDetail /></ProductionSurface>} />
      <Route element={<IsolatedWorkspacesRouteGate />}>
        <Route element={<ExecutionWorkspaceCompanyGate />}>
          <Route path="execution-workspaces/:workspaceId" element={<ExecutionWorkspaceDetail />} />
          <Route path="execution-workspaces/:workspaceId/services" element={<ExecutionWorkspaceDetail />} />
          <Route path="execution-workspaces/:workspaceId/configuration" element={<ExecutionWorkspaceDetail />} />
          <Route path="execution-workspaces/:workspaceId/runtime-logs" element={<ExecutionWorkspaceDetail />} />
          <Route path="execution-workspaces/:workspaceId/issues" element={<ExecutionWorkspaceDetail />} />
          <Route path="execution-workspaces/:workspaceId/routines" element={<ExecutionWorkspaceDetail />} />
        </Route>
      </Route>
      <Route path="goals" element={<Goals />} />
      <Route path="goals/:goalId" element={<GoalDetail />} />
      <Route path="artifacts" element={<Artifacts />} />
      <Route path="approvals" element={<Navigate to="/approvals/pending" replace />} />
      <Route path="approvals/pending" element={<Approvals />} />
      <Route path="approvals/all" element={<Approvals />} />
      <Route path="approvals/:approvalId" element={<ApprovalDetail />} />
      <Route path="activity" element={streamlinedUiEnabled ? <CompanyActivity /> : <ProductionSurface><ProductionCompanyActivity /></ProductionSurface>} />
      <Route path="activity/commentary" element={<AuditHub section="commentary" />} />
      <Route path="activity/runs" element={<AuditHub section="runs" />} />
      <Route path="activity/costs" element={<AuditCompatibilityRedirect to="/activity" />} />
      <Route path="activity/budgets" element={<AuditCompatibilityRedirect to="/activity" />} />
      <Route path="activity/timeline" element={<AuditHub section="timeline" />} />
      {streamlinedUiEnabled ? (
        <>
          <Route path="audit" element={<AuditCompatibilityRedirect to="/activity" forceAgentMode />} />
          <Route path="audit/activity" element={<AuditCompatibilityRedirect to="/activity" />} />
          <Route path="audit/runs" element={<AuditCompatibilityRedirect to="/activity/runs" />} />
          <Route path="audit/costs" element={<AuditCompatibilityRedirect to="/activity" />} />
          <Route path="audit/budgets" element={<AuditCompatibilityRedirect to="/activity" />} />
          <Route path="audit/timeline" element={<AuditCompatibilityRedirect to="/activity/timeline" />} />
          <Route path="runs" element={<AuditCompatibilityRedirect to="/activity/runs" />} />
          <Route path="costs" element={<AuditCompatibilityRedirect to="/activity" />} />
          <Route path="budgets" element={<AuditCompatibilityRedirect to="/activity" />} />
        </>
      ) : (
        <>
          <Route path="costs" element={<Navigate to="/activity" replace />} />
          <Route path="audit" element={<Navigate to="/activity?mode=agents" replace />} />
        </>
      )}
      {/* Conference Room Chat surfaces (PAP-136/PAP-137): routes stay
          registered but redirect to the company home while the experimental
          flag is off. The board-level `artifacts` mount below is the new
          conference-room one; the master-level mount above it still serves
          `/artifacts` in both modes. */}
      <Route element={<ConferenceRoomChatGate />}>
        <Route path="board-chat" element={<BoardChat />} />
        <Route path="artifacts" element={<Artifacts />} />
      </Route>
      {/* Task chat dev harness — dev builds only. */}
      {import.meta.env.DEV ? (
        <Route path="dev/task-chat-lab" element={<TaskChatLab />} />
      ) : null}
      <Route path="decisions" element={<WhatNeedsMe />} />
      <Route path="decisions/queues/:key" element={<DecisionQueuePage />} />
      {/* Combined Inbox + Task List: Inbox is a view inside Tasks. Every supported
          /inbox/* URL still resolves into the matching view. The retired human
          access-request route redirects to the inbox below. */}
      {mergedTasks ? (
        <>
          <Route path="inbox" element={<InboxRootRedirect />} />
          <Route path="inbox/mine" element={<TaskViewRedirect view="mine" />} />
          <Route path="inbox/recent" element={<TaskViewRedirect view="recent" />} />
          <Route path="inbox/unread" element={<TaskViewRedirect view="unread" />} />
          <Route path="inbox/blocked" element={<TaskViewRedirect view="blocked" />} />
          <Route path="inbox/all" element={<TaskViewRedirect view="everything" />} />
          <Route path="inbox/new" element={<TaskViewRedirect view="mine" />} />
        </>
      ) : (
        <>
          <Route path="inbox" element={<InboxRootRedirect />} />
          <Route path="inbox/mine" element={<Inbox />} />
          <Route path="inbox/recent" element={<Inbox />} />
          <Route path="inbox/unread" element={<Inbox />} />
          <Route path="inbox/blocked" element={<Inbox />} />
          <Route path="inbox/all" element={<Inbox />} />
          <Route path="inbox/new" element={<Navigate to="/inbox/mine" replace />} />
        </>
      )}
      <Route path="inbox/requests" element={<Navigate to="/inbox" replace />} />
      <Route path="u/:userSlug" element={<Navigate to="/dashboard" replace />} />
      <Route path="design-guide" element={<DesignGuide />} />
      <Route path="instance/settings/adapters" element={<AdapterManager />} />
      <Route path=":pluginRoutePath/*" element={<PluginPage />} />
      <Route path="*" element={<NotFoundPage scope="board" />} />
    </>
  );
}

function InboxRootRedirect() {
  const { enabled: combinedInboxTasksEnabled } = useCombinedInboxTasksEnabled();
  return combinedInboxTasksEnabled
    ? <TaskViewRedirect view={taskViewForInboxTab(loadLastInboxTab())} />
    : <Navigate to={`/inbox/${loadLastInboxTab()}`} replace />;
}

/** Sends a retired Inbox/Tasks URL to its view on the merged Tasks surface. */
function TaskViewRedirect({ view }: { view: TaskViewKey }) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  params.set(TASK_VIEW_PARAM, view);
  return <Navigate to={`/issues?${params.toString()}${location.hash}`} replace />;
}

function LegacySettingsRedirect() {
  const location = useLocation();
  const { companies, selectedCompany, loading } = useCompany();
  const { companyPrefix } = useParams<{ companyPrefix?: string }>();
  const { hidden: hiddenSettings } = useHiddenSettings();

  if (loading) {
    return <PaperclipLoading />;
  }

  const targetCompany =
    (companyPrefix
      ? companies.find((company) => company.issuePrefix.toUpperCase() === companyPrefix.toUpperCase())
      : null) ??
    selectedCompany ??
    companies[0] ??
    null;

  if (!targetCompany) {
    return <Navigate to="/spaces" replace />;
  }

  const normalizedPath = filterHiddenInstanceSettingsPath(
    normalizeRememberedInstanceSettingsPath(
      `${location.pathname}${location.search}${location.hash}`,
    ),
    hiddenSettings,
  );

  return (
    <Navigate
      to={`/${targetCompany.issuePrefix}${normalizedPath}`}
      replace
    />
  );
}

function CompanyRootRedirect() {
  const { companies, selectedCompany, loading } = useCompany();
  if (loading) {
    return <PaperclipLoading />;
  }

  const targetCompany = selectedCompany ?? companies[0] ?? null;
  if (!targetCompany) {
    return <Navigate to="/spaces" replace />;
  }

  return <Navigate to={`/${targetCompany.issuePrefix}/dashboard`} replace />;
}

function StatusCardsLegacyRedirect() {
  const { cardId } = useParams<{ cardId?: string }>();
  const prefix = useActiveCompanyPrefix();
  const base = prefix ? `/${prefix}` : "";
  return <Navigate to={`${base}/status${cardId ? `/${cardId}` : ""}`} replace />;
}

function AuditCompatibilityRedirect({
  to,
  forceAgentMode = false,
}: {
  to: string;
  forceAgentMode?: boolean;
}) {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  if (forceAgentMode) searchParams.set("mode", "agents");
  const search = searchParams.toString();
  return <Navigate to={`${to}${search ? `?${search}` : ""}${location.hash}`} replace />;
}

function UnprefixedBoardRedirect() {
  const location = useLocation();
  const { companies, selectedCompany, loading } = useCompany();

  if (loading) {
    return <PaperclipLoading />;
  }

  const targetCompany = selectedCompany ?? companies[0] ?? null;
  if (!targetCompany) {
    return <Navigate to="/spaces" replace />;
  }

  return (
    <Navigate
      to={`/${targetCompany.issuePrefix}${location.pathname}${location.search}${location.hash}`}
      replace
    />
  );
}

function UnprefixedSpacesRoute() {
  const location = useLocation();
  const { companies, selectedCompany, loading } = useCompany();

  if (loading) {
    return <PaperclipLoading />;
  }

  const targetCompany = selectedCompany ?? companies[0] ?? null;
  if (!targetCompany) {
    return <Companies />;
  }

  return (
    <Navigate
      to={`/${targetCompany.issuePrefix}/spaces${location.search}${location.hash}`}
      replace
    />
  );
}

export function App() {
  const { pathname } = useLocation();
  const { enabled: streamlinedUiEnabled, loaded: streamlinedUiLoaded } = useStreamlinedUiEnabled();
  const { enabled: combinedInboxTasksEnabled } = useCombinedInboxTasksEnabled();
  useEffect(() => {
    // Download the requested collection while access/company checks run. Detail
    // code is already prefetched by row intent; don't compete with the cold list.
    if (/^\/[^/]+\/inbox(?:\/|$)/.test(pathname)) void loadInbox().catch(() => undefined);
    else if (/^\/[^/]+\/(issues|tasks)\/?$/.test(pathname)) void loadIssues().catch(() => undefined);
  }, [pathname]);

  return (
    <>
      <ConnectionStatusBanner />
      <Suspense fallback={<PaperclipLoading />}><Routes>
        <Route path="oauth-handoff" element={<PaperclipCloudOAuthHandoffPage />} />
        <Route path="auth" element={<AuthPage />} />
        <Route path="board-claim/:token" element={<BoardClaimPage />} />
        <Route path="mcp-connect/:id" element={<McpConnectPage />} />
        <Route path="dot-connect/:id" element={<McpConnectPage agentPairingOnly />} />
        <Route path="mcp-device" element={<McpDevicePage />} />
        <Route path="assistant-connections" element={<AssistantConnectionsPage />} />
        <Route path="cli-auth/:id" element={<CliAuthPage />} />
        <Route element={<CloudAccessGate allowMembershipRequest />}>
          <Route element={<ShellConfigurationGate loaded={streamlinedUiLoaded} />}>
          {/* The identity APIs enforce the chat rollout flag. Nonmembers cannot
              read experimental settings, but a private invitation may request membership. */}
          <Route path="chat-identity/confirm" element={<ChatIdentityConfirm />} />
          </Route>
        </Route>
        <Route path="tests/perf/long-thread" element={<IssueChatLongThreadPerf />} />
        <Route path="ux-lab/bootstrap-setup" element={<BootstrapSetupUxLab />} />
        <Route path="ux-lab/responsible-user-denial" element={<ResponsibleUserDenialUxLab />} />
        <Route path="ux-lab/cross-issue-collaboration" element={<CrossIssueCollaborationUxLab />} />

        <Route element={<CloudAccessGate />}>
          <Route element={<ShellConfigurationGate loaded={streamlinedUiLoaded} />}>
          <Route index element={<CompanyRootRedirect />} />
          <Route path="onboarding" element={<CompanyRootRedirect />} />
          <Route path="instance" element={<LegacySettingsRedirect />} />
          <Route path="instance/settings" element={<LegacySettingsRedirect />} />
          <Route path="instance/settings/*" element={<LegacySettingsRedirect />} />
          <Route path="spaces" element={<UnprefixedSpacesRoute />} />
          <Route path="companies" element={<Navigate to="/spaces" replace />} />
          <Route path="issues" element={<UnprefixedBoardRedirect />} />
          <Route path="tasks" element={<UnprefixedBoardRedirect />} />
          <Route path="issues/:issueId" element={<UnprefixedBoardRedirect />} />
          <Route path="approvals/:approvalId" element={<UnprefixedBoardRedirect />} />
          <Route path="routines" element={<UnprefixedBoardRedirect />} />
          <Route path="routines/:routineId" element={<UnprefixedBoardRedirect />} />
          <Route path="cases" element={<UnprefixedBoardRedirect />} />
          <Route path="cases/:caseIdentifier" element={<UnprefixedBoardRedirect />} />
          <Route path="status" element={<UnprefixedBoardRedirect />} />
          <Route path="status/:cardId" element={<UnprefixedBoardRedirect />} />
          <Route path="status-cards" element={<UnprefixedBoardRedirect />} />
          <Route path="status-cards/:cardId" element={<UnprefixedBoardRedirect />} />
          <Route path="artifacts" element={<UnprefixedBoardRedirect />} />
          <Route path="audit" element={<UnprefixedBoardRedirect />} />
          {streamlinedUiEnabled ? (
            <>
              <Route path="audit/*" element={<UnprefixedBoardRedirect />} />
              <Route path="activity" element={<UnprefixedBoardRedirect />} />
              <Route path="activity/*" element={<UnprefixedBoardRedirect />} />
              <Route path="runs" element={<UnprefixedBoardRedirect />} />
              <Route path="costs" element={<UnprefixedBoardRedirect />} />
              <Route path="budgets" element={<UnprefixedBoardRedirect />} />
            </>
          ) : null}
          <Route path="decisions" element={<UnprefixedBoardRedirect />} />
          <Route path="u/:userSlug" element={<UnprefixedBoardRedirect />} />
          <Route path="skills/studio" element={<UnprefixedBoardRedirect />} />
          <Route path="skills/studio/new" element={<UnprefixedBoardRedirect />} />
          <Route path="skills/studio/:skillId" element={<UnprefixedBoardRedirect />} />
          <Route path="skills/:skillId/studio" element={<UnprefixedBoardRedirect />} />
          <Route path="skills/*" element={<UnprefixedBoardRedirect />} />
          <Route path="settings" element={<LegacySettingsRedirect />} />
          <Route path="settings/*" element={<LegacySettingsRedirect />} />
          <Route path="agents" element={<UnprefixedBoardRedirect />} />
          {AGENT_FILTER_TABS.map((tab) => (
            <Route key={tab} path={`agents/${tab}`} element={<UnprefixedBoardRedirect />} />
          ))}
          <Route path="agents/new" element={<UnprefixedBoardRedirect />} />
          <Route path="agents/:agentId" element={<UnprefixedBoardRedirect />} />
          <Route path="agents/:agentId/:tab" element={<UnprefixedBoardRedirect />} />
          <Route path="agents/:agentId/runs/:runId" element={<UnprefixedBoardRedirect />} />
          <Route path="projects/*" element={<Navigate to="/spaces" replace />} />
          <Route path="workspaces" element={<UnprefixedBoardRedirect />} />
          <Route path="execution-workspaces/:workspaceId" element={<UnprefixedExecutionWorkspaceRedirect />} />
          <Route path="execution-workspaces/:workspaceId/services" element={<UnprefixedExecutionWorkspaceRedirect />} />
          <Route path="execution-workspaces/:workspaceId/configuration" element={<UnprefixedExecutionWorkspaceRedirect />} />
          <Route path="execution-workspaces/:workspaceId/runtime-logs" element={<UnprefixedExecutionWorkspaceRedirect />} />
          <Route path="execution-workspaces/:workspaceId/issues" element={<UnprefixedExecutionWorkspaceRedirect />} />
          <Route path="execution-workspaces/:workspaceId/routines" element={<UnprefixedExecutionWorkspaceRedirect />} />
          <Route path=":companyPrefix" element={streamlinedUiEnabled ? <Layout /> : <ProductionLayout />}>
            {boardRoutes(streamlinedUiEnabled, combinedInboxTasksEnabled)}
          </Route>
          <Route path="*" element={<NotFoundPage scope="global" />} />
          </Route>
        </Route>
      </Routes></Suspense>
    </>
  );
}
