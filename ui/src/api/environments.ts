import type {
  Environment,
  EnvironmentCapabilities,
  EnvironmentProbeResult,
} from "@outpost/shared";
import { api, type RequestOptions } from "./client";

function spaceIdQuery(spaceId: string): string {
  return `spaceId=${encodeURIComponent(spaceId)}`;
}

/**
 * Runtime-facing environment calls still required by local agent execution.
 * The removed Settings > Environments management surface was the only consumer
 * of create/update/delete, remote-driver and custom-image operations.
 */
export const environmentsApi = {
  list: (spaceId: string) => api.get<Environment[]>(`/spaces/${spaceId}/environments`),
  capabilities: (spaceId: string) =>
    api.get<EnvironmentCapabilities>(`/spaces/${spaceId}/environments/capabilities`),
  probe: (environmentId: string, spaceId?: string | null, options?: RequestOptions) =>
    api.post<EnvironmentProbeResult>(
      spaceId
        ? `/environments/${environmentId}/probe?${spaceIdQuery(spaceId)}`
        : `/environments/${environmentId}/probe`,
      {},
      options,
    ),
};
