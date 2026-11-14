import type { AiConnectionList, AiConnectionUsage, AiConnectionAccountIdentity, CreateAiConnection, AiConnectionLoginIntent, LocalAiLoginAttempt, LocalAiLoginStatus } from "@outpost/shared";
import { api, type RequestOptions } from "./client";
export const aiConnectionsApi = {
  accountIdentity: (spaceId: string, connectionId: string, grantId: string, options?: RequestOptions) => api.get<AiConnectionAccountIdentity>(`/spaces/${spaceId}/ai-connections/${connectionId}/identity?grantId=${encodeURIComponent(grantId)}`, { timeoutMs: 20_000, ...options }),
  loginSetup: (spaceId: string, sessionId: string) => api.get<{ sessionId: string; intent: AiConnectionLoginIntent; environmentId: string; status: string; connectionId: string | null; grantId: string | null }>(`/spaces/${spaceId}/ai-connections/login/${encodeURIComponent(sessionId)}/setup`),
  probeUsage: (spaceId: string, connectionId: string, grantId?: string) => api.get<AiConnectionUsage>(`/spaces/${spaceId}/ai-connections/${connectionId}/usage${grantId ? `?grantId=${encodeURIComponent(grantId)}` : ""}`),
  startLocalLogin: (spaceId: string, input: AiConnectionLoginIntent & { restart?: boolean }) => api.post<LocalAiLoginAttempt>(`/spaces/${spaceId}/ai-connections/local/attempts`, input),
  checkLocalLogin: (spaceId: string, input: AiConnectionLoginIntent & { localSessionId?: string }) => api.post<LocalAiLoginStatus>(`/spaces/${spaceId}/ai-connections/local/check`, input),
  submitLocalLoginCode: (spaceId: string, sessionId: string, browserCode: string) => api.post(`/spaces/${spaceId}/ai-connections/local/attempts/${sessionId}/code`, { browserCode }),
  cancelLocalLogin: (spaceId: string, sessionId: string) => api.delete(`/spaces/${spaceId}/ai-connections/local/attempts/${sessionId}`),
  connectLocal: (spaceId: string, input: AiConnectionLoginIntent & { localSessionId?: string }) => api.post<{ connectionId: string; grantId: string }>(`/spaces/${spaceId}/ai-connections/local`, input),
  activeRuns: (spaceId: string, connectionId: string) => api.get<Array<{ id: string; agentId: string; agentName: string; status: string }>>(`/spaces/${spaceId}/ai-connections/${connectionId}/active-runs`),
  list: (spaceId: string, agentId?: string, options?: RequestOptions) => api.get<AiConnectionList>(`/spaces/${spaceId}/ai-connections${agentId ? `?agentId=${encodeURIComponent(agentId)}` : ""}`, { timeoutMs: 15_000, ...options }),
  create: (spaceId: string, input: CreateAiConnection) => api.post<{ connectionId: string; grantId: string }>(`/spaces/${spaceId}/ai-connections`, input),
  setDefault: (spaceId: string, grantId: string) => api.put(`/spaces/${spaceId}/ai-connections/default`, { grantId }),
  loginResult: (spaceId: string, sessionId: string) => api.get<{ connectionId: string; grantId: string }>(`/spaces/${spaceId}/ai-connections/login/${encodeURIComponent(sessionId)}`),
};
