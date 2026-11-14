import { api, detachInflightGet } from "./client";
import type {
  MuseInvitation, MuseInvitationInput, MuseConnection, MusePairing, MusePairingInput,
  MuseVerifyInput, MuseVerifyResult, MuseRevokeInput, MuseDetectorCleanupAttestationInput, MuseAttestStopInput,
} from "@outpost/shared";

const path = (spaceId: string, agentId: string) => `/spaces/${spaceId}/agents/${agentId}/muse-binding`;
function accountScopedRead<T>(path: string, signal?: AbortSignal) {
  // Query keys carry the operator. Path-only GET coalescing must not join a
  // request issued under the previous account; React Query handles same-key reads.
  detachInflightGet(path);
  return api.get<T>(path, { signal, cache: "no-store" });
}
export const museInvitationsApi = {
  resume: (spaceId: string, signal?: AbortSignal) => accountScopedRead<MuseInvitation | null>(`/spaces/${spaceId}/muse-invitations`, signal),
  create: (spaceId: string, input: MuseInvitationInput) => api.post<MuseInvitation>(`/spaces/${spaceId}/muse-invitations`, input),
  connection: (spaceId: string, agentId: string, signal?: AbortSignal) => accountScopedRead<MuseConnection>(path(spaceId, agentId), signal),
  pair: (spaceId: string, agentId: string, input: MusePairingInput) => api.post<MusePairing>(path(spaceId, agentId), input),
  verify: (spaceId: string, agentId: string, input: MuseVerifyInput) => api.post<MuseVerifyResult>(path(spaceId, agentId) + "/verify", input),
  revoke: (spaceId: string, agentId: string, input: MuseRevokeInput) => api.post<void>(path(spaceId, agentId) + "/revoke", input),
  attestDetectorCleanup: (spaceId: string, agentId: string, input: MuseDetectorCleanupAttestationInput) => api.post<void>(path(spaceId, agentId) + "/attest-detector-cleanup", input),
  attestStop: (spaceId: string, agentId: string, input: MuseAttestStopInput) => api.post<void>(path(spaceId, agentId) + "/attest-stop", input),
};
