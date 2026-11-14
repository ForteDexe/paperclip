import { api } from "./client";

import type { DotInvitation, DotConnection, DotPairing } from "@outpost/shared";
export type { DotBinding, DotInvitation, DotConnection, DotPairing } from "@outpost/shared";
const path = (spaceId: string, agentId: string) => `/spaces/${spaceId}/agents/${agentId}/dot-binding`;
export const dotInvitationsApi = {
  create: (spaceId: string) => api.post<DotInvitation>(`/spaces/${spaceId}/dot-invitations`, {}),
  connection: (spaceId: string, agentId: string, signal?: AbortSignal) => api.get<DotConnection>(path(spaceId, agentId), { signal }),
  pair: (spaceId: string, agentId: string, replaceBindingId?: string) => api.post<DotPairing>(path(spaceId, agentId), { replaceBindingId }),
  retry: (spaceId: string, agentId: string, bindingId: string) => api.post(path(spaceId, agentId) + "/event-test", { bindingId }),
};
