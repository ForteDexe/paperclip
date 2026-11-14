import type { VoiceCallbackPreference } from "@outpost/shared";
import { api } from "./client";
const path = (spaceId: string, endpointId: string) => `/spaces/${encodeURIComponent(spaceId)}/voice-callbacks/${encodeURIComponent(endpointId)}`;
export const voiceCallbacksApi = {
  get: (spaceId: string, endpointId: string) => api.get<VoiceCallbackPreference | null>(path(spaceId, endpointId), { cache: "no-store" }),
  save: (spaceId: string, endpointId: string, preference: VoiceCallbackPreference) => api.put<VoiceCallbackPreference>(path(spaceId, endpointId), preference),
};
