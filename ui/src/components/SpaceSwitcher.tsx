import { ChevronsUpDown, Plus, RefreshCw, Settings } from "lucide-react";
import { Link } from "@/lib/router";
import { useSpace } from "../context/SpaceContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useState } from "react";

function statusDotColor(status?: string): string {
  switch (status) {
    case "active":
      return "bg-green-400";
    case "paused":
      return "bg-yellow-400";
    case "archived":
      return "bg-neutral-400";
    default:
      return "bg-green-400";
  }
}

interface SpaceSwitcherProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function SpaceSwitcher({ open: controlledOpen, onOpenChange }: SpaceSwitcherProps = {}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const { spaces, selectedSpace, setSelectedSpaceId, spaceListUnavailable, retrySpaces } =
    useSpace();
  const sidebarSpaces = spaces.filter((space) => space.status !== "archived");
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="w-full justify-between px-2 py-1.5 h-auto text-left"
        >
          <div className="flex items-center gap-2 min-w-0">
            {selectedSpace && (
              <span className={`h-2 w-2 rounded-full shrink-0 ${statusDotColor(selectedSpace.status)}`} />
            )}
            <span className="text-sm font-medium truncate">
              {selectedSpace?.name ?? "Select outpost"}
            </span>
          </div>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-(--sz-220px)">
        <DropdownMenuLabel>Outposts</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {sidebarSpaces.map((space) => (
          <DropdownMenuItem
            key={space.id}
            onClick={() => setSelectedSpaceId(space.id)}
            className={space.id === selectedSpace?.id ? "bg-accent" : ""}
          >
            <span className={`h-2 w-2 rounded-full shrink-0 mr-2 ${statusDotColor(space.status)}`} />
            <span className="truncate">{space.name}</span>
          </DropdownMenuItem>
        ))}
        {sidebarSpaces.length === 0 && (
          // "No spaces" is a claim about the account, and after a failed list
          // request it is one we cannot make — say what actually happened and
          // give the customer the way out, since nothing else in the app does.
          spaceListUnavailable ? (
            <>
              <DropdownMenuItem disabled>Couldn't load outposts</DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(event) => {
                  // Keep the menu open so the result of the retry is visible.
                  event.preventDefault();
                  void retrySpaces?.();
                }}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Try again
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem disabled>No outposts</DropdownMenuItem>
          )
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/space/settings" className="no-underline text-inherit">
            <Settings className="h-4 w-4 mr-2" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/spaces" className="no-underline text-inherit">
            <Plus className="h-4 w-4 mr-2" />
            Manage Outposts
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
