import type {
  SpaceStatus,
  IssueThreadInteractionKind,
  IssueThreadInteractionResolverPolicy,
  PauseReason,
} from "../constants.js";

export interface InteractionResolverKindPolicy {
  defaultPolicy?: IssueThreadInteractionResolverPolicy;
  cap?: IssueThreadInteractionResolverPolicy;
}

export type InteractionResolverPolicy = Partial<
  Record<IssueThreadInteractionKind, InteractionResolverKindPolicy>
>;

export interface Space {
  id: string;
  name: string;
  description: string | null;
  /** Absolute working directory that defines this user-facing Space. */
  workspaceRoot: string | null;
  status: SpaceStatus;
  pauseReason: PauseReason | null;
  pausedAt: Date | null;
  issuePrefix: string;
  issueCounter: number;
  budgetMonthlyCents: number;
  spentMonthlyCents: number;
  defaultResponsibleUserId: string | null;
  /** Space-wide routing preference; authority still comes from permissions. */
  defaultAgentId: string | null;
  requireOperatorApprovalForNewAgents: boolean;
  interactionResolverPolicy: InteractionResolverPolicy;
  feedbackDataSharingEnabled: boolean;
  feedbackDataSharingConsentAt: Date | null;
  feedbackDataSharingConsentByUserId: string | null;
  feedbackDataSharingTermsVersion: string | null;
  logoAssetId: string | null;
  logoUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}
