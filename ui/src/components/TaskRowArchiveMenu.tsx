import type { Issue } from "@outpost/shared";
import { Archive, ArchiveRestore, MoreHorizontal } from "lucide-react";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export function TaskRowArchiveMenu({
  issue,
  pending,
  onToggleArchive,
}: {
  issue: Issue;
  pending: boolean;
  onToggleArchive: (issue: Issue) => void;
}) {
  const archived = Boolean(issue.archivedAt);
  const label = archived ? "Unarchive task" : "Archive task";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`More actions for ${issue.identifier ?? issue.title}`}
          title="More task actions"
        >
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={pending} onSelect={() => onToggleArchive(issue)}>
          {archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
          {pending ? (archived ? "Unarchiving…" : "Archiving…") : label}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
