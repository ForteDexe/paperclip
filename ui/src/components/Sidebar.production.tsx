import {
  Inbox,
  ListChecks,
  CircleDot,
  Target,
  LayoutDashboard,
  Search,
  SquarePen,
  Network,
  Layers,
  FolderOpen,
  Package,
  Settings,
} from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { productLabel } from "@outpost/shared/product-vocabulary";
import { SidebarSection } from "./SidebarSection";
import { SidebarNavItem } from "./SidebarNavItem.production";
import { SidebarAgents } from "./SidebarAgents.production";
import { useDialogActions } from "../context/DialogContext";
import { useSpace } from "../context/SpaceContext";
import { useSidebar } from "../context/SidebarContext";
import { attentionApi } from "../api/attention";
import { heartbeatsApi } from "../api/heartbeats";
import { instanceSettingsApi } from "../api/instanceSettings";
import { queryKeys } from "../lib/queryKeys";
import { attentionBadgeCount } from "../lib/attention";
import { useInboxBadge } from "../hooks/useInboxBadge";
import { usePublishSharedQueryData, useSharedPollingQuery } from "../hooks/useSharedPolling";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn, SIDEBAR_RAIL_HIDDEN_LABEL } from "../lib/utils";
import { PluginSlotOutlet } from "@/plugins/slots";
import { PluginLauncherOutlet } from "@/plugins/launchers";
import { SidebarSpaceMenu } from "./SidebarSpaceMenu.production";

const sidebarVocabulary = {
  space: productLabel("space"),
  spaces: productLabel("space", { count: 2 }),
  tasks: productLabel("task", { count: 2 }),
  decisions: productLabel("decision", { count: 2 }),
  artifacts: productLabel("artifact", { count: 2 }),
  cases: productLabel("case", { count: 2 }),
  northStars: productLabel("northStar", { count: 2 }),
};

export function Sidebar() {
  const { openNewIssue } = useDialogActions();
  // Every labeled section is collapsible (session-scoped, default open) —
  // one policy across static nav groups and the data-driven sections.
  const [workOpen, setWorkOpen] = useState(true);
  const [spaceOpen, setSpaceOpen] = useState(true);
  const { selectedSpaceId, selectedSpace } = useSpace();
  const { collapsed, peeking } = useSidebar();
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
  // Streamlined left navigation (top-level Projects link + starred children) is
  // now the standard product sidebar (PAP-12472). The former experimental
  // opt-out was retired; classic per-project collapsible mode is no longer
  // user-selectable. Kept as a constant so the classic branch below stays as a
  // documented reference until it is fully removed. Routes are unaffected.
  const streamlined = true;

  const pluginContext = {
    spaceId: selectedSpaceId,
    spacePrefix: selectedSpace?.issuePrefix ?? null,
  };

  return (
    <aside className="w-full h-full min-h-0 border-r border-border bg-background flex flex-col">
      {/* Top bar: space name, aligned with top sections and borderless.
          Search deliberately does NOT live here:
          the header's spare width goes to the workspace/organization name,
          which is the user's orientation anchor and truncates otherwise.
          Search is the first nav item below instead. */}
      <div className="flex items-center gap-1 px-3 h-12 shrink-0">
        <SidebarSpaceMenu />
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto scrollbar-auto-hide flex flex-col gap-4 pointer-coarse:gap-3 px-3 py-2">
        <div className="flex flex-col gap-0.5">
          {/* New Task button aligned with nav items */}
          {(() => {
            const newTaskButton = (
              <button
                onClick={() => openNewIssue()}
                data-slot="icon-button"
                aria-label={rail ? "New Task" : undefined}
                className="flex items-center gap-2.5 mx-2 rounded-lg px-2 py-1.5 pointer-coarse:py-1 text-(length:--text-compact) font-medium text-foreground/80 hover:bg-accent/50 hover:text-foreground transition-colors"
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
          <SidebarNavItem
            to="/inbox"
            label="Inbox"
            icon={Inbox}
            badge={inboxBadge.inbox}
            badgeLabel="unread"
            badgeTone={inboxBadge.failedRuns > 0 ? "danger" : "default"}
            alert={inboxBadge.failedRuns > 0}
          />
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
          <SidebarNavItem to="/issues" label={sidebarVocabulary.tasks} icon={CircleDot} />
          <SidebarNavItem to="/spaces" label={sidebarVocabulary.spaces} icon={FolderOpen} />
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
          <SidebarNavItem to="/artifacts" label={sidebarVocabulary.artifacts} icon={Package} />
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

        <SidebarAgents streamlined={streamlined} />

        <SidebarSection label={sidebarVocabulary.space} collapsible={{ open: spaceOpen, onOpenChange: setSpaceOpen }}>
          <SidebarNavItem to="/agent-hierarchy" label="Crew map" icon={Network} />
          <SidebarNavItem to="/space/settings" label="Settings" icon={Settings} />
        </SidebarSection>

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
