import type { VoicePhoneConfiguration, VoiceInboundCall, VoiceUnapprovedCallHistoryEntry } from "@outpost/shared";
import { api } from "./client";
const path = (spaceId: string, endpointId: string) => `/spaces/${encodeURIComponent(spaceId)}/voice-phone/${encodeURIComponent(endpointId)}`;
export const voicePhoneApi = {
  configuration: (spaceId: string, endpointId: string) => api.get<VoicePhoneConfiguration>(path(spaceId, endpointId), {cache: "no-store"}),
  save: (spaceId: string, endpointId: string, input: {numberId: string; enabled: boolean; guestIntake?: boolean; lowTrustEnvironmentId?: string | null}) => api.put<VoicePhoneConfiguration>(path(spaceId, endpointId), input),
  incoming: (spaceId: string, endpointId: string) => api.get<VoiceInboundCall[]>(`${path(spaceId, endpointId)}/incoming`, {cache: "no-store"}),
  history: (spaceId: string, endpointId: string) => api.get<VoiceUnapprovedCallHistoryEntry[]>(`${path(spaceId, endpointId)}/history`, {cache: "no-store"}),
  decide: (spaceId: string, endpointId: string, callId: string, input: {approve: boolean; approvalCode: string; issueId?: string}) => api.post<VoiceInboundCall>(`${path(spaceId, endpointId)}/incoming/${encodeURIComponent(callId)}`, input),
};
