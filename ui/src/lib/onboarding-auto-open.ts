import type { Agent } from "@outpost/shared";
import { ONBOARDING_AGENT_STEP } from "./onboarding-route";

/** Resume only the draft this browser saved, while no completed agent exists. */
export function dashboardOnboardingOptions(
  spaceId: string,
  agents: Pick<Agent, "id" | "spaceId" | "pauseReason" | "status">[] | undefined,
  rawDraft: string | null,
): { spaceId: string; initialStep: 3 | 4 } | null {
  if (!agents) return null;
  if (agents.length === 0) return { spaceId, initialStep: ONBOARDING_AGENT_STEP };
  if (agents.some(agent => agent.pauseReason !== "setup" || agent.status === "terminated")) return null;
  try {
    const draft = JSON.parse(rawDraft ?? "null");
    if (draft?.createdSpaceId !== spaceId || draft.createdAgentId
      || !agents.some(agent => agent.id === draft.setupAgentId && agent.spaceId === spaceId)) return null;
    return { spaceId, initialStep: 4 };
  } catch {
    return null;
  }
}

/**
 * Which spaces have already been offered onboarding automatically.
 *
 * The dashboard opens onboarding for a space that has no agent. That is an
 * offer, and an offer that reappears after it is declined is not one, so each
 * space gets at most one.
 *
 * Module scope rather than state inside the dashboard, on purpose. A ref dies
 * with the component, so navigating away and back would offer again, and it
 * holds one space, so visiting a second agentless space and returning to
 * the first would too. A page reload does offer again, which is the right
 * scope: that is a new visit rather than the same one continuing.
 */
const offeredSpaceIds = new Set<string>();

/**
 * Records an offer, and reports whether it is the first one for this space.
 * Returns false when onboarding has already been offered, in which case the
 * caller must not open it again.
 */
export function claimOnboardingOffer(spaceId: string): boolean {
  if (offeredSpaceIds.has(spaceId)) return false;
  offeredSpaceIds.add(spaceId);
  return true;
}

/** Forget every offer. For tests, which must not inherit each other's state. */
export function resetOnboardingOffers(): void {
  offeredSpaceIds.clear();
}
