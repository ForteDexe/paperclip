import type { AiConnectionPool, AiConnectionPoolConfig, AiConnectionUsage } from "@outpost/shared";
import { api } from "./client";
export type PoolInspection = Record<string, { reason: string; checkedAt: string | null; usage?: AiConnectionUsage }>;
export const aiConnectionPoolsApi = {
  list: (spaceId: string) => api.get<AiConnectionPool[]>(`/spaces/${spaceId}/ai-connection-pools`),
  save: (spaceId: string, body: { pluginKey: string; id?: string; expectedRevision?: number; config: AiConnectionPoolConfig }) => api.post<AiConnectionPool>(`/spaces/${spaceId}/ai-connection-pools`, body),
  inspect: (spaceId: string, id: string) => api.get<PoolInspection>(`/spaces/${spaceId}/ai-connection-pools/${id}/inspection`),
  remove: (spaceId: string, id: string, expectedRevision: number) => api.delete(`/spaces/${spaceId}/ai-connection-pools/${id}`, { expectedRevision }),
};
