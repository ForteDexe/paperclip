import { api } from "./client";
import type { ConfigureGrokRoutine, CreateGrokInvitation, DotPairing, GrokConnection, GrokInvitation, GrokRoutineState } from "@outpost/shared";
const path = (spaceId: string, agentId: string) => `/spaces/${spaceId}/agents/${agentId}/grok-binding`;
export const grokBotApi = {
  resume: (spaceId: string) => api.get<GrokInvitation | null>(`/spaces/${spaceId}/grok-invitations`),
  create: (spaceId: string, input: CreateGrokInvitation) => api.post<GrokInvitation>(`/spaces/${spaceId}/grok-invitations`, input),
  connection: (spaceId: string, agentId: string, signal?: AbortSignal) => api.get<GrokConnection>(path(spaceId, agentId), { signal }),
  pair: (spaceId: string, agentId: string, replaceBindingId?: string) => api.post<DotPairing>(path(spaceId, agentId), { replaceBindingId }),
  configure: (spaceId: string, agentId: string, input: ConfigureGrokRoutine) => api.put<GrokRoutineState>(path(spaceId, agentId) + "/routine", input),
  verify: (spaceId: string, agentId: string, bindingId: string, requestId: string) => api.post<GrokRoutineState>(path(spaceId, agentId) + "/verify", { bindingId, requestId }),
  retry: (spaceId: string, agentId: string, correlationId: string) => api.post<GrokRoutineState>(path(spaceId, agentId) + "/retry", { correlationId }),
  stop: (spaceId: string, agentId: string, expectedRunId?: string) => api.post(path(spaceId, agentId) + "/stop", { expectedRunId }),
  recover: (spaceId: string, agentId: string) => api.post(path(spaceId, agentId) + "/recover", { inspectedRemoteWork: true }),
  disconnect: (spaceId: string, agentId: string) => api.delete(path(spaceId, agentId)),
};
