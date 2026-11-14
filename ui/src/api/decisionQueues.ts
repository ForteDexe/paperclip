import type {
  AttentionSourceKind,
  DecisionQueue,
  DecisionQueueItem,
  DecisionQueueSeedRule,
  DecisionTriage,
} from "@outpost/shared";
import { api } from "./client";

// The shared types model timestamps as `Date` (the server row shape); over the
// wire they arrive as ISO strings, so the UI-facing DTOs restate the time
// fields as strings. Everything else round-trips unchanged.
export type DecisionQueueDto = Omit<DecisionQueue, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};
export type DecisionQueueItemDto = Omit<DecisionQueueItem, "createdAt"> & { createdAt: string };
export type DecisionTriageDto = Omit<DecisionTriage, "createdAt" | "updatedAt" | "snoozedUntil"> & {
  createdAt: string;
  updatedAt: string;
  snoozedUntil: string | null;
};

/** A seed rule bundled with its owning queue key/title, from the catalog endpoint. */
export interface DecisionQueueSeedDefinition {
  key: string;
  title: string;
  description: string;
  rules: DecisionQueueSeedRule[];
}

export interface CreateDecisionQueueBody {
  key: string;
  title: string;
  description?: string | null;
  retentionDays?: number | null;
}

export interface UpdateDecisionQueueBody {
  title?: string;
  description?: string | null;
  retentionDays?: number | null;
  seedRulesEnabled?: boolean;
}

export interface UpdateDecisionTriageBody {
  /** `today` | `this_week` | `whenever` | `YYYY-MM-DD` | null to clear. */
  decideBy?: string | null;
  /** ISO timestamp, or null to clear. */
  snoozedUntil?: string | null;
}

export interface DecisionRetentionDto {
  id: string;
  spaceId: string;
  sourceKind: AttentionSourceKind;
  sourceId: string;
  sourceActivityAt: string;
  keep: boolean;
  archivedAt: string | null;
  archivedReason: string | null;
  version: number;
  archiveVersion: number;
  updatedAt: string;
}

export interface CreateDecisionArchiveProposalBody {
  items: Array<{ sourceKind: AttentionSourceKind; sourceId: string; reason: string }>;
  idempotencyKey?: string;
}

/**
 * Decision queues + triage (PAP-16039 P1). Queues are named, space-scoped,
 * durable lists any agent or the operator can feed; triage stores the per-source
 * decide-by / snooze that drives the desk's `sort=decide` ordering. The
 * attention feed already surfaces `queues[]` and `decideBy` per item — these
 * routes are the write path and the queue-rail/queue-page read path.
 */
export const decisionQueuesApi = {
  seedRules: (spaceId: string) =>
    api.get<DecisionQueueSeedDefinition[]>(`/spaces/${spaceId}/decision-queue-seed-rules`),

  list: (spaceId: string) => api.get<DecisionQueueDto[]>(`/spaces/${spaceId}/decision-queues`),

  create: (spaceId: string, body: CreateDecisionQueueBody) =>
    api.post<DecisionQueueDto>(`/spaces/${spaceId}/decision-queues`, body),

  update: (spaceId: string, key: string, body: UpdateDecisionQueueBody) =>
    api.patch<DecisionQueueDto>(`/spaces/${spaceId}/decision-queues/${encodeURIComponent(key)}`, body),

  listItems: (spaceId: string, key: string) =>
    api.get<DecisionQueueItemDto[]>(`/spaces/${spaceId}/decision-queues/${encodeURIComponent(key)}/items`),

  addItem: (spaceId: string, key: string, sourceKind: AttentionSourceKind, sourceId: string) =>
    api.post<DecisionQueueItemDto>(
      `/spaces/${spaceId}/decision-queues/${encodeURIComponent(key)}/items`,
      { sourceKind, sourceId },
    ),

  removeItem: (
    spaceId: string,
    key: string,
    sourceKind: AttentionSourceKind,
    sourceId: string,
    reason?: string,
  ) =>
    api.delete<DecisionQueueItemDto>(
      `/spaces/${spaceId}/decision-queues/${encodeURIComponent(key)}/items/${encodeURIComponent(sourceKind)}/${encodeURIComponent(sourceId)}`,
      reason ? { reason } : {},
    ),

  getTriage: (spaceId: string, sourceKind: AttentionSourceKind, sourceId: string) =>
    api.get<DecisionTriageDto | null>(
      `/spaces/${spaceId}/decision-triage/${encodeURIComponent(sourceKind)}/${encodeURIComponent(sourceId)}`,
    ),

  updateTriage: (
    spaceId: string,
    sourceKind: AttentionSourceKind,
    sourceId: string,
    body: UpdateDecisionTriageBody,
  ) =>
    api.put<DecisionTriageDto>(
      `/spaces/${spaceId}/decision-triage/${encodeURIComponent(sourceKind)}/${encodeURIComponent(sourceId)}`,
      body,
    ),

  setKeep: (spaceId: string, sourceKind: AttentionSourceKind, sourceId: string, keep: boolean) =>
    api.patch<DecisionRetentionDto>(
      `/spaces/${spaceId}/decision-retention/${encodeURIComponent(sourceKind)}/${encodeURIComponent(sourceId)}`,
      { keep },
    ),

  archive: (spaceId: string, sourceKind: AttentionSourceKind, sourceId: string) =>
    api.post<DecisionRetentionDto>(
      `/spaces/${spaceId}/decision-retention/${encodeURIComponent(sourceKind)}/${encodeURIComponent(sourceId)}/archive`,
      {},
    ),

  revive: (spaceId: string, sourceKind: AttentionSourceKind, sourceId: string) =>
    api.post<DecisionRetentionDto>(
      `/spaces/${spaceId}/decision-retention/${encodeURIComponent(sourceKind)}/${encodeURIComponent(sourceId)}/revive`,
      {},
    ),

  proposeArchive: (spaceId: string, body: CreateDecisionArchiveProposalBody) =>
    api.post(`/spaces/${spaceId}/decision-archive-proposals`, body),
};
