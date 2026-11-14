import type { AgentAdapterType, JoinRequest, PermissionKey } from "@outpost/shared";
import { api, type RequestOptions } from "./client";

export type HumanSpaceRole = "owner" | "admin" | "operator" | "viewer";

type InviteSummary = {
  id: string;
  spaceId: string | null;
  spaceName?: string | null;
  spaceLogoUrl?: string | null;
  inviteType: "space_join" | "bootstrap_lead";
  allowedJoinTypes: "human" | "agent" | "both";
  humanRole?: HumanSpaceRole | null;
  expiresAt: string;
  onboardingPath?: string;
  onboardingUrl?: string;
  onboardingTextPath?: string;
  onboardingTextUrl?: string;
  skillIndexPath?: string;
  skillIndexUrl?: string;
  inviteMessage?: string | null;
  invitedByUserName?: string | null;
  joinRequestStatus?: JoinRequest["status"] | null;
  joinRequestType?: JoinRequest["requestType"] | null;
};

type AcceptInviteInput =
  | { requestType: "human" }
  | {
    requestType: "agent";
    agentName: string;
    adapterType?: AgentAdapterType;
    capabilities?: string | null;
    agentDefaultsPayload?: Record<string, unknown> | null;
  };

type AgentJoinRequestAccepted = JoinRequest & {
  claimSecret: string;
  claimApiKeyPath: string;
  onboarding?: Record<string, unknown>;
  diagnostics?: Array<{
    code: string;
    level: "info" | "warn";
    message: string;
    hint?: string;
  }>;
};

type InviteOnboardingManifest = {
  invite: InviteSummary;
  onboarding: {
    inviteMessage?: string | null;
    connectivity?: {
      guidance?: string;
      connectionCandidates?: string[];
      testResolutionEndpoint?: {
        method?: string;
        path?: string;
        url?: string;
      };
    };
    textInstructions?: {
      url?: string;
    };
  };
};

type OperatorClaimStatus = {
  status: "available" | "claimed" | "expired";
  requiresSignIn: boolean;
  expiresAt: string | null;
  claimedByUserId: string | null;
};

type CliAuthChallengeStatus = {
  id: string;
  status: "pending" | "approved" | "cancelled" | "expired";
  command: string;
  clientName: string | null;
  requestedAccess: "operator" | "instance_admin_required";
  requestedSpaceId: string | null;
  requestedSpaceName: string | null;
  approvedAt: string | null;
  cancelledAt: string | null;
  expiresAt: string;
  approvedByUser: { id: string; name: string; email: string } | null;
  requiresSignIn: boolean;
  canApprove: boolean;
  currentUserId: string | null;
};

type SpaceInviteCreated = {
  id: string;
  token: string;
  inviteUrl: string;
  expiresAt: string;
  allowedJoinTypes: "human" | "agent" | "both";
  humanRole?: HumanSpaceRole | null;
  spaceName?: string | null;
  onboardingTextPath?: string;
  onboardingTextUrl?: string;
  inviteMessage?: string | null;
};

