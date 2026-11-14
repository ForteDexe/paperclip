import type {
  CreateSmokeRun,
  RecordSmokeRunStep,
  SmokeLabServiceStatus,
  SmokeRun,
  SmokeRunStep,
  UpdateSmokeRun,
} from "@outpost/shared";
import { api } from "./client";

/**
 * Smoke Lab API client (PAP-13347 / S2, plan §D3). Mirrors the S1 results API
 * shipped in `server/src/routes/smoke-lab.ts` (PAP-13346). Every endpoint is
 * space-scoped and gated server-side on `experimental.enableSmokeLab`,
 * `deploymentMode === local_trusted`, and a non-production environment — the UI
 * only ever surfaces these screens when the operator-readable experimental flag is
 * on, but the server stays authoritative.
 */

export interface SmokeLabServicesResponse {
  services: SmokeLabServiceStatus[];
}

export interface SmokeLabInstallFixturesResponse {
  created: boolean;
  applications: Array<{ id: string; name: string }>;
  connections: Array<{ id: string; name: string }>;
  catalog: unknown[];
  profile: { id: string };
}

export interface SmokeLabRunsResponse {
  runs: SmokeRun[];
}

export interface SmokeLabRunDetailResponse {
  run: SmokeRun;
  steps: SmokeRunStep[];
}

const base = (spaceId: string) => `/spaces/${spaceId}/smoke-lab`;

export const smokeLabApi = {
  listServices: (spaceId: string) =>
    api.get<SmokeLabServicesResponse>(`${base(spaceId)}/services`),
  startServices: (spaceId: string) =>
    api.post<SmokeLabServicesResponse>(`${base(spaceId)}/services/start`, {}),
  stopServices: (spaceId: string) =>
    api.post<SmokeLabServicesResponse>(`${base(spaceId)}/services/stop`, {}),
  installFixtures: (spaceId: string) =>
    api.post<SmokeLabInstallFixturesResponse>(`${base(spaceId)}/install-fixtures`, {}),
  reset: (spaceId: string) =>
    api.post<{ reset: boolean }>(`${base(spaceId)}/reset`, {}),

  listRuns: (spaceId: string) =>
    api.get<SmokeLabRunsResponse>(`${base(spaceId)}/runs`),
  getRun: (spaceId: string, runId: string) =>
    api.get<SmokeLabRunDetailResponse>(`${base(spaceId)}/runs/${runId}`),
  createRun: (spaceId: string, input: CreateSmokeRun) =>
    api.post<{ run: SmokeRun }>(`${base(spaceId)}/runs`, input),
  updateRun: (spaceId: string, runId: string, input: UpdateSmokeRun) =>
    api.patch<{ run: SmokeRun }>(`${base(spaceId)}/runs/${runId}`, input),
  recordStep: (spaceId: string, runId: string, input: RecordSmokeRunStep) =>
    api.post<{ step: SmokeRunStep; summary: Record<string, unknown> }>(
      `${base(spaceId)}/runs/${runId}/steps`,
      input,
    ),
};
