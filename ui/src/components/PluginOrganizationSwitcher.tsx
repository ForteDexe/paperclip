import { useState, type ReactNode } from "react";
import { ChevronsUpDown } from "lucide-react";
import type { PluginOrganizationSwitcherProps } from "@outpost/plugin-sdk/ui";
import { useAccountIdentity, useSpaceListQuery } from "@/api/spaces-query";
import { useSpace } from "@/context/SpaceContext";
import { useSidebar } from "@/context/SidebarContext";
import { useSignOut } from "@/hooks/useSignOut";
import { PluginSlotMount, usePluginSlots } from "@/plugins/slots";
import { SpacePatternIcon } from "./SpacePatternIcon";
import { Skeleton } from "./ui/skeleton";

/** Reserve the trigger's space until its owner is known. Never flash another name. */
function OrganizationSwitcherLoading({ collapsed }: { collapsed: boolean }) {
  return <div role="status" aria-label="Loading outpost" aria-busy="true"
    className="flex h-9 min-w-0 flex-1 items-center gap-2 px-4">
    <Skeleton className="size-5 shrink-0" />
    {!collapsed && <>
      <span className="min-w-0 flex-1"><Skeleton className="h-4 w-20 max-w-full" /></span>
      <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
    </>}
  </div>;
}

/** Optional replacement; use the built-in menu when discovery or rendering fails. */
export function PluginOrganizationSwitcher({ children, open: controlledOpen, onOpenChange }: {
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const { userId, settled, failed } = useAccountIdentity();
  const { selectedSpaceId } = useSpace();
  const spaceList = useSpaceListQuery();
  // Selection is component state and can outlive its account until an effect
  // clears it. Resolve it against this account's query before mounting plugins.
  const selectedSpace = spaceList.data?.spaces.find(space => space.id === selectedSpaceId) ?? null;
  const contextSettled = settled && spaceList.isSuccess && !spaceList.data?.unauthorized
    && (selectedSpaceId === null || selectedSpace !== null);
  const contextLoading = !contextSettled && !failed && !spaceList.isError && !spaceList.data?.unauthorized; // query-error-ok: loading gate;on error the built-in fallback renders
  return (
    <OrganizationSwitcher key={JSON.stringify([userId, selectedSpaceId])}
      settled={contextSettled} loading={contextLoading} spaceId={selectedSpaceId}
      space={selectedSpace} open={controlledOpen} onOpenChange={onOpenChange}>
      {children}
    </OrganizationSwitcher>
  );
}

function OrganizationSwitcher({ children, settled, loading, spaceId, space, open: controlledOpen, onOpenChange }: {
  children: ReactNode; settled: boolean; loading: boolean; spaceId: string | null;
  space: { name: string; issuePrefix: string; logoUrl?: string | null } | null;
  open?: boolean; onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const { isMobile, setSidebarOpen, collapsed, peeking } = useSidebar();
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  function closeNavigation() {
    setOpen(false);
    if (isMobile) setSidebarOpen(false);
  }
  const signOut = useSignOut({ onSignedOut: closeNavigation });
  const { slots, isLoading, errorMessage } = usePluginSlots({ slotTypes: ["organizationSwitcher"], spaceId, enabled: settled });
  if (loading || (settled && isLoading && !errorMessage)) {
    return <OrganizationSwitcherLoading collapsed={collapsed && !peeking} />;
  }
  // Never choose an arbitrary winner for a replacement surface.
  if (!settled || errorMessage || slots.length !== 1) return children;
  const props: PluginOrganizationSwitcherProps = {
    organizationSwitcher: {
      currentSpace: space ? { name: space.name, logoUrl: space.logoUrl ?? null } : null,
      collapsed: collapsed && !peeking, open, onOpenChange: setOpen,
      onNavigate: closeNavigation, onSignOut: () => signOut.mutate(), signingOut: signOut.isPending,
      renderIcon: (name, logoUrl, inMenu) => <SpacePatternIcon spaceName={name} logoUrl={logoUrl}
        className={inMenu
          ? "size-(--outpost-popover-avatar-size) shrink-0 rounded-lg text-(length:--text-micro)"
          : "size-5 shrink-0 rounded-md text-(length:--text-micro)"} />,
    },
  };
  return <PluginSlotMount slot={slots[0]!}
    context={{ spaceId, spacePrefix: space?.issuePrefix ?? null }}
    componentProps={{ ...props }} fallback={children} />;
}
