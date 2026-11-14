import type { Issue } from "@outpost/shared";
import { api } from "./client";
export const agentChatsApi = {
  list: (spaceId: string) => api.get<Issue[]>(`/spaces/${spaceId}/chats`),
  get: (spaceId: string, agentRef: string) =>
    api.get<Issue | null>(
      `/spaces/${spaceId}/chats/${encodeURIComponent(agentRef)}`,
    ),
  ensure: (spaceId: string, agentRef: string) =>
    api.post<Issue>(
      `/spaces/${spaceId}/chats/${encodeURIComponent(agentRef)}`,
      {},
    ),
};
