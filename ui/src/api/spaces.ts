import type {
  Space,
  SpacePortabilityExportRequest,
  SpacePortabilityExportPreviewResult,
  SpacePortabilityExportResult,
  SpacePortabilityImportRequest,
  SpacePortabilityImportResult,
  SpacePortabilityPreviewRequest,
  SpacePortabilityPreviewResult,
  UpdateSpaceBranding,
} from "@outpost/shared";
import type { ExportFidelityReport } from "@outpost/shared/portability-fidelity";
import {
  spaceImportTransferApplyPath,
  spaceImportTransferPartPath,
  spaceImportTransferPath,
  spaceImportTransferPreviewPath,
  SPACE_IMPORT_TRANSFERS_ROUTE_PATH,
  type SpaceImportTransferCreated,
  type SpaceImportTransferDeclaration,
  type SpaceImportTransferPartUploadResult,
  type SpaceImportTransferStatus,
} from "@outpost/shared/space-import-transfer";
import { api, detachInflightGet, type RequestOptions } from "./client";

// The operator navigates only into spaces the user can enter. The unscoped
// directory also includes spaces visible solely through instance admin.
// "Space" is the product-facing name, but the stable HTTP resource remains
// `/spaces`. Renaming this path without adding a matching server route makes
// onboarding create the record successfully and then lose it when the list
// refresh returns 404, which sends the wizard back to its first step.
const COMPANIES_LIST_PATH = "/spaces?scope=accessible";
const COMPANIES_DIRECTORY_PATH = "/spaces";

export type SpaceStats = Record<string, { agentCount: number; issueCount: number }>;

/**
 * Import fields for a zip package upload: everything the JSON request carries
 * except `source` — the source is the uploaded zip, read server-side. Sent as a
 * JSON-encoded `meta` form field alongside the raw `package` file.
 */
export type SpacePortabilityPreviewMeta = Omit<SpacePortabilityPreviewRequest, "source">;
export type SpacePortabilityImportMeta = Omit<SpacePortabilityImportRequest, "source">;

function importPackageForm(file: File, meta: SpacePortabilityPreviewMeta | SpacePortabilityImportMeta): FormData {
  const form = new FormData();
  form.append("package", file);
  form.append("meta", JSON.stringify(meta));
  return form;
}

export type SpaceImportJobState = "running" | "succeeded" | "failed";

/** 202 body from the async opt-in on POST /spaces/import (and the 409 body when a job is already running). */
export interface SpaceImportJobAccepted {
  job: { id: string; status: SpaceImportJobState };
  statusUrl: string;
  retryAfterMs?: number;
}

export interface SpaceImportJobStatus {
  job: {
    id: string;
    status: SpaceImportJobState;
    createdAt?: string;
    updatedAt?: string;
    completedAt?: string;
    error?: { message: string };
    /**
     * Summary retained for every terminal job (operator and cloud tenant); carries
     * the imported space id so the page can navigate even when the full
     * `importResult` is no longer available.
     */
    result?: {
      spaceId: string;
      agentCount?: number;
      warningCount?: number;
      spaceAction?: unknown;
    };
    /** Operator-created jobs carry the full result for parity with the sync response. */
    importResult?: SpacePortabilityImportResult;
  };
  retryAfterMs?: number;
}

