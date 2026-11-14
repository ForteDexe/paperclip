import { AgentChats } from "./pages/AgentChats";
import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { Navigate, Outlet, Route, Routes, useLocation, useParams } from "@/lib/router";
import { Layout } from "./components/Layout";
import { CasesExperimentalGate } from "./components/CasesExperimentalGate";
import { HiddenSettingsPageGate } from "./components/HiddenSettingsPageGate";
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

const loadIssues = () => import("./pages/Issues").then((module) => ({ default: module.Issues }));
const Issues = lazy(loadIssues);
let issueDetailLoad: Promise<{ default: typeof import("./pages/IssueDetail").IssueDetail }> | undefined;
const loadIssueDetail = () =>
  (issueDetailLoad ??= import("./pages/IssueDetail").then((module) => ({ default: module.IssueDetail })));
const IssueDetail = lazy(loadIssueDetail);
const AgentChat = lazy(() => import("./pages/AgentChat").then((module) => ({ default: module.AgentChat })));
const loadInbox = () => import("./pages/Inbox").then((module) => ({ default: module.Inbox }));
const Inbox = lazy(loadInbox);
const Agents = lazy(() => import("./pages/Agents").then((module) => ({ default: module.Agents })));
const Cases = lazy(() => import("./pages/Cases").then((module) => ({ default: module.Cases })));
const CaseDetail = lazy(() => import("./pages/CaseDetail").then((module) => ({ default: module.CaseDetail })));
const Dashboard = lazy(() => import("./pages/Dashboard").then((module) => ({ default: module.Dashboard })));
const DashboardLive = lazy(() => import("./pages/DashboardLive").then((module) => ({ default: module.DashboardLive })));
const Companies = lazy(() => import("./pages/Companies").then((module) => ({ default: module.Companies })));
const AgentDetail = lazy(() => import("./pages/AgentDetailPage").then((module) => ({ default: module.AgentDetailPage })));
const Search = lazy(() => import("./pages/Search").then((module) => ({ default: module.Search })));
const Goals = lazy(() => import("./pages/Goals").then((module) => ({ default: module.Goals })));
const Artifacts = lazy(() => import("./pages/Artifacts").then((module) => ({ default: module.Artifacts })));
const GoalDetail = lazy(() => import("./pages/GoalDetail").then((module) => ({ default: module.GoalDetail })));
const Approvals = lazy(() => import("./pages/Approvals").then((module) => ({ default: module.Approvals })));
const ApprovalDetail = lazy(() => import("./pages/ApprovalDetail").then((module) => ({ default: module.ApprovalDetail })));
const WhatNeedsMe = lazy(() => import("./pages/WhatNeedsMe").then((module) => ({ default: module.WhatNeedsMe })));
const DecisionQueuePage = lazy(() => import("./pages/DecisionQueuePage").then((module) => ({ default: module.DecisionQueuePage })));
const CompanySettings = lazy(() => import("./pages/CompanySettings").then((module) => ({ default: module.CompanySettings })));
const CompanySettingsPluginPage = lazy(() => import("./pages/CompanySettingsPluginPage").then((module) => ({ default: module.CompanySettingsPluginPage })));
const InstanceExperimentalSettings = lazy(() => import("./pages/InstanceExperimentalSettings").then((module) => ({ default: module.InstanceExperimentalSettings })));
const PluginManager = lazy(() => import("./pages/PluginManager").then((module) => ({ default: module.PluginManager })));
const PluginSettings = lazy(() => import("./pages/PluginSettings").then((module) => ({ default: module.PluginSettings })));
const AdapterManager = lazy(() => import("./pages/AdapterManager").then((module) => ({ default: module.AdapterManager })));
const PluginPage = lazy(() => import("./pages/PluginPage").then((module) => ({ default: module.PluginPage })));
const NewAgent = lazy(() => import("./pages/NewAgent").then((module) => ({ default: module.NewAgent })));


