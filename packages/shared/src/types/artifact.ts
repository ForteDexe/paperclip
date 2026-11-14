export type SpaceArtifactSource = "document" | "attachment" | "work_product";

export type SpaceArtifactMediaKind = "image" | "video" | "text" | "document" | "file" | "empty";

export type SpaceArtifactGroupBy = "none" | "task" | "parent_task";

export interface SpaceArtifactIssueSummary {
  id: string;
  identifier: string;
  title: string;
}

export interface SpaceArtifactProjectSummary {
  id: string;
  name: string;
}

export interface SpaceArtifactAgentSummary {
  id: string;
  name: string;
}

export interface SpaceArtifact {
  id: string;
  source: SpaceArtifactSource;
  mediaKind: SpaceArtifactMediaKind;
  title: string;
  previewText: string | null;
  contentType: string | null;
  contentPath: string | null;
  openPath: string | null;
  downloadPath: string | null;
  issue: SpaceArtifactIssueSummary;
  project: SpaceArtifactProjectSummary | null;
  createdByAgent: SpaceArtifactAgentSummary | null;
  updatedAt: string;
  href: string;
}

export interface SpaceArtifactGroup {
  id: string;
  groupBy: Exclude<SpaceArtifactGroupBy, "none">;
  issue: SpaceArtifactIssueSummary;
  title: string;
  count: number;
  mediaKinds: SpaceArtifactMediaKind[];
  previewArtifacts: SpaceArtifact[];
  updatedAt: string;
  href: string;
}

export interface SpaceArtifactsResponse {
  artifacts: SpaceArtifact[];
  groups?: SpaceArtifactGroup[];
  selectedGroup?: SpaceArtifactGroup | null;
  nextCursor: string | null;
}
