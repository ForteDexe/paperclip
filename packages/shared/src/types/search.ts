import type { IssueDisplayStatus, IssuePriority, IssueStatus } from "../constants.js";
import type { IssueBlockerAttention } from "./issue.js";

export const SPACE_SEARCH_SCOPES = ["all", "issues", "comments", "documents", "artifacts", "agents", "projects"] as const;
export type SpaceSearchScope = (typeof SPACE_SEARCH_SCOPES)[number];

export const SPACE_SEARCH_SORTS = ["relevance", "updated", "created", "priority"] as const;
export type SpaceSearchSort = (typeof SPACE_SEARCH_SORTS)[number];

export const SPACE_SEARCH_UPDATED_WITHIN_OPTIONS = ["24h", "7d", "30d", "90d"] as const;
export type SpaceSearchUpdatedWithinOption = (typeof SPACE_SEARCH_UPDATED_WITHIN_OPTIONS)[number];

export type SpaceSearchResultType = "issue" | "artifact" | "agent" | "project";
export type SpaceSearchCountType = SpaceSearchResultType | "comment" | "document";
export type SpaceSearchIssueFilterKey =
  | "status"
  | "assigneeAgentId"
  | "assigneeUserId"
  | "projectId"
  | "labelId"
  | "priority"
  | "updatedWithin"
  | "updatedAfter";

export interface SpaceSearchHighlight {
  start: number;
  end: number;
}

export interface SpaceSearchSnippet {
  field: string;
  label: string;
  text: string;
  highlights: SpaceSearchHighlight[];
}

export interface SpaceSearchIssueSummary {
  id: string;
  identifier: string | null;
  title: string;
  status: IssueStatus;
  displayStatus?: IssueDisplayStatus;
  externalConversationState?: "active" | "waiting" | null;
  /** Glyph-only blocker state for blocked results (no blocker titles or IDs). */
  blockerAttention?: IssueBlockerAttention;
  priority: IssuePriority;
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
  projectId: string | null;
  updatedAt: string;
}

export interface SpaceSearchArtifactSummary {
  id: string;
  source: "document" | "attachment" | "work_product";
  mediaKind: "image" | "video" | "text" | "document" | "file" | "empty";
  issueId: string;
  issueIdentifier: string;
  issueTitle: string;
  projectId: string | null;
  projectName: string | null;
  updatedAt: string;
}

export interface SpaceSearchResult {
  id: string;
  type: SpaceSearchResultType;
  score: number;
  title: string;
  href: string;
  matchedFields: string[];
  sourceLabel: string | null;
  snippet: string | null;
  snippets: SpaceSearchSnippet[];
  issue?: SpaceSearchIssueSummary;
  artifact?: SpaceSearchArtifactSummary;
  updatedAt: string | null;
  previewImageUrl: string | null;
}

export interface SpaceSearchFilterOptionCounts {
  status: Partial<Record<IssueStatus, number>>;
  displayStatus?: Partial<Record<IssueDisplayStatus, number>>;
  priority: Partial<Record<IssuePriority, number>>;
  assigneeAgentId: Record<string, number>;
  assigneeUserId: Record<string, number>;
  projectId: Record<string, number>;
  labelId: Record<string, number>;
  updatedWithin: Partial<Record<SpaceSearchUpdatedWithinOption, number>>;
}

export interface SpaceSearchZeroResultsLoosenSuggestion {
  filter: SpaceSearchIssueFilterKey;
  values: string[];
  resultCount: number;
  additionalCount: number;
}

export interface SpaceSearchZeroResults {
  unfilteredTotal: number;
  loosenSuggestions: SpaceSearchZeroResultsLoosenSuggestion[];
}

export interface SpaceSearchResponse {
  query: string;
  normalizedQuery: string;
  scope: SpaceSearchScope;
  sort: SpaceSearchSort;
  limit: number;
  offset: number;
  results: SpaceSearchResult[];
  countsByType: Record<SpaceSearchCountType, number>;
  filterOptionCounts: SpaceSearchFilterOptionCounts;
  zeroResults: SpaceSearchZeroResults | null;
  hasMore: boolean;
}

export const SPACE_SEARCH_EXTRACT_SCOPES = ["all", "issues", "comments", "documents"] as const;
export type SpaceSearchExtractScope = (typeof SPACE_SEARCH_EXTRACT_SCOPES)[number];

export const SPACE_SEARCH_EXTRACT_KINDS = ["literal", "url"] as const;
export type SpaceSearchExtractKind = (typeof SPACE_SEARCH_EXTRACT_KINDS)[number];

export type SpaceSearchExtractSourceRef =
  | { type: "issue"; issueId: string }
  | { type: "comment"; commentId: string }
  | { type: "document"; documentId: string; documentKey: string };

export interface SpaceSearchExtractMatch {
  value: string;
  field: "title" | "description" | "comment" | "document_title" | "document_body";
  label: string;
  excerpt: string;
  excerptTruncated: boolean;
  source: SpaceSearchExtractSourceRef;
}

export interface SpaceSearchExtractIssueResult {
  issueId: string;
  identifier: string | null;
  title: string;
  status: IssueStatus;
  assigneeAgentId: string | null;
  updatedAt: string;
  matches: SpaceSearchExtractMatch[];
  matchesTruncated: boolean;
}

export interface SpaceSearchExtractResponse {
  contains: string;
  kind: SpaceSearchExtractKind;
  scope: SpaceSearchExtractScope;
  limit: number;
  offset: number;
  matchesPerIssue: number;
  results: SpaceSearchExtractIssueResult[];
  hasMore: boolean;
  truncated: boolean;
}
