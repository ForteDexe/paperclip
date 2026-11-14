import type { CSSProperties } from "react";
import { Settings } from "lucide-react";
import type { DeploymentMode } from "@outpost/shared";

import { Link } from "@/lib/router";
import { useSidebar } from "../context/SidebarContext";
import { cn, SIDEBAR_RAIL_HIDDEN_LABEL } from "../lib/utils";
import { ThemeToggle } from "./ThemeToggle";

interface SidebarAccountMenuProps {
  /** Retained for callers shared with authenticated deployments. */
  deploymentMode?: DeploymentMode;
  /** Retained for compatibility with the former controlled account popover. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Contextual navigation occupies a full sidebar even if the saved global nav mode is collapsed. */
  forceExpanded?: boolean;
  /** Retained for compatibility with design-preview callers. */
  shadow?: CSSProperties["boxShadow"];
}

/**
 * Permanent sidebar actions. Outpost has no human profile/account surface:
 * settings and appearance are available directly without an intermediate menu.
 */
export function SidebarAccountMenu({ forceExpanded = false }: SidebarAccountMenuProps) {
  const { isMobile, setSidebarOpen, collapsed, peeking } = useSidebar();
  const rail = collapsed && !peeking && !forceExpanded;

  function closeMobileSidebar() {
    if (isMobile) setSidebarOpen(false);
  }

  return (
    <div data-sidebar-actions="" className="bg-border/50 px-3 py-2 dark:bg-muted">
      <div className={cn("flex items-center gap-0.5", !rail && "px-2")}>
        <Link
          to="/company/settings"
          onClick={closeMobileSidebar}
          aria-label="Settings"
          title={rail ? "Settings" : undefined}
          className={cn(
            "flex min-w-0 items-center gap-2.5 rounded-lg text-left text-(length:--text-compact) font-medium text-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            rail ? "w-full justify-center px-3 py-2" : "flex-1 px-2 py-1.5",
          )}
        >
          <span className="flex size-6 shrink-0 items-center justify-center">
            <Settings className="size-4" aria-hidden="true" />
          </span>
          <span className={cn("min-w-0 flex-1 truncate", rail && SIDEBAR_RAIL_HIDDEN_LABEL)}>
            Settings
          </span>
        </Link>
        {!rail ? (
          <ThemeToggle className="shrink-0 text-muted-foreground/70 hover:text-sidebar-accent-foreground" />
        ) : null}
      </div>
    </div>
  );
}
