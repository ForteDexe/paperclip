import { api } from "./client";
import type {
  SpaceArtifact,
  SpaceArtifactGroupBy,
  SpaceArtifactMediaKind,
  SpaceArtifactsResponse,
} from "@outpost/shared";

export type {
  SpaceArtifact,
  SpaceArtifactGroup,
  SpaceArtifactGroupBy as ArtifactGroupBy,
  SpaceArtifactMediaKind as ArtifactMediaKind,
  SpaceArtifactsResponse,
  SpaceArtifactSource as ArtifactSource,
} from "@outpost/shared";

/**
 * Space-level Artifacts client (PAP-10359).
 *
 * Talks to the space-scoped artifacts projection endpoint
 * (`GET /api/spaces/:spaceId/artifacts`) defined by the approved
 * Artifacts plan (PAP-10353). The endpoint flattens agent-produced issue
 * documents, direct attachments, and `artifact` work products into a single
 * card-ready list so the UI never has to stitch issue-specific endpoints
 * together.
 *
 * The `SpaceArtifact` shape is imported from `@outpost/shared` so the
 * frontend and server stay synchronized as the contract evolves.
 */

export type ArtifactKindFilter = Exclude<SpaceArtifactMediaKind, "empty"> | "all";

export interface ListArtifactsParams {
  kind?: ArtifactKindFilter;
  projectId?: string;
  /** Only artifacts attributed to this agent. */
  agentId?: string;
  q?: string;
  /** Grouping mode. `none` (default) returns the flat artifact grid. */
  groupBy?: SpaceArtifactGroupBy;
  /** When grouping, selects a single stack to expand into its artifacts. */
  groupIssueId?: string;
  limit?: number;
  cursor?: string;
}

function buildArtifactsQuery(params?: ListArtifactsParams): string {
  const search = new URLSearchParams();
  if (params?.kind && params.kind !== "all") search.set("kind", params.kind);
  if (params?.projectId) search.set("projectId", params.projectId);
  if (params?.agentId) search.set("agentId", params.agentId);
  if (params?.q) search.set("q", params.q);
  if (params?.groupBy && params.groupBy !== "none") search.set("groupBy", params.groupBy);
  if (params?.groupIssueId) search.set("groupIssueId", params.groupIssueId);
  if (params?.limit != null) search.set("limit", String(params.limit));
  if (params?.cursor) search.set("cursor", params.cursor);
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

/**
 * Normalize the endpoint response. The contract is an envelope
 * (`{ artifacts, groups?, selectedGroup?, nextCursor }`), but we also tolerate a
 * bare array so the page keeps working if the backend ships the simpler shape.
 */
function normalizeArtifactsResponse(
  raw: SpaceArtifactsResponse | SpaceArtifact[],
): SpaceArtifactsResponse {
  if (Array.isArray(raw)) {
    return { artifacts: raw, nextCursor: null };
  }
  return {
    artifacts: raw.artifacts ?? [],
    groups: raw.groups,
    selectedGroup: raw.selectedGroup,
    nextCursor: raw.nextCursor ?? null,
  };
}

export const artifactsApi = {
  list: async (spaceId: string, params?: ListArtifactsParams): Promise<SpaceArtifactsResponse> => {
    const raw = await api.get<SpaceArtifactsResponse | SpaceArtifact[]>(
      `/spaces/${spaceId}/artifacts${buildArtifactsQuery(params)}`,
    );
    return normalizeArtifactsResponse(raw);
  },
};