export type SpaceMemberGrant = {
  id: string;
  spaceId: string;
  principalType: "user";
  principalId: string;
  permissionKey: PermissionKey;
  scope: Record<string, unknown> | null;
  grantedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SpaceMember = {
  id: string;
  spaceId: string;
  principalType: "user";
  principalId: string;
  status: "pending" | "active" | "suspended" | "archived";
  membershipRole: HumanSpaceRole | null;
  createdAt: string;
  updatedAt: string;
  user: { id: string; email: string | null; name: string | null; image: string | null } | null;
  grants: SpaceMemberGrant[];
  removal?: {
    canArchive: boolean;
    reason: string | null;
  };
};

export type ArchiveSpaceMemberResponse = {
  member: SpaceMember;
  reassignedIssueCount: number;
};

export type SpaceMembersResponse = {
  members: SpaceMember[];
  access: {
    currentUserRole: HumanSpaceRole | null;
    canManageMembers: boolean;
    canInviteUsers: boolean;
    canApproveJoinRequests: boolean;
  };
};

export type SpaceUserDirectoryEntry = {
  principalId: string;
  status: "active";
  membershipRole: string | null;
  user: { id: string; email: string | null; name: string | null; image: string | null } | null;
};

export type SpaceUserDirectoryResponse = {
  users: SpaceUserDirectoryEntry[];
};

export type SpaceInviteRecord = {
  id: string;
  spaceId: string | null;
  spaceName: string | null;
  inviteType: "space_join" | "bootstrap_lead";
  allowedJoinTypes: "human" | "agent" | "both";
  humanRole: HumanSpaceRole | null;
  defaultsPayload: Record<string, unknown> | null;
  expiresAt: string;
  invitedByUserId: string | null;
  revokedAt: string | null;
  acceptedAt: string | null;
  createdAt: string;
  updatedAt: string;
  inviteMessage: string | null;
  state: "active" | "revoked" | "accepted" | "expired";
  invitedByUser: { id: string; email: string | null; name: string | null; image: string | null } | null;
  relatedJoinRequestId: string | null;
};

export type SpaceInviteListResponse = {
  invites: SpaceInviteRecord[];
  nextOffset: number | null;
};

export type SpaceJoinRequest = JoinRequest & {
  requesterUser: { id: string; email: string | null; name: string | null; image: string | null } | null;
  approvedByUser: { id: string; email: string | null; name: string | null; image: string | null } | null;
  rejectedByUser: { id: string; email: string | null; name: string | null; image: string | null } | null;
  invite: {
    id: string;
    inviteType: "space_join" | "bootstrap_lead";
    allowedJoinTypes: "human" | "agent" | "both";
    humanRole: HumanSpaceRole | null;
    inviteMessage: string | null;
    createdAt: string;
    expiresAt: string;
    revokedAt: string | null;
    acceptedAt: string | null;
    invitedByUser: { id: string; email: string | null; name: string | null; image: string | null } | null;
  } | null;
};

export type AdminUserDirectoryEntry = {
  id: string;
  email: string | null;
  name: string | null;
  image: string | null;
  isInstanceAdmin: boolean;
  activeSpaceMembershipCount: number;
};

export type CurrentOperatorAccess = {
  user: { id: string; email: string | null; name: string | null; image: string | null } | null;
  userId: string;
  isInstanceAdmin: boolean;
  spaceIds: string[];
  memberships?: Array<{
    spaceId: string;
    membershipRole: HumanSpaceRole | "member" | null;
    status: "pending" | "active" | "suspended" | "archived";
  }>;
  source: string;
  keyId: string | null;
};

function buildInviteListQuery(options: {
  state?: "active" | "revoked" | "accepted" | "expired";
  limit?: number;
  offset?: number;
}) {
  const params = new URLSearchParams();
  if (options.state) params.set("state", options.state);
  if (options.limit) params.set("limit", String(options.limit));
  if (options.offset) params.set("offset", String(options.offset));
  const query = params.toString();
  return query ? `?${query}` : "";
}

export const accessApi = {
  createSpaceInvite: (
    spaceId: string,
    input: {
      allowedJoinTypes?: "human" | "agent" | "both";
      humanRole?: HumanSpaceRole | null;
      defaultsPayload?: Record<string, unknown> | null;
      agentMessage?: string | null;
    } = {},
  ) =>
    api.post<SpaceInviteCreated>(`/spaces/${spaceId}/invites`, input),

  createOpenClawInvitePrompt: (
    spaceId: string,
    input: {
      agentMessage?: string | null;
    } = {},
  ) =>
    api.post<SpaceInviteCreated>(
      `/spaces/${spaceId}/openclaw/invite-prompt`,
      input,
    ),

  getInvite: (token: string) => api.get<InviteSummary>(`/invites/${token}`),
  getInviteOnboarding: (token: string) =>
    api.get<InviteOnboardingManifest>(`/invites/${token}/onboarding`),

  acceptInvite: (token: string, input: AcceptInviteInput) =>
    api.post<AgentJoinRequestAccepted | JoinRequest | { bootstrapAccepted: true; userId: string }>(
      `/invites/${token}/accept`,
      input,
    ),

  listInvites: (
    spaceId: string,
    options: {
      state?: "active" | "revoked" | "accepted" | "expired";
      limit?: number;
      offset?: number;
    } = {},
  ) =>
    api.get<SpaceInviteListResponse>(
      `/spaces/${spaceId}/invites${buildInviteListQuery(options)}`,
    ),

  revokeInvite: (inviteId: string) => api.post(`/invites/${inviteId}/revoke`, {}),

  listJoinRequests: (
    spaceId: string,
    status: "pending_approval" | "approved" | "rejected" = "pending_approval",
    requestType?: "human" | "agent",
    options?: RequestOptions,
  ) =>
    api.get<SpaceJoinRequest[]>(
      `/spaces/${spaceId}/join-requests?status=${status}${requestType ? `&requestType=${requestType}` : ""}`,
      options,
    ),

  listMembers: (spaceId: string) =>
    api.get<SpaceMembersResponse>(`/spaces/${spaceId}/members`),

  listUserDirectory: (spaceId: string, options?: RequestOptions) =>
    api.get<SpaceUserDirectoryResponse>(`/spaces/${spaceId}/user-directory`, options),

  updateMember: (
    spaceId: string,
    memberId: string,
    input: {
      membershipRole?: HumanSpaceRole | null;
      status?: "pending" | "active" | "suspended";
    },
  ) => api.patch<SpaceMember>(`/spaces/${spaceId}/members/${memberId}`, input),

  updateMemberPermissions: (
    spaceId: string,
    memberId: string,
    input: {
      grants: Array<{
        permissionKey: PermissionKey;
        scope?: Record<string, unknown> | null;
      }>;
    },
  ) => api.patch<SpaceMember>(`/spaces/${spaceId}/members/${memberId}/permissions`, input),

  updateMemberAccess: (
    spaceId: string,
    memberId: string,
    input: {
      membershipRole?: HumanSpaceRole | null;
      status?: "pending" | "active" | "suspended";
      grants: Array<{
        permissionKey: PermissionKey;
        scope?: Record<string, unknown> | null;
      }>;
    },
  ) => api.patch<SpaceMember>(`/spaces/${spaceId}/members/${memberId}/role-and-grants`, input),

  archiveMember: (
    spaceId: string,
    memberId: string,
    input: {
      reassignment?: {
        assigneeAgentId?: string | null;
        assigneeUserId?: string | null;
      } | null;
    } = {},
  ) => api.post<ArchiveSpaceMemberResponse>(`/spaces/${spaceId}/members/${memberId}/archive`, input),

  approveJoinRequest: (spaceId: string, requestId: string) =>
    api.post<JoinRequest>(`/spaces/${spaceId}/join-requests/${requestId}/approve`, {}),

  rejectJoinRequest: (spaceId: string, requestId: string) =>
    api.post<JoinRequest>(`/spaces/${spaceId}/join-requests/${requestId}/reject`, {}),

  claimJoinRequestApiKey: (requestId: string, claimSecret: string) =>
    api.post<{ keyId: string; token: string; agentId: string; createdAt: string }>(
      `/join-requests/${requestId}/claim-api-key`,
      { claimSecret },
    ),

  getOperatorClaimStatus: (token: string, code: string) =>
    api.get<OperatorClaimStatus>(`/operator-claim/${token}?code=${encodeURIComponent(code)}`),

  claimOperator: (token: string, code: string) =>
    api.post<{ claimed: true; userId: string }>(`/operator-claim/${token}/claim`, { code }),

  claimBootstrapAdmin: () =>
    api.post<{ claimed: true; userId: string }>("/bootstrap/claim", {}),

  getCliAuthChallenge: (id: string, token: string) =>
    api.get<CliAuthChallengeStatus>(`/cli-auth/challenges/${id}?token=${encodeURIComponent(token)}`),

  approveCliAuthChallenge: (id: string, token: string) =>
    api.post<{ approved: boolean; status: string; userId: string; keyId: string | null; expiresAt: string }>(
      `/cli-auth/challenges/${id}/approve`,
      { token },
    ),

  cancelCliAuthChallenge: (id: string, token: string) =>
    api.post<{ cancelled: boolean; status: string }>(`/cli-auth/challenges/${id}/cancel`, { token }),

  searchAdminUsers: (query: string) =>
    api.get<AdminUserDirectoryEntry[]>(`/admin/users?query=${encodeURIComponent(query)}`),

  promoteInstanceAdmin: (userId: string) =>
    api.post(`/admin/users/${userId}/promote-instance-admin`, {}),

  demoteInstanceAdmin: (userId: string) =>
    api.post(`/admin/users/${userId}/demote-instance-admin`, {}),

  getCurrentOperatorAccess: () =>
    api.get<CurrentOperatorAccess>("/cli-auth/me"),
};
