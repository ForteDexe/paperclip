import type { SlackSearchStatus, SlackToolCapabilities } from "@outpost/shared";
import { api } from "./client";
const root = (spaceId: string, endpointId: string) => `/spaces/${spaceId}/slack/endpoints/${endpointId}`;
export const slackToolsApi = {
  capabilities: (spaceId: string, endpointId: string) => api.get<SlackToolCapabilities>(`${root(spaceId, endpointId)}/capabilities`),
  search: (spaceId: string, endpointId: string) => api.get<SlackSearchStatus>(`${root(spaceId, endpointId)}/search`),
  configure: (spaceId: string, endpointId: string, input: {clientId: string; clientSecret: string}) => api.put<SlackSearchStatus>(`${root(spaceId, endpointId)}/search`, input),
  connect: (spaceId: string, endpointId: string) => api.post<{url: string}>(`${root(spaceId, endpointId)}/search/connect`, {}),
  disconnect: (spaceId: string, endpointId: string) => api.delete<SlackSearchStatus>(`${root(spaceId, endpointId)}/search`),
};
