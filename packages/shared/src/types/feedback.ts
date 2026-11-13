export const FEEDBACK_TARGET_TYPES = ["issue_comment", "issue_document_revision"] as const;
export type FeedbackTargetType = (typeof FEEDBACK_TARGET_TYPES)[number];

export const FEEDBACK_VOTE_VALUES = ["up", "down"] as const;
export type FeedbackVoteValue = (typeof FEEDBACK_VOTE_VALUES)[number];

// Retained for compatibility with stored instance settings. Outpost no longer
// uses this preference to upload or share feedback.
export const FEEDBACK_DATA_SHARING_PREFERENCES = ["allowed", "not_allowed", "prompt"] as const;
export type FeedbackDataSharingPreference = (typeof FEEDBACK_DATA_SHARING_PREFERENCES)[number];
export const DEFAULT_FEEDBACK_DATA_SHARING_PREFERENCE: FeedbackDataSharingPreference = "prompt";
export const DEFAULT_FEEDBACK_DATA_SHARING_TERMS_VERSION = "feedback-data-sharing-v1";

export interface FeedbackVote {
  id: string;
  companyId: string;
  issueId: string;
  targetType: FeedbackTargetType;
  targetId: string;
  authorUserId: string;
  vote: FeedbackVoteValue;
  reason: string | null;
  createdAt: Date;
  updatedAt: Date;
}
