import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Check,
  ChevronsUpDown,
  GripVertical,
  LogOut,
  RefreshCw,
  Plus,
} from "lucide-react";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Space } from "@outpost/shared";
import { Link, useLocation, useNavigate } from "@/lib/router";
import { authApi } from "@/api/auth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSpace } from "@/context/SpaceContext";
import { useSpaceOrder } from "@/hooks/useSpaceOrder";
import { useSignOut } from "@/hooks/useSignOut";
import { queryKeys } from "@/lib/queryKeys";
import { cn, SIDEBAR_RAIL_HIDDEN_LABEL } from "@/lib/utils";
import { useSidebar } from "../context/SidebarContext";
import { SpacePatternIcon } from "./SpacePatternIcon";

import { PluginOrganizationSwitcher } from "./PluginOrganizationSwitcher";

interface SidebarSpaceMenuProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const TRIGGER_WORKSPACE_ICON_CLASS = "size-5 shrink-0 rounded-md text-(length:--text-micro)";
const POPOVER_WORKSPACE_ICON_CLASS =
  "size-(--organization-popover-avatar-size) shrink-0 rounded-lg text-(length:--text-micro)";
const ORGANIZATION_ROW_CLASS =
  "h-(--organization-popover-space-row-height) min-w-0 gap-(--organization-popover-row-gap) rounded-lg px-2.5 py-0 text-(length:--text-compact) focus:bg-accent/50 focus:text-foreground";
const ORGANIZATION_ACTION_CLASS =
  "h-(--organization-popover-action-row-height) gap-(--organization-popover-row-gap) rounded-lg px-2.5 py-0 text-(length:--text-compact) font-medium leading-(--organization-popover-action-line-height) text-foreground focus:bg-accent/50 focus:text-foreground";

function WorkspaceIcon({ space, inPopover = false }: { space: Space; inPopover?: boolean }) {
  return (
    <SpacePatternIcon
      spaceName={space.name}
      logoUrl={space.logoUrl}
      className={inPopover ? POPOVER_WORKSPACE_ICON_CLASS : TRIGGER_WORKSPACE_ICON_CLASS}
    />
  );
}

function SortableSpaceItem({
  space,
  isEditing,
  isSelected,
  onSelect,
}: {
  space: Space;
  isEditing: boolean;
  isSelected: boolean;
  onSelect: (space: Space) => void;
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: space.id, disabled: !isEditing });

  return (
    <DropdownMenuItem
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 10 : undefined,
      }}
      onSelect={(event) => {
        if (isEditing) {
          event.preventDefault();
          return;
        }
        onSelect(space);
      }}
      className={cn(
        ORGANIZATION_ROW_CLASS,
        isEditing && "cursor-grab",
        isDragging && "opacity-80",
      )}
    >
      <WorkspaceIcon space={space} inPopover />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium leading-(--organization-popover-name-line-height)">
          {space.name}
        </span>
        {isEditing ? null : (
          <span className="block truncate text-(length:--text-nano) leading-(--organization-popover-prefix-line-height) text-muted-foreground">
            {space.workspaceRoot ?? space.issuePrefix}
          </span>
        )}
      </span>
      {isEditing ? (
        <button
          type="button"
          ref={setActivatorNodeRef}
          aria-label={`Reorder ${space.name}`}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-(length:--rad-2) focus-visible:ring-ring"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" aria-hidden="true" />
        </button>
      ) : (
        <span className="flex size-5 shrink-0 items-center justify-center">
          {isSelected ? <Check className="size-4 text-foreground" /> : null}
        </span>
      )}
    </DropdownMenuItem>
  );
}

export function SidebarSpaceMenu(props: SidebarSpaceMenuProps = {}) {
  return (
    <PluginOrganizationSwitcher {...props}>
      <BuiltinSpaceMenu {...props} />
    </PluginOrganizationSwitcher>
  );
}

