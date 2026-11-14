import { z } from "zod";

// Wire contract for chunked resumable space import transfers. The server
// routes validate against these schemas and the browser and CLI clients type
// their requests/responses against the inferred types, so all three sides
// share one description of the payload shapes and route paths.

/** Transfer routes relative to the spaces router (`/api/spaces`). */
export const SPACE_IMPORT_TRANSFERS_ROUTE_PATH = "/import/transfers";
export const SPACE_IMPORT_TRANSFERS_API_PATH = `/api/spaces${SPACE_IMPORT_TRANSFERS_ROUTE_PATH}`;

/**
 * Paths for one transfer, relative to the spaces API root — callers prefix
 * their own mount ("/spaces" in the browser client, "/api/spaces" in
 * the CLI; the server registers the same shapes as express params).
 */
export function spaceImportTransferPath(transferId: string): string {
  return `${SPACE_IMPORT_TRANSFERS_ROUTE_PATH}/${encodeURIComponent(transferId)}`;
}

export function spaceImportTransferPartPath(transferId: string, partIndex: number): string {
  return `${spaceImportTransferPath(transferId)}/parts/${partIndex}`;
}

export function spaceImportTransferPreviewPath(transferId: string): string {
  return `${spaceImportTransferPath(transferId)}/preview`;
}

export function spaceImportTransferApplyPath(transferId: string): string {
  return `${spaceImportTransferPath(transferId)}/apply`;
}

/** Hard cap on the number of declared byte-range parts per transfer. */
export const SPACE_IMPORT_TRANSFER_MAX_PARTS = 4096;

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

export const spaceImportTransferDeclaredPartSchema = z.object({
  index: z.number().int().min(0),
  byteSize: z.number().int().min(1),
  sha256: z
    .string()
    .regex(SHA256_HEX_RE, "sha256 must be 64 lowercase hex characters")
    .describe("sha256 of this part, 64 lowercase hex characters"),
});

/**
 * Declaration body for POST /api/spaces/import/transfers: the caller's
 * existing .zip described as contiguous content-addressed byte-range parts.
 */
export const spaceImportTransferDeclarationSchema = z.object({
  totalBytes: z.number().int().min(1),
  zipSha256: z
    .string()
    .regex(SHA256_HEX_RE, "sha256 must be 64 lowercase hex characters")
    .describe("sha256 of the whole .zip, 64 lowercase hex characters"),
  partSizeBytes: z.number().int().min(1),
  parts: z.array(spaceImportTransferDeclaredPartSchema).min(1).max(SPACE_IMPORT_TRANSFER_MAX_PARTS),
});

export type SpaceImportTransferDeclaredPart = z.infer<typeof spaceImportTransferDeclaredPartSchema>;
export type SpaceImportTransferDeclaration = z.infer<typeof spaceImportTransferDeclarationSchema>;

/** Ledger states a transfer run moves through (see space_transfer_runs). */
export type SpaceImportTransferRunStatus =
  | "pending"
  | "running"
  | "applying"
  | "completed"
  | "failed"
  | "cancelled";

/** Response of declaring (or resuming) a chunked import transfer. */
export interface SpaceImportTransferCreated {
  transferId: string;
  status: SpaceImportTransferRunStatus;
  /** True when this exact content already finished a prior apply. */
  alreadyCompleted: boolean;
  totalParts: number;
  missingParts: number[];
  /**
   * Where the prior completed apply landed, so an alreadyCompleted rejection
   * can point at the existing space instead of reading as data loss.
   * Null/absent when the run's space link was never written or the space
   * has since been deleted.
   */
  space?: { id: string; name: string | null; issuePrefix: string | null } | null;
}

/**
 * Human-facing message for an `alreadyCompleted` declaration. Shared by the
 * web and CLI clients so the copy (and the pointer to the landed space)
 * stays identical everywhere the rejection surfaces.
 */
export function buildAlreadyImportedMessage(
  space: SpaceImportTransferCreated["space"],
): string {
  // "landed in", not "created": a completed transfer may have created a new
  // space or merged into an existing one, and the caller cannot tell which.
  const location = space
    ? ` The earlier import landed in the space "${space.name ?? space.id}"${space.issuePrefix ? ` (${space.issuePrefix})` : ""} — open it from the space switcher.`
    : "";
  return `This exact package was already imported by a completed transfer.${location} Re-export the package to import it again.`;
}

/** Response of the resume-polling GET for one transfer. */
export interface SpaceImportTransferStatus {
  transferId: string;
  status: SpaceImportTransferRunStatus;
  totalParts: number;
  completedParts: number;
  missingParts: number[];
}

/** Response of uploading one declared part. */
export interface SpaceImportTransferPartUploadResult {
  ok: true;
  index: number;
  /** True when the part was already spooled and verified by a prior upload. */
  alreadyCompleted: boolean;
}
