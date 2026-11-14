import type { InboxAgentPolicy, UpdateInboxAgentPolicy } from "@outpost/shared";
import { api } from "./client";

/**
 * "Let agents tidy my inbox" policy. Backed by per-user endpoints: `open`
 * lets any of my agents archive from my inbox,
 * `allowlist` restricts to the named agents, `disabled` turns it off.
 */
export const inboxAgentPolicyApi = {
  getMine: (spaceId: string) =>
    api.get<InboxAgentPolicy>(`/spaces/${spaceId}/users/me/inbox-agent-policy`),
  updateMine: (spaceId: string, input: UpdateInboxAgentPolicy) =>
    api.put<InboxAgentPolicy>(`/spaces/${spaceId}/users/me/inbox-agent-policy`, input),
};
