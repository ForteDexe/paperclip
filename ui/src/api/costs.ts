import type {
  CostSummary,
  CostDataQualityReport,
  CostByAgent,
  CostByUserReport,
  CostByProviderModel,
  CostByBiller,
  CostByAgentModel,
  CostByProject,
  CostWindowSpendRow,
  FinanceSummary,
  FinanceByBiller,
  FinanceByKind,
  FinanceEvent,
  ProviderQuotaResult,
} from "@outpost/shared";
import { api } from "./client";

function dateParams(from?: string, to?: string): string {
  const params = new URLSearchParams();
  if (!from && !to) params.set("period", "all");
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export const costsApi = {
  dataQuality: (spaceId: string, from?: string, to?: string) =>
    api.get<CostDataQualityReport>(`/spaces/${spaceId}/costs/data-quality${dateParams(from, to)}`),
  retryAccounting: (spaceId: string, runId: string) =>
    api.post<{ accounted: boolean }>(`/spaces/${spaceId}/costs/retry-accounting`, { runId }),
  summary: (spaceId: string, from?: string, to?: string) =>
    api.get<CostSummary>(`/spaces/${spaceId}/costs/summary${dateParams(from, to)}`),
  byUser: (spaceId: string, from?: string, to?: string) =>
    api.get<CostByUserReport>(`/spaces/${spaceId}/costs/by-user${dateParams(from, to)}`),
  byAgent: (spaceId: string, from?: string, to?: string) =>
    api.get<CostByAgent[]>(`/spaces/${spaceId}/costs/by-agent${dateParams(from, to)}`),
  byAgentModel: (spaceId: string, from?: string, to?: string) =>
    api.get<CostByAgentModel[]>(`/spaces/${spaceId}/costs/by-agent-model${dateParams(from, to)}`),
  byProject: (spaceId: string, from?: string, to?: string) =>
    api.get<CostByProject[]>(`/spaces/${spaceId}/costs/by-project${dateParams(from, to)}`),
  byProvider: (spaceId: string, from?: string, to?: string) =>
    api.get<CostByProviderModel[]>(`/spaces/${spaceId}/costs/by-provider${dateParams(from, to)}`),
  byBiller: (spaceId: string, from?: string, to?: string) =>
    api.get<CostByBiller[]>(`/spaces/${spaceId}/costs/by-biller${dateParams(from, to)}`),
  financeSummary: (spaceId: string, from?: string, to?: string) =>
    api.get<FinanceSummary>(`/spaces/${spaceId}/costs/finance-summary${dateParams(from, to)}`),
  financeByBiller: (spaceId: string, from?: string, to?: string) =>
    api.get<FinanceByBiller[]>(`/spaces/${spaceId}/costs/finance-by-biller${dateParams(from, to)}`),
  financeByKind: (spaceId: string, from?: string, to?: string) =>
    api.get<FinanceByKind[]>(`/spaces/${spaceId}/costs/finance-by-kind${dateParams(from, to)}`),
  financeEvents: (spaceId: string, from?: string, to?: string, limit: number = 100) =>
    api.get<FinanceEvent[]>(`/spaces/${spaceId}/costs/finance-events${dateParamsWithLimit(from, to, limit)}`),
  windowSpend: (spaceId: string) =>
    api.get<CostWindowSpendRow[]>(`/spaces/${spaceId}/costs/window-spend`),
  quotaWindows: (spaceId: string) =>
    api.get<ProviderQuotaResult[]>(`/spaces/${spaceId}/costs/quota-windows`),
};

function dateParamsWithLimit(from?: string, to?: string, limit?: number): string {
  const params = new URLSearchParams();
  if (!from && !to) params.set("period", "all");
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (limit) params.set("limit", String(limit));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}