function BuiltinSpaceMenu({ open: controlledOpen, onOpenChange }: SidebarSpaceMenuProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [isEditingOrder, setIsEditingOrder] = useState(false);
  const { spaces, selectedSpace, setSelectedSpaceId, spaceListUnavailable, retrySpaces } =
    useSpace();
  const { isMobile, setSidebarOpen, collapsed, peeking } = useSidebar();
  const rail = collapsed && !peeking;
  const location = useLocation();
  const navigate = useNavigate();
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 6 },
    }),
  );
  const sidebarSpaces = useMemo(
    () => spaces.filter((space) => space.status !== "archived"),
    [spaces],
  );
  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
  });
  const currentUserId = session?.user?.id ?? session?.session?.userId ?? null;
  const { orderedSpaces, persistOrder } = useSpaceOrder({
    spaces: sidebarSpaces,
    userId: currentUserId,
  });

  const switcherNoun = "space";
  const currentName = selectedSpace?.name ?? null;

  const signOutMutation = useSignOut({ onSignedOut: closeNavigationChrome });

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) setIsEditingOrder(false);
    setOpen(nextOpen);
  }

  function closeNavigationChrome() {
    setOpen(false);
    setIsEditingOrder(false);
    if (isMobile) setSidebarOpen(false);
  }

  function selectSpace(space: Space) {
    const pathPrefix = location.pathname.split("/")[1]?.toUpperCase();
    const isSpaceRoute = sidebarSpaces.some((sidebarSpace) => (
      sidebarSpace.issuePrefix.toUpperCase() === pathPrefix
    ));
    const shouldLeaveCurrentRoute = space.id !== selectedSpace?.id
      && (location.pathname.startsWith("/instance/") || isSpaceRoute);

    setSelectedSpaceId(space.id);
    setOpen(false);
    if (isMobile) setSidebarOpen(false);
    if (shouldLeaveCurrentRoute) {
      navigate(`/${space.issuePrefix}/dashboard`);
    }
  }

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const ids = orderedSpaces.map((space) => space.id);
      const oldIndex = ids.indexOf(active.id as string);
      const newIndex = ids.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return;

      persistOrder(arrayMove(ids, oldIndex, newIndex));
    },
    [orderedSpaces, persistOrder],
  );

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          // The nav icon column sits at nav px-3 + item mx-2 + item px-2.
          // Match that inset with wrapper px-3 + trigger px-4. Override the
          // Button's direct-SVG padding too so the expanded chevron cannot pull
          // the avatar four pixels left of the nav icons.
          // `min-w-0` on every link of the flex chain (button → label row → label)
          // is what lets the name truncate: a flex item's default `min-width:auto`
          // floors it at its content width, so without it a long name widens the
          // trigger past the sidebar and pushes the chevron out of bounds.
          className="h-9 min-w-0 flex-1 justify-start gap-2 px-4 text-left hover:bg-accent/50 hover:text-foreground has-[>svg]:px-4 dark:hover:bg-accent/50"
          aria-label={
            currentName
              ? `Open ${currentName} ${switcherNoun} switcher`
              : `Open ${switcherNoun} switcher`
          }
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            {selectedSpace ? <WorkspaceIcon space={selectedSpace} /> : null}
            {/* The header has room for ~110px of name beside the collapse
                control (~142px on mobile, which hides it) — search moved to
                the nav to buy that width. A name that still
                truncates stays hover-recoverable via title. */}
            <span
              className={cn(
                "min-w-0 truncate text-sm font-bold text-foreground",
                rail && SIDEBAR_RAIL_HIDDEN_LABEL,
              )}
              title={currentName ?? undefined}
            >
              {currentName ?? `Select ${switcherNoun}`}
            </span>
          </span>
          {!rail && <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={8}
        className="ml-2 w-(--organization-popover-width) max-w-(--sz-calc-24) overflow-hidden rounded-xl border-border bg-popover p-0 shadow-(--shadow-profile-popover)"
      >
        <div className="flex h-(--organization-popover-header-height) items-center justify-between gap-2 px-3.5">
          <DropdownMenuLabel className="p-0 text-(length:--text-compact) font-semibold text-foreground">
            Spaces
          </DropdownMenuLabel>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setIsEditingOrder((current) => !current);
            }}
            className="rounded px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {isEditingOrder ? "Done" : "Edit"}
          </button>
        </div>
        <div className="flex max-h-96 flex-col gap-0.5 overflow-y-auto px-2.5 pb-2 pt-1">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={orderedSpaces.map((space) => space.id)}
              strategy={verticalListSortingStrategy}
            >
              {orderedSpaces.map((space) => (
                <SortableSpaceItem
                  key={space.id}
                  space={space}
                  isEditing={isEditingOrder}
                  isSelected={space.id === selectedSpace?.id}
                  onSelect={selectSpace}
                />
              ))}
            </SortableContext>
          </DndContext>
          {orderedSpaces.length === 0 ? (
            // "No spaces" is a claim about the account. After a failed
            // list request it is one we cannot make, and this menu is the
            // only place the customer can act on it — say what happened and
            // offer the way back.
            spaceListUnavailable ? (
              <>
                <DropdownMenuItem disabled>Couldn&apos;t load Spaces</DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(event) => {
                    // Keep the menu open so the result of the retry is visible.
                    event.preventDefault();
                    void retrySpaces();
                  }}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Try again
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem disabled>No Spaces</DropdownMenuItem>
            )
          ) : null}
        </div>
        <div className="flex flex-col gap-0.5 border-t border-border px-2.5 pb-2.5 pt-2">
          <DropdownMenuItem asChild disabled={isEditingOrder} className={ORGANIZATION_ACTION_CLASS}>
            <Link to="/spaces?new=1" onClick={() => closeNavigationChrome()}>
              <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground"><Plus className="size-4" /></span>
              <span className="min-w-0 flex-1 truncate">New Space</span>
            </Link>
          </DropdownMenuItem>
          {session?.session ? (
            <DropdownMenuItem
              className={ORGANIZATION_ACTION_CLASS}
              onClick={() => signOutMutation.mutate()}
              disabled={isEditingOrder || signOutMutation.isPending}
            >
              <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
                <LogOut className="size-4" />
              </span>
              <span className="min-w-0 flex-1 truncate">
                {signOutMutation.isPending ? "Signing out..." : "Sign out"}
              </span>
            </DropdownMenuItem>
          ) : null}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
