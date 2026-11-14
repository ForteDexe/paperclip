import type { DefaultAgentPreference, UpdateDefaultAgent } from "@outpost/shared";
import { api } from "./client";

export const defaultAgentApi = {
  get: (spaceId: string) => api.get<DefaultAgentPreference>(`/spaces/${spaceId}/default-agent/me`),
  set: (spaceId: string, body: UpdateDefaultAgent) => api.put<DefaultAgentPreference>(`/spaces/${spaceId}/default-agent/me`, body),
};