const ProductionAgents = lazy(() => import("./pages/Agents.production").then((module) => ({ default: module.Agents })));
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
      <Route path="timeline" element={<Navigate to="/dashboard" replace />} />
      <Route path="onboarding" element={<Navigate to="../dashboard" replace />} />
      <Route path="spaces" element={<Companies />} />
      <Route path="companies" element={<Navigate to="/spaces" replace />} />
      <Route path="company/settings" element={<CompanySettings />} />
      <Route path="company/settings/connections" element={<Navigate to="/company/settings" replace />} />
      <Route path="company/settings/environments" element={<Navigate to="/company/settings" replace />} />
      <Route path="company/settings/cloud-upstream" element={<Navigate to="/company/export" replace />} />
      <Route path="company/settings/members" element={<Navigate to="/company/settings" replace />} />
      <Route path="company/settings/access" element={<Navigate to="/company/settings" replace />} />
      <Route path="company/settings/invites" element={<Navigate to="/company/settings" replace />} />
      <Route path="company/export/*" element={<Navigate to="/company/settings" replace />} />
      <Route path="company/import" element={<Navigate to="/company/settings" replace />} />
      <Route path="company/settings/secrets" element={<Navigate to="/company/settings" replace />} />
      <Route path="company/settings/tools/*" element={<Navigate to="/dashboard" replace />} />
      <Route path="tools/*" element={<Navigate to="/dashboard" replace />} />
      <Route path="apps/*" element={<Navigate to="/dashboard" replace />} />
      <Route path="company/settings/instance" element={<Navigate to="/company/settings" replace />} />
      <Route path="company/settings/instance/profile" element={<Navigate to="/company/settings" replace />} />
      <Route path="company/settings/instance/general" element={<Navigate to="/company/settings" replace />} />
      <Route path="company/settings/instance/heartbeats" element={<Navigate to="/company/settings" replace />} />
      <Route path="company/settings/instance/environments/*" element={<Navigate to="/company/settings" replace />} />
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
      <Route path="skills/*" element={<Navigate to="/dashboard" replace />} />
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
      <Route path="workspaces" element={<Navigate to="/dashboard" replace />} />
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
      <Route path="routines" element={<Navigate to="/dashboard" replace />} />
      <Route
        path="cases"
        element={<CasesExperimentalGate><Cases /></CasesExperimentalGate>}
      />
      <Route
        path="cases/:caseIdentifier"
        element={<CasesExperimentalGate><CaseDetail /></CasesExperimentalGate>}
      />
      <Route path="status" element={<Navigate to="/dashboard" replace />} />
      <Route path="status/:cardId" element={<Navigate to="/dashboard" replace />} />
      {/* Back-compat: the board lived at /status-cards before PAP-15223. */}
      <Route path="status-cards" element={<Navigate to="/dashboard" replace />} />
      <Route path="status-cards/:cardId" element={<Navigate to="/dashboard" replace />} />
      <Route path="routines/:routineId" element={<Navigate to="/dashboard" replace />} />
      <Route path="routines/:routineId/:section" element={<Navigate to="/dashboard" replace />} />
      <Route path="execution-workspaces/:workspaceId/*" element={<Navigate to="/dashboard" replace />} />
      <Route path="goals" element={<Goals />} />
      <Route path="goals/:goalId" element={<GoalDetail />} />
      <Route path="artifacts" element={<Artifacts />} />
      <Route path="approvals" element={<Navigate to="/approvals/pending" replace />} />
      <Route path="approvals/pending" element={<Approvals />} />
      <Route path="approvals/all" element={<Approvals />} />
      <Route path="approvals/:approvalId" element={<ApprovalDetail />} />
      <Route path="activity/*" element={<Navigate to="/dashboard" replace />} />
      <Route path="audit/*" element={<Navigate to="/dashboard" replace />} />
      <Route path="runs" element={<Navigate to="/dashboard" replace />} />
      <Route path="costs" element={<Navigate to="/dashboard" replace />} />
      <Route path="budgets" element={<Navigate to="/dashboard" replace />} />
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
      <Route path="design-guide" element={<Navigate to="/dashboard" replace />} />
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
          <Route path="execution-workspaces/:workspaceId/*" element={<UnprefixedBoardRedirect />} />
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
