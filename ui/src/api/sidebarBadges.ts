import type { SidebarBadges } from "@outpost/shared";
import { api } from "./client";

export const sidebarBadgesApi = {
  get: (spaceId: string) => api.get<SidebarBadges>(`/spaces/${spaceId}/sidebar-badges`),
};
