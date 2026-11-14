export const PUBLIC_RUNNER_SCREENSHOT_MARKER = "public-runner-fixture" as const;

export interface PublicRunnerScreenshotTarget {
  chatAgentId?: string;
  issuePrefix: string | null | undefined;
  issueId: string | null | undefined;
  issueIdentifier: string | null | undefined;
  caseId?: string;
  caseIdentifier?: string;
}

export function isPublicRunnerScreenshotRoute(
  url: string,
  target: PublicRunnerScreenshotTarget,
) {
  try {
    if (!target.issuePrefix || !target.issueId) return false;
    const candidate = new URL(url);
    const issueReference = target.issueIdentifier ?? target.issueId;
    const expectedPath = `/${encodeURIComponent(target.issuePrefix)}/issues/${encodeURIComponent(issueReference)}`;
    const chatPath = target.chatAgentId ? `/${encodeURIComponent(target.issuePrefix)}/chats/${encodeURIComponent(target.chatAgentId)}` : null;
    const casePath = target.caseId ? `/${encodeURIComponent(target.issuePrefix)}/cases/${encodeURIComponent(target.caseIdentifier ?? target.caseId)}` : null;
    return (
      candidate.protocol === "http:" &&
      candidate.hostname === "127.0.0.1" &&
      (candidate.pathname === chatPath ||
        candidate.pathname === casePath ||
        candidate.pathname === expectedPath ||
        candidate.pathname === `${expectedPath}/`)
    );
  } catch {
    return false;
  }
}

/** The one zero-task Conference Room boundary has no source issue. Its resource identity
 * must be independently read through the actual signed-in page before capture. With the
 * experiment off, the old Conference Room link lands on this space's dashboard.
 */
export function isConferenceRoomOffBoundaryScreenshotRoute(url: string, target: {
  scenarioId: string; origin: string; spaceId: string; agentSpaceId: string;
  issuePrefix: string; agentId: string; authenticatedPersonId: string; conferenceRoomEnabled: boolean;
}) {
  try {
    const candidate = new URL(url), origin = new URL(target.origin);
    return target.scenarioId === "agent-chat.chat-disabled" && target.conferenceRoomEnabled === false && !!target.spaceId && target.agentSpaceId === target.spaceId
      && !!target.authenticatedPersonId && target.authenticatedPersonId !== "local-operator" && !!target.agentId && !!target.issuePrefix
      && origin.protocol === "http:" && origin.hostname === "127.0.0.1" && candidate.origin === origin.origin
      && !candidate.username && !candidate.password && !candidate.search && !candidate.hash
      && candidate.pathname === `/${encodeURIComponent(target.issuePrefix)}/dashboard`;
  } catch { return false; }
}
