import type {
  Environment,
  EnvironmentCapabilities,
  EnvironmentProbeResult,
} from "@paperclipai/shared";
import { api, type RequestOptions } from "./client";

function companyIdQuery(companyId: string): string {
  return `companyId=${encodeURIComponent(companyId)}`;
}

/**
 * Runtime-facing environment calls still required by local agent execution.
 * The removed Settings > Environments management surface was the only consumer
 * of create/update/delete, remote-driver and custom-image operations.
 */
export const environmentsApi = {
  list: (companyId: string) => api.get<Environment[]>(`/companies/${companyId}/environments`),
  capabilities: (companyId: string) =>
    api.get<EnvironmentCapabilities>(`/companies/${companyId}/environments/capabilities`),
  probe: (environmentId: string, companyId?: string | null, options?: RequestOptions) =>
    api.post<EnvironmentProbeResult>(
      companyId
        ? `/environments/${environmentId}/probe?${companyIdQuery(companyId)}`
        : `/environments/${environmentId}/probe`,
      {},
      options,
    ),
};
