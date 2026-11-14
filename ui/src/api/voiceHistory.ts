import type { VoiceCallHistoryEntry } from "@outpost/shared";
import { api } from "./client";
export const voiceHistoryApi = {
  list: (spaceId: string, endpointId: string) => api.get<VoiceCallHistoryEntry[]>(`/spaces/${encodeURIComponent(spaceId)}/voice-history/${encodeURIComponent(endpointId)}`, { cache: "no-store" }),
};