export const spacesApi = {
  list: () => api.get<Space[]>(COMPANIES_LIST_PATH),
  directory: () => api.get<Space[]>(COMPANIES_DIRECTORY_PATH),
  detachInflightDirectory: () => detachInflightGet(COMPANIES_DIRECTORY_PATH),
  /**
   * Call before re-reading the list for a different account: an in-flight
   * `/spaces` GET issued under the previous session would otherwise be
   * coalesced into, and answer with that account's spaces.
   */
  detachInflightList: () => detachInflightGet(COMPANIES_LIST_PATH),
  get: (spaceId: string) => api.get<Space>(`/spaces/${spaceId}`),
  stats: () => api.get<SpaceStats>("/spaces/stats"),
  create: (data: {
    name: string;
    workspaceRoot?: string;
    description?: string | null;
    budgetMonthlyCents?: number;
  }) =>
    api.post<Space>("/spaces", data),
  update: (
    spaceId: string,
    data: Partial<
      Pick<
        Space,
        | "name"
        | "description"
        | "status"
        | "budgetMonthlyCents"
        | "requireOperatorApprovalForNewAgents"
        | "interactionResolverPolicy"
        | "logoAssetId"
      >
    >,
  ) => api.patch<Space>(`/spaces/${spaceId}`, data),
  updateBranding: (spaceId: string, data: UpdateSpaceBranding) =>
    api.patch<Space>(`/spaces/${spaceId}/branding`, data),
  archive: (spaceId: string) => api.post<Space>(`/spaces/${spaceId}/archive`, {}),
  remove: (spaceId: string) => api.delete<{ ok: true }>(`/spaces/${spaceId}`),
  exportBundle: (
    spaceId: string,
    data: SpacePortabilityExportRequest,
  ) =>
    api.post<SpacePortabilityExportResult>(`/spaces/${spaceId}/exports`, data),
  exportPreview: (
    spaceId: string,
    data: SpacePortabilityExportRequest,
    options?: RequestOptions,
  ) =>
    api.post<SpacePortabilityExportPreviewResult>(`/spaces/${spaceId}/exports/preview`, data, options),
  exportFidelity: (spaceId: string) =>
    api.get<ExportFidelityReport>(`/spaces/${spaceId}/export/fidelity`),
  importPreview: (data: SpacePortabilityPreviewRequest) =>
    api.post<SpacePortabilityPreviewResult>("/spaces/import/preview", data),
  /** Preview a local .zip package by uploading the raw compressed zip as multipart. */
  importPreviewPackage: (file: File, meta: SpacePortabilityPreviewMeta) =>
    api.postForm<SpacePortabilityPreviewResult>("/spaces/import/preview", importPackageForm(file, meta)),
  importBundle: (data: SpacePortabilityImportRequest) =>
    api.post<SpacePortabilityImportResult>("/spaces/import", data),
  // Submit an import as a server-side job: 202 with a job id to poll, or 409
  // with the already-running job. Operator sessions opt in with the proxy-safe
  // `?async=1` query parameter — the Cloud harness strips the inbound
  // `x-outpost-cloud-*` header a browser would otherwise use, so that header
  // never survives to engage the async path.
  importBundleAsync: (data: SpacePortabilityImportRequest) =>
    api.post<SpaceImportJobAccepted>("/spaces/import?async=1", data),
  /** Submit a local .zip package as an async import job by uploading the raw compressed zip as multipart. */
  importBundlePackageAsync: (file: File, meta: SpacePortabilityImportMeta) =>
    api.postForm<SpaceImportJobAccepted>("/spaces/import?async=1", importPackageForm(file, meta)),
  getImportJob: (jobId: string) =>
    api.get<SpaceImportJobStatus>(`/spaces/import/jobs/${encodeURIComponent(jobId)}`),
  // Chunked resumable transfer for large local .zip packages: declare the
  // sliced zip (content-addressed, so re-declaring the same file resumes the
  // prior transfer with its uploaded parts intact), upload the missing parts,
  // then preview/apply against the server-side assembled spool. Shapes and
  // paths come from the shared transfer contract.
  importTransferCreate: (manifest: SpaceImportTransferDeclaration) =>
    api.post<SpaceImportTransferCreated>(`/spaces${SPACE_IMPORT_TRANSFERS_ROUTE_PATH}`, manifest),
  importTransferUploadPart: (transferId: string, index: number, bytes: Blob) =>
    api.putRaw<SpaceImportTransferPartUploadResult>(
      `/spaces${spaceImportTransferPartPath(transferId, index)}`,
      bytes,
    ),
  importTransferStatus: (transferId: string) =>
    api.get<SpaceImportTransferStatus>(`/spaces${spaceImportTransferPath(transferId)}`),
  importTransferPreview: (transferId: string, meta: SpacePortabilityPreviewMeta) =>
    api.post<SpacePortabilityPreviewResult>(
      `/spaces${spaceImportTransferPreviewPath(transferId)}`,
      meta,
    ),
  /** Apply a fully uploaded transfer as an async job (same 202/409 contract as importBundlePackageAsync). */
  importTransferApply: (transferId: string, meta: SpacePortabilityImportMeta) =>
    api.post<SpaceImportJobAccepted>(
      `/spaces${spaceImportTransferApplyPath(transferId)}?async=1`,
      meta,
    ),
};
