/**
 * Product task threads and Agent Chat both use one-response-at-a-time chat
 * semantics. Skill tests retain the stricter execution harness lifecycle.
 */
export const TASK_CHAT_PRIOR_STATUS_CONTEXT_KEY = "taskChatPriorStatus";

export function usesChatTurnSemantics(issue: {
  conversationAgentId?: string | null;
  harnessKind?: string | null;
} | null | undefined): boolean {
  return Boolean(
    issue &&
      (issue.conversationAgentId || issue.harnessKind !== "skill_test"),
  );
}
