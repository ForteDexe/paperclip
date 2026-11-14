import type { AgentCommentaryDetail, AgentCommentaryPage, AgentCommentaryQuery } from "@outpost/shared";
import { api } from "./client";

export const agentCommentaryApi = {
  list(spaceId: string, filters: Partial<AgentCommentaryQuery>, signal?: AbortSignal) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== "") query.set(key, String(value));
    }
    return api.get<AgentCommentaryPage>(`/spaces/${spaceId}/agent-commentary?${query}`, { signal });
  },
  get: (spaceId: string, id: string, signal?: AbortSignal) =>
    api.get<AgentCommentaryDetail>(`/spaces/${spaceId}/agent-commentary/${encodeURIComponent(id)}`, { signal }),
};
