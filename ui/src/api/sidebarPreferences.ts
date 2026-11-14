import type { SidebarOrderPreference, UpsertSidebarOrderPreference } from "@outpost/shared";
import { api } from "./client";

export const sidebarPreferencesApi = {
  getSpaceOrder: () => api.get<SidebarOrderPreference>("/sidebar-preferences/me"),
  updateSpaceOrder: (data: UpsertSidebarOrderPreference) =>
    api.put<SidebarOrderPreference>("/sidebar-preferences/me", data),
  getProjectOrder: (spaceId: string) =>
    api.get<SidebarOrderPreference>(`/spaces/${spaceId}/sidebar-preferences/me`),
  updateProjectOrder: (spaceId: string, data: UpsertSidebarOrderPreference) =>
    api.put<SidebarOrderPreference>(`/spaces/${spaceId}/sidebar-preferences/me`, data),
};
