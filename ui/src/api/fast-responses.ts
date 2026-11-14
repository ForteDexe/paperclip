import type {
  FastResponseSettingsResponse,
  FastResponseSettings,
  FastResponseTestResult,
  FastResponseHistoryEntry,
  UpdateFastResponse,
} from "@outpost/shared";
import { api } from "./client";
export const fastResponsesApi = {
  settings: (spaceId: string) =>
    api.get<FastResponseSettingsResponse>(
      `/spaces/${spaceId}/fast-response`,
    ),
  update: (spaceId: string, settings: UpdateFastResponse) =>
    api.put<FastResponseSettings>(
      `/spaces/${spaceId}/fast-response`,
      settings,
    ),
  models: (spaceId: string, connectionId: string) =>
    api.get<Array<{ id: string; label?: string }>>(
      `/spaces/${spaceId}/fast-response/models?connectionId=${encodeURIComponent(connectionId)}`,
    ),
  test: (spaceId: string) =>
    api.post<FastResponseTestResult>(
      `/spaces/${spaceId}/fast-response/test`,
      {},
    ),
  history: (spaceId: string, from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return api.get<FastResponseHistoryEntry[]>(
      `/spaces/${spaceId}/fast-response/history?${params}`,
    );
  },
};
