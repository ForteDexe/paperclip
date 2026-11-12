import { lazy } from "react";
import { useDialogActions, useDialogState } from "../context/DialogContext";
import { DeferredOverlay } from "./DeferredOverlay";
import { GitHubStarPrompt } from "./GitHubStarPrompt";
import { NewIssueDialog } from "./NewIssueDialog";

const NewGoalDialog = lazy(() => import("./NewGoalDialog").then((module) => ({ default: module.NewGoalDialog })));
const NewAgentDialog = lazy(() => import("./NewAgentDialog").then((module) => ({ default: module.NewAgentDialog })));

export function BoardDialogs() {
  const { newIssueOpen, newGoalOpen, newAgentOpen } = useDialogState();
  const { closeNewIssue, closeNewGoal, closeNewAgent } = useDialogActions();
  return <>
    <DeferredOverlay requested={newIssueOpen} title="New task" onClose={closeNewIssue}><NewIssueDialog /></DeferredOverlay>
    <DeferredOverlay requested={newGoalOpen} title="New north star" onClose={closeNewGoal}><NewGoalDialog /></DeferredOverlay>
    <DeferredOverlay requested={newAgentOpen} title="New agent" onClose={closeNewAgent}><NewAgentDialog /></DeferredOverlay>
    <GitHubStarPrompt />
  </>;
}
