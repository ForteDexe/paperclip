import type {
  ApproveSecretProposalInput,
  SpaceSecret,
  RejectSecretProposalInput,
  SecretManagedMode,
  SecretProposalStatus,
  SecretProposalView,
  SecretProvider,
  SecretStatus,
  UserSecretDefinition,
} from "@outpost/shared";
import { api } from "./client";

/** One compatibility row: a legacy user-secret definition and its value. */
export interface MyUserSecretEntry {
  definition: UserSecretDefinition;
  secret: SpaceSecret | null;
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
  list: (spaceId: string) => api.get<SpaceSecret[]>(`/spaces/${spaceId}/secrets`),
  create: (spaceId: string, data: CreateSecretInput) =>
    api.post<SpaceSecret>(`/spaces/${spaceId}/secrets`, data),
  update: (id: string, data: UpdateSecretInput) =>
    api.patch<SpaceSecret>(`/secrets/${id}`, data),
  rotate: (id: string, data: RotateSecretInput) =>
    api.post<SpaceSecret>(`/secrets/${id}/rotate`, data),
  remove: (id: string) => api.delete<{ ok: true }>(`/secrets/${id}`),

  listUserSecretDefinitions: (spaceId: string) =>
    api.get<UserSecretDefinition[]>(`/spaces/${spaceId}/user-secret-definitions`),
  createUserSecretDefinition: (spaceId: string, data: CreateUserSecretDefinitionInput) =>
    api.post<UserSecretDefinition>(`/spaces/${spaceId}/user-secret-definitions`, data),
  removeUserSecretDefinition: (spaceId: string, definitionId: string) =>
    api.delete<{ ok: true }>(`/spaces/${spaceId}/user-secret-definitions/${definitionId}`),

  listMyUserSecrets: (spaceId: string) =>
    api.get<MyUserSecretEntry[]>(`/spaces/${spaceId}/me/user-secrets`),
  createMyUserSecret: (spaceId: string, data: UpsertMyUserSecretInput) =>
    api.post<SpaceSecret>(`/spaces/${spaceId}/me/user-secrets`, data),
  rotateMyUserSecret: (spaceId: string, secretId: string, data: UpsertMyUserSecretInput) =>
    api.post<SpaceSecret>(`/spaces/${spaceId}/me/user-secrets/${secretId}/rotate`, data),

  listProposals: (spaceId: string, status: SecretProposalStatus = "pending") =>
    api.get<SecretProposalView[]>(
      `/spaces/${spaceId}/secret-proposals?status=${encodeURIComponent(status)}`,
    ),
  approveProposal: (spaceId: string, proposalId: string, data: ApproveSecretProposalInput = {}) =>
    api.post<SecretProposalView>(
      `/spaces/${spaceId}/secret-proposals/${proposalId}/approve`,
      data,
    ),
  rejectProposal: (spaceId: string, proposalId: string, data: RejectSecretProposalInput) =>
    api.post<SecretProposalView>(
      `/spaces/${spaceId}/secret-proposals/${proposalId}/reject`,
      data,
    ),
};
