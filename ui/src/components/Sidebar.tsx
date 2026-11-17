import {
  Inbox,
  ListChecks,
  CircleCheck,
  Target,
  LayoutDashboard,
  Search,
  SquarePen,
  Network,
  Repeat,
  Layers,
  FolderOpen,
  Package,
  Settings,
  MessageCircle,
  Users,
  Flame,
  Boxes,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { productLabel } from "@outpost/shared/product-vocabulary";
import { SidebarSection } from "./SidebarSection";
import { SidebarNavItem } from "./SidebarNavItem";
import { SidebarAgents } from "./SidebarAgents";
import { useAgentChatEnabled } from "@/hooks/useAgentChatEnabled";
import { useAgentChatNavigation } from "@/hooks/useAgentChatNavigation";
import { SidebarRecentTasks } from "./SidebarRecentTasks";
import { useDialogActions } from "../context/DialogContext";
import { useSpace } from "../context/SpaceContext";
import { useSidebar } from "../context/SidebarContext";
import { attentionApi } from "../api/attention";
import { heartbeatsApi } from "../api/heartbeats";
import { instanceSettingsApi } from "../api/instanceSettings";
import { queryKeys } from "../lib/queryKeys";
import { attentionBadgeCount } from "../lib/attention";
import { useInboxBadge } from "../hooks/useInboxBadge";
import { useStreamlinedUiEnabled } from "../hooks/useStreamlinedUiEnabled";
import { usePublishSharedQueryData, useSharedPollingQuery } from "../hooks/useSharedPolling";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn, SIDEBAR_RAIL_HIDDEN_LABEL } from "../lib/utils";
import { PluginSlotOutlet } from "@/plugins/slots";
import { PluginLauncherOutlet } from "@/plugins/launchers";
import { SidebarSpaceMenu } from "./SidebarSpaceMenu";
import { primarySidebarStyles } from "./primary-sidebar-styles";

const sidebarVocabulary = {
  space: productLabel("space"),
  spaces: productLabel("space", { count: 2 }),
  tasks: productLabel("task", { count: 2 }),
  decisions: productLabel("decision", { count: 2 }),
  artifacts: productLabel("artifact", { count: 2 }),
  cases: productLabel("case", { count: 2 }),
  northStars: productLabel("northStar", { count: 2 }),
  agents: productLabel("agent", { count: 2 }),
};

export function Sidebar({ children }: { children?: ReactNode }) {
  return <ClassicSidebar>{children}</ClassicSidebar>;
}

