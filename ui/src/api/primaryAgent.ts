import type { PrimaryAgentPreference, UpdatePrimaryAgent } from "@outpost/shared";
import { api } from "./client";

export const primaryAgentApi = {
  get: (spaceId: string) => api.get<PrimaryAgentPreference>(`/spaces/${spaceId}/primary-agent/me`),
  set: (spaceId: string, body: UpdatePrimaryAgent) => api.put<PrimaryAgentPreference>(`/spaces/${spaceId}/primary-agent/me`, body),
};
