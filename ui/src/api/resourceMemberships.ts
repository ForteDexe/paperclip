import type {
  ResourceMemberships,
  ResourceMembershipUpdateResult,
  UpdateResourceMembership,
} from "@outpost/shared";
import { api } from "./client";

export const resourceMembershipsApi = {
  listMine: (spaceId: string) =>
    api.get<ResourceMemberships>(`/spaces/${spaceId}/resource-memberships/me`),
  updateProject: (spaceId: string, projectId: string, data: UpdateResourceMembership) =>
    api.put<ResourceMembershipUpdateResult>(
      `/spaces/${spaceId}/resource-memberships/me/projects/${projectId}`,
      data,
    ),
  updateAgent: (spaceId: string, agentId: string, data: UpdateResourceMembership) =>
    api.put<ResourceMembershipUpdateResult>(
      `/spaces/${spaceId}/resource-memberships/me/agents/${agentId}`,
      data,
    ),
};