function ClassicSidebar({ children }: { children?: ReactNode }) {
  const { openNewIssue } = useDialogActions();
  const { enabled: agentChatEnabled } = useAgentChatEnabled();
  const chatNavigation = useAgentChatNavigation();
  const unreadChatCount = chatNavigation.chats.data?.filter(chat => chat.isUnreadForMe).length ?? 0;
  // Every labeled section is collapsible (session-scoped, default open) —
  // one policy across static nav groups and the data-driven sections.
  const [workOpen, setWorkOpen] = useState(true);
  const [organizationOpen, setOrganizationOpen] = useState(true);
  const { selectedSpaceId, selectedSpace } = useSpace();
  const { collapsed, peeking } = useSidebar();
  const { enabled: streamlinedUiEnabled } = useStreamlinedUiEnabled();
  const rail = collapsed && !peeking;
  const inboxBadge = useInboxBadge(selectedSpaceId);
  const { data: experimentalSettings } = useQuery({
    queryKey: queryKeys.instance.experimentalSettings,
    queryFn: () => instanceSettingsApi.getExperimental(),
  });
  const liveRunsQueryKey = queryKeys.liveRuns(selectedSpaceId!);
  const sharedLiveRuns = useSharedPollingQuery({
    spaceId: selectedSpaceId,
    resourceKey: "live-runs",
    queryKey: liveRunsQueryKey,
    enabled: !!selectedSpaceId,
    // Event-sourced via LiveUpdatesProvider (GitHub issue 9627) + reconnect reconcile — no
    // interval poll needed. Polling here also re-armed React Query's timer on
    // every live-event cache write, a major source of steady-state churn.
    refetchInterval: false,
    leaderOnly: true,
  });
  const { data: liveRuns, dataUpdatedAt: liveRunsUpdatedAt } = useQuery({
    queryKey: liveRunsQueryKey,
    queryFn: () => heartbeatsApi.liveRunsForSpace(selectedSpaceId!),
    enabled: sharedLiveRuns.enabled,
    refetchInterval: sharedLiveRuns.refetchInterval,
  });
  usePublishSharedQueryData(sharedLiveRuns, liveRuns, liveRunsUpdatedAt);
  const liveRunCount = liveRuns?.length ?? 0;
  const liveIssueIds = new Set(
    (liveRuns ?? []).flatMap((run) => run.issueId ? [run.issueId] : []),
  );
  const chatRail = agentChatEnabled && streamlinedUiEnabled;
  // The merged Tasks page only exists in the streamlined shell, so the legacy
  // shell keeps its Inbox row even with the flag on.
  const combinedInboxTasks = streamlinedUiEnabled && experimentalSettings?.enableCombinedInboxTasks === true;
  const goalsLinkPending = experimentalSettings === undefined;
  const showGoalsLink = experimentalSettings?.enableGoalsSidebarLink === true;
  // Decisions (attention home) is an experimental surface (PAP-13481): the nav
  // item is hidden entirely until the flag is enabled (same no-flash pattern as
  // showWorkspacesLink — it defaults hidden, so no placeholder is needed).
  const showDecisions = experimentalSettings?.enableDecisions === true;
  const { data: attentionFeed } = useQuery({
    queryKey: queryKeys.attention(selectedSpaceId!),
    queryFn: () => attentionApi.list(selectedSpaceId!),
    enabled: !!selectedSpaceId && showDecisions,
    refetchInterval: 60_000,
  });
  const attentionCount = attentionBadgeCount(attentionFeed);
  const showCases = experimentalSettings?.enableCases === true;
  const showCampfire = experimentalSettings?.enableCampfire === true;

  const pluginContext = {
    spaceId: selectedSpaceId,
    spacePrefix: selectedSpace?.issuePrefix ?? null,
  };

  return (
    <aside
      className={cn(
        "w-full h-full min-h-0 flex flex-col",
        streamlinedUiEnabled
          ? primarySidebarStyles.surface
          : "border-r border-border bg-background",
      )}
    >
      {/* Top bar: space name, aligned with top sections and borderless.
          Search deliberately does NOT live here:
          the header's spare width goes to the workspace/organization name,
          which is the user's orientation anchor and truncates otherwise.
          Search is the first nav item below instead. */}
      <div className="flex h-(--sz-60px) shrink-0 items-center gap-1 px-3">
        <SidebarSpaceMenu />
      </div>

      <nav className={primarySidebarStyles.nav}>
        <div className={primarySidebarStyles.group}>
          {/* New Task button aligned with nav items */}
          {(() => {
            const newTaskButton = (
              <button
                onClick={() => openNewIssue()}
                data-slot="icon-button"
                aria-label={rail ? "New Task" : undefined}
                className={cn(
                  "flex items-center gap-2.5 mx-2 rounded-lg px-2 py-1.5 pointer-coarse:py-1 text-(length:--text-compact) font-medium text-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                )}
              >
                <SquarePen className="h-4 w-4 shrink-0" />
                <span className={rail ? SIDEBAR_RAIL_HIDDEN_LABEL : "truncate"}>New Task</span>
              </button>
            );
            return rail ? (
              <Tooltip>
                <TooltipTrigger asChild>{newTaskButton}</TooltipTrigger>
                <TooltipContent side="right">New Task</TooltipContent>
              </Tooltip>
            ) : (
              newTaskButton
            );
          })()}
          {/* Search moved out of the header so the workspace name keeps the
              width; a nav row also keeps search reachable from the
              collapsed rail, where the old header icon was dropped entirely.
              Cmd/Ctrl+K remains the keyboard path (command palette). */}
          <SidebarNavItem to="/search" label="Search" icon={Search} />
          <SidebarNavItem to="/dashboard" label="Dashboard" icon={LayoutDashboard} liveCount={liveRunCount} />
          {!combinedInboxTasks ? (
            <SidebarNavItem
              to="/inbox"
              label="Inbox"
              icon={Inbox}
              badge={inboxBadge.inbox}
              badgeLabel="unread"
              badgeTone={inboxBadge.failedRuns > 0 ? "danger" : "default"}
              alert={inboxBadge.failedRuns > 0}
            />
          ) : null}
          {agentChatEnabled && !chatRail ? <SidebarNavItem to="/chats" label="Chat" icon={MessageCircle} badge={unreadChatCount} badgeLabel="unread chats" /> : null}
          {showDecisions ? (
            <SidebarNavItem
              to="/decisions"
              label={sidebarVocabulary.decisions}
              icon={ListChecks}
              badge={attentionCount}
              badgeLabel="decisions"
            />
          ) : null}
        </div>

        <SidebarSection label="Work" collapsible={{ open: workOpen, onOpenChange: setWorkOpen }}>
          {/* Agent Chat: Chat leads the Work group as a single row — the
              agents you talk to live in the Chat surface's own secondary rail
              (ChatContextualSidebar), not in the primary nav. */}
          {chatRail ? (
            <SidebarNavItem to="/chats" label="Chat" icon={MessageCircle} badge={unreadChatCount} badgeLabel="unread chats" />
          ) : null}
          {showCampfire ? <SidebarNavItem to="/campfire" label="Campfire" icon={Flame} /> : null}
          {/* Combined Inbox + Task List: Inbox is a view inside Tasks, so the
              unread/failed-run badge rides on Tasks. */}
          {combinedInboxTasks ? (
            <SidebarNavItem
              to="/issues"
              label={sidebarVocabulary.tasks}
              icon={CircleCheck}
              badge={inboxBadge.inbox}
              badgeLabel="unread"
              badgeTone={inboxBadge.failedRuns > 0 ? "danger" : "default"}
              alert={inboxBadge.failedRuns > 0}
            />
          ) : (
            <SidebarNavItem to="/issues" label={sidebarVocabulary.tasks} icon={CircleCheck} />
          )}
          <SidebarNavItem to="/spaces" label={sidebarVocabulary.spaces} icon={FolderOpen} />
          <SidebarNavItem to="/routines" label="Routines" icon={Repeat} />
          <SidebarNavItem to="/artifacts" label={sidebarVocabulary.artifacts} icon={Package} />
          {showCases ? (
            <SidebarNavItem to="/cases" label={sidebarVocabulary.cases} icon={Layers} textBadge="beta" />
          ) : null}
          {showGoalsLink ? (
            <SidebarNavItem to="/goals" label={sidebarVocabulary.northStars} icon={Target} />
          ) : goalsLinkPending ? (
            <div
              data-testid="sidebar-goals-placeholder"
              className="h-8 pointer-coarse:h-7"
              aria-hidden="true"
            />
          ) : null}
          <PluginSlotOutlet
            slotTypes={["sidebar"]}
            context={pluginContext}
            className="flex flex-col gap-0.5"
            itemClassName="text-(length:--text-compact) font-medium"
            missingBehavior="placeholder"
          />
          <PluginLauncherOutlet
            placementZones={["sidebar"]}
            context={pluginContext}
            className="flex flex-col gap-0.5"
            itemClassName="text-(length:--text-compact) font-medium"
          />
        </SidebarSection>

        {streamlinedUiEnabled ? (
          <SidebarSection
            label={sidebarVocabulary.space}
            collapsible={{ open: organizationOpen, onOpenChange: setOrganizationOpen }}
          >
            <SidebarNavItem to="/agents" label={sidebarVocabulary.agents} icon={Users} />
            <SidebarNavItem to="/skills" label="Skills" icon={Boxes} />
          </SidebarSection>
        ) : null}

        {children ?? (streamlinedUiEnabled ? <SidebarAgents streamlined /> : null)}

        {streamlinedUiEnabled ? (
          <SidebarRecentTasks spaceId={selectedSpaceId} liveIssueIds={liveIssueIds} />
        ) : (
          <>
            <SidebarAgents />
            <SidebarSection
              label={sidebarVocabulary.space}
              collapsible={{ open: organizationOpen, onOpenChange: setOrganizationOpen }}
            >
              <SidebarNavItem to="/agent-hierarchy" label="Crew map" icon={Network} />
              <SidebarNavItem to="/space/settings" label="Settings" icon={Settings} />
            </SidebarSection>
          </>
        )}

        <PluginSlotOutlet
          slotTypes={["sidebarPanel"]}
          context={pluginContext}
          className="flex flex-col gap-3"
          itemClassName="rounded-lg border border-border p-3"
          missingBehavior="placeholder"
        />
      </nav>
    </aside>
  );
}
