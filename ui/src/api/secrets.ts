import type {
  ApproveSecretProposalInput,
  CompanySecret,
  RejectSecretProposalInput,
  SecretManagedMode,
  SecretProposalStatus,
  SecretProposalView,
  SecretProvider,
  SecretStatus,
  UserSecretDefinition,
} from "@paperclipai/shared";
import { api } from "./client";

/** One compatibility row: a legacy user-secret definition and its value. */
export interface MyUserSecretEntry {
  definition: UserSecretDefinition;
  secret: CompanySecret | null;
}

export interface CreateUserSecretDefinitionInput {
  key: string;
  name: string;
  description?: string | null;
  status?: Exclude<SecretStatus, "deleted">;
  provider?: SecretProvider;
  managedMode?: SecretManagedMode;
  providerConfigId?: string | null;
  providerMetadata?: Record<string, unknown> | null;
  usageGuidance?: string | null;
}

export interface UpsertMyUserSecretInput {
  definitionId?: string;
  definitionKey?: string;
  value?: string | null;
  externalRef?: string | null;
  providerVersionRef?: string | null;
  providerConfigId?: string | null;
}

export interface CreateSecretInput {
  name: string;
  key?: string;
  provider?: SecretProvider;
  managedMode?: SecretManagedMode;
  value?: string | null;
  description?: string | null;
  externalRef?: string | null;
  providerVersionRef?: string | null;
  providerConfigId?: string | null;
  providerMetadata?: Record<string, unknown> | null;
}

export interface UpdateSecretInput {
  name?: string;
  key?: string;
  status?: SecretStatus;
  description?: string | null;
  externalRef?: string | null;
  providerMetadata?: Record<string, unknown> | null;
}

export interface RotateSecretInput {
  value?: string | null;
  externalRef?: string | null;
  providerVersionRef?: string | null;
  providerConfigId?: string | null;
}

/**
 * Compatibility calls still used by existing agent/task/routine records.
 * Provider-vault, bulk-management and remote-import APIs were removed with the
 * Settings > Secrets page; new local Codex/Claude agents do not need them.
 */
export const secretsApi = {
  list: (companyId: string) => api.get<CompanySecret[]>(`/companies/${companyId}/secrets`),
  create: (companyId: string, data: CreateSecretInput) =>
    api.post<CompanySecret>(`/companies/${companyId}/secrets`, data),
  update: (id: string, data: UpdateSecretInput) =>
    api.patch<CompanySecret>(`/secrets/${id}`, data),
  rotate: (id: string, data: RotateSecretInput) =>
    api.post<CompanySecret>(`/secrets/${id}/rotate`, data),
  remove: (id: string) => api.delete<{ ok: true }>(`/secrets/${id}`),

  listUserSecretDefinitions: (companyId: string) =>
    api.get<UserSecretDefinition[]>(`/companies/${companyId}/user-secret-definitions`),
  createUserSecretDefinition: (companyId: string, data: CreateUserSecretDefinitionInput) =>
    api.post<UserSecretDefinition>(`/companies/${companyId}/user-secret-definitions`, data),
  removeUserSecretDefinition: (companyId: string, definitionId: string) =>
    api.delete<{ ok: true }>(`/companies/${companyId}/user-secret-definitions/${definitionId}`),

  listMyUserSecrets: (companyId: string) =>
    api.get<MyUserSecretEntry[]>(`/companies/${companyId}/me/user-secrets`),
  createMyUserSecret: (companyId: string, data: UpsertMyUserSecretInput) =>
    api.post<CompanySecret>(`/companies/${companyId}/me/user-secrets`, data),
  rotateMyUserSecret: (companyId: string, secretId: string, data: UpsertMyUserSecretInput) =>
    api.post<CompanySecret>(`/companies/${companyId}/me/user-secrets/${secretId}/rotate`, data),

  listProposals: (companyId: string, status: SecretProposalStatus = "pending") =>
    api.get<SecretProposalView[]>(
      `/companies/${companyId}/secret-proposals?status=${encodeURIComponent(status)}`,
    ),
  approveProposal: (companyId: string, proposalId: string, data: ApproveSecretProposalInput = {}) =>
    api.post<SecretProposalView>(
      `/companies/${companyId}/secret-proposals/${proposalId}/approve`,
      data,
    ),
  rejectProposal: (companyId: string, proposalId: string, data: RejectSecretProposalInput) =>
    api.post<SecretProposalView>(
      `/companies/${companyId}/secret-proposals/${proposalId}/reject`,
      data,
    ),
};
