import type {
  BudgetIncident,
  BudgetIncidentResolutionInput,
  BudgetOverview,
  BudgetPolicySummary,
  BudgetPolicyUpsertInput,
} from "@outpost/shared";
import { api } from "./client";

export const budgetsApi = {
  overview: (spaceId: string) =>
    api.get<BudgetOverview>(`/spaces/${spaceId}/budgets/overview`),
  upsertPolicy: (spaceId: string, data: BudgetPolicyUpsertInput) =>
    api.post<BudgetPolicySummary>(`/spaces/${spaceId}/budgets/policies`, data),
  resolveIncident: (spaceId: string, incidentId: string, data: BudgetIncidentResolutionInput) =>
    api.post<BudgetIncident>(
      `/spaces/${spaceId}/budget-incidents/${encodeURIComponent(incidentId)}/resolve`,
      data,
    ),
};
