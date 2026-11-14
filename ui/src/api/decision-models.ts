import type { DecisionConnectionChoice, DecisionHistoryEntry, DecisionModelSettings, DecisionResult, UpdateDecisionModel } from "@outpost/shared";
import { api } from "./client";
export interface DecisionSettingsResponse { canManage: boolean; settings: DecisionModelSettings | null; choices: DecisionConnectionChoice[] }
export const decisionModelsApi = {
  settings: (spaceId: string) => api.get<DecisionSettingsResponse>(`/spaces/${spaceId}/decision-model`),
  update: (spaceId: string, settings: UpdateDecisionModel) => api.put<DecisionModelSettings>(`/spaces/${spaceId}/decision-model`, settings),
  test: (spaceId: string) => api.post<DecisionResult>(`/spaces/${spaceId}/decision-model/test`, {}),
  history: (spaceId: string, from?: string | null, to?: string | null) => {
    const params = new URLSearchParams({ limit: "100" });
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return api.get<DecisionHistoryEntry[]>(`/spaces/${spaceId}/decision-model/history?${params}`);
  },
};
