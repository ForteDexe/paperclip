import type { Goal } from "@outpost/shared";
import { api } from "./client";

export const goalsApi = {
  list: (spaceId: string) => api.get<Goal[]>(`/spaces/${spaceId}/goals`),
  get: (id: string) => api.get<Goal>(`/goals/${id}`),
  create: (spaceId: string, data: Record<string, unknown>) =>
    api.post<Goal>(`/spaces/${spaceId}/goals`, data),
  update: (id: string, data: Record<string, unknown>) => api.patch<Goal>(`/goals/${id}`, data),
  remove: (id: string) => api.delete<Goal>(`/goals/${id}`),
};
