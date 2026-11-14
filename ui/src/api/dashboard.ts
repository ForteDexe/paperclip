import type { DashboardSummary } from "@outpost/shared";
import { api } from "./client";

export const dashboardApi = {
  summary: (spaceId: string) => api.get<DashboardSummary>(`/spaces/${spaceId}/dashboard`),
};
