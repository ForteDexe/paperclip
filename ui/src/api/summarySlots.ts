import type {
  GenerateSummarySlotResponse,
  GetSummarySlotResponse,
  ListSummarySlotRevisionsResponse,
  SummarySlotKey,
  SummarySlotScopeKind,
} from "@outpost/shared";
import { api } from "./client";

export interface SummarySlotSelector {
  spaceId: string;
  scopeKind: SummarySlotScopeKind;
  scopeId?: string | null;
  slotKey: SummarySlotKey;
}

function summarySlotPath(selector: SummarySlotSelector, suffix = "") {
  const params = new URLSearchParams();
  if (selector.scopeId) params.set("scopeId", selector.scopeId);
  const query = params.toString();
  return [
    `/spaces/${selector.spaceId}/summary-slots/${selector.scopeKind}/${selector.slotKey}`,
    suffix,
    query ? `?${query}` : "",
  ].join("");
}

export const summarySlotsApi = {
  get: (selector: SummarySlotSelector) =>
    api.get<GetSummarySlotResponse>(summarySlotPath(selector)),
  revisions: (selector: SummarySlotSelector) =>
    api.get<ListSummarySlotRevisionsResponse>(summarySlotPath(selector, "/revisions")),
  generate: (selector: SummarySlotSelector) =>
    api.post<GenerateSummarySlotResponse>(
      summarySlotPath(selector, "/generate"),
      { scopeId: selector.scopeId ?? null },
    ),
};
