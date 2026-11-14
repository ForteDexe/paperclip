import type { VoiceSession, VoiceSessionMedia, VoiceSessionNotification } from "@outpost/shared";
import { api } from "./client";

const base = (spaceId: string) => `/spaces/${encodeURIComponent(spaceId)}/voice-sessions`;
export const voiceSessionsApi = {
  start(spaceId: string, input: { endpointId: string; issueId?: string; newConversation?: boolean; idempotencyKey: string; maxDurationSeconds?: number }) {
    return api.post<{ session: VoiceSession; media?: VoiceSessionMedia }>(base(spaceId), input, { signal: AbortSignal.timeout(10_000) });
  },
  get(spaceId: string, sessionId: string) {
    return api.get<VoiceSession>(`${base(spaceId)}/${encodeURIComponent(sessionId)}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  },
  end(spaceId: string, sessionId: string) {
    return api.post<VoiceSession>(`${base(spaceId)}/${encodeURIComponent(sessionId)}/end`, {}, { signal: AbortSignal.timeout(10_000) });
  },
  notification(spaceId: string, sessionId: string) {
    return api.get<VoiceSessionNotification | null>(`${base(spaceId)}/${encodeURIComponent(sessionId)}/notification`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  },
};
