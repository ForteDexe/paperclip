import { useAccountIdentity } from "@/api/spaces-query";
import { useSpace } from "@/context/SpaceContext";
import { useDialogActions } from "@/context/DialogContext";
import { useRecentTasks } from "@/hooks/useRecentTasks";
import { useRecentTaskOpenWarmup } from "@/hooks/useRecentTaskOpenWarmup";
import { DesignSidebar } from "./DesignSidebar";

/** Data adapter only; the visual subject is Components / Sidebar. */
export function DesignSandboxSidebar() {
  const { selectedSpaceId } = useSpace();
  const { userId } = useAccountIdentity();
  const { openNewIssue } = useDialogActions();
  const { entries } = useRecentTasks({ spaceId: selectedSpaceId, userId });
  useRecentTaskOpenWarmup({ spaceId: selectedSpaceId, userId, tasks: entries });
  return <DesignSidebar recentTasks={entries} onNewTask={() => openNewIssue()} />;
}
