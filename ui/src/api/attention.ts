import type { AttentionFeed, AttentionFeedQuery, AttentionSummary, AttentionTaskIndex, DecisionHistoryPage, DecisionHistoryQuery } from "@outpost/shared";
import { api } from "./client";

export const attentionApi = {
  summary: (spaceId: string) => api.get<AttentionSummary>(`/spaces/${spaceId}/attention/summary`),
  taskIndex: (spaceId: string) => api.get<AttentionTaskIndex>(`/spaces/${spaceId}/attention/tasks`),
  history: (spaceId: string, options: DecisionHistoryQuery = {}) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(options)) if (value !== undefined && value !== "") params.set(key, String(value));
    return api.get<DecisionHistoryPage>(`/spaces/${spaceId}/attention/history?${params.toString()}`);
  },
  /**
   * Fetch the ranked Decisions attention feed for a space. The server
   * unions every attention source (approvals, interactions, recovery, reviews,
   * failures, budget…) into one ranked queue with the §0 contract.
   */
  list: (spaceId: string, options: AttentionFeedQuery = {}) => {
    const params = new URLSearchParams();
    if (options.includeDismissed) params.set("includeDismissed", "true");
    if (options.archived) params.set("archived", "true");
    if (options.all) params.set("all", "true");
    if (options.activitySince) params.set("activitySince", options.activitySince);
    if (options.activityUntil) params.set("activityUntil", options.activityUntil);
    if (options.queue) params.set("queue", options.queue);
    if (options.sort) params.set("sort", options.sort);
    if (options.cursor) params.set("cursor", options.cursor);
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    const query = params.toString();
    return api.get<AttentionFeed>(`/spaces/${spaceId}/attention${query ? `?${query}` : ""}`);
  },
};
