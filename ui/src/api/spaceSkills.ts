import type {
  CatalogSkill,
  CatalogSkillFileDetail,
  CatalogSkillKind,
  SpaceSkill,
  SpaceSkillCategoryCount,
  SpaceSkillComment,
  SpaceSkillCommentCreateRequest,
  SpaceSkillCommentUpdateRequest,
  SpaceSkillCreateRequest,
  SpaceSkillDetail,
  SpaceSkillFileDetail,
  SpaceSkillFileDeleteRequest,
  SpaceSkillFileDeleteResult,
  SpaceSkillForkPrecheckResult,
  SpaceSkillForkRequest,
  SpaceSkillForkResult,
  SpaceSkillImportResult,
  SpaceSkillInstallCatalogRequest,
  SpaceSkillInstallCatalogResult,
  SpaceSkillListQuery,
  SpaceSkillListItem,
  SpaceSkillProjectBrowseRequest,
  SpaceSkillProjectBrowseResult,
  SpaceSkillProjectScanRequest,
  SpaceSkillProjectScanResult,
  SpaceSkillStarResult,
  SpaceSkillTestInput,
  SpaceSkillTestInputCreateRequest,
  SpaceSkillTestInputUpdateRequest,
  SpaceSkillTestRun,
  SpaceSkillTestRunCreateRequest,
  SpaceSkillTestRunDetail,
  SpaceSkillTestRunListQuery,
  SpaceSkillTestRunTemplate,
  SpaceSkillTestRunTemplateCreateRequest,
  SpaceSkillTestRunTemplateUpdateRequest,
  SpaceSkillUpdateRequest,
  SpaceSkillUpdateStatus,
  SpaceSkillVersion,
  SpaceSkillVersionSummary,
  SpaceSkillVersionCreateRequest,
} from "@outpost/shared";
import { api } from "./client";

export interface CatalogListQuery {
  kind?: CatalogSkillKind;
  category?: string;
  q?: string;
}

export const spaceSkillsApi = {
  list: (spaceId: string, query: SpaceSkillListQuery = {}) => {
    const params = new URLSearchParams();
    if (query.q) params.set("q", query.q);
    if (query.sort) params.set("sort", query.sort);
    if (query.scope) params.set("scope", query.scope);
    for (const category of query.categories ?? []) params.append("categories[]", category);
    for (const include of query.include ?? []) params.append("include[]", include);
    const search = params.toString();
    return api.get<SpaceSkillListItem[]>(`/spaces/${encodeURIComponent(spaceId)}/skills${search ? `?${search}` : ""}`);
  },
  categories: (spaceId: string) =>
    api.get<SpaceSkillCategoryCount[]>(`/spaces/${encodeURIComponent(spaceId)}/skills/categories`),
  detail: (spaceId: string, skillId: string) =>
    api.get<SpaceSkillDetail>(
      `/spaces/${encodeURIComponent(spaceId)}/skills/${encodeURIComponent(skillId)}`,
    ),
  versions: (spaceId: string, skillId: string) =>
    api.get<SpaceSkillVersionSummary[]>(
      `/spaces/${encodeURIComponent(spaceId)}/skills/${encodeURIComponent(skillId)}/versions`,
    ),
  version: (spaceId: string, skillId: string, versionId: string) =>
    api.get<SpaceSkillVersion>(
      `/spaces/${encodeURIComponent(spaceId)}/skills/${encodeURIComponent(skillId)}/versions/${encodeURIComponent(versionId)}`,
    ),
  createVersion: (spaceId: string, skillId: string, payload: SpaceSkillVersionCreateRequest = {}) =>
    api.post<SpaceSkillVersion>(
      `/spaces/${encodeURIComponent(spaceId)}/skills/${encodeURIComponent(skillId)}/versions`,
      payload,
    ),
  // --- Skill Studio test inputs (PAP-12960 P1 API) ---
  testInputs: (spaceId: string, skillId: string) =>
    api.get<SpaceSkillTestInput[]>(
      `/spaces/${encodeURIComponent(spaceId)}/skills/${encodeURIComponent(skillId)}/test-inputs`,
    ),
  createTestInput: (spaceId: string, skillId: string, payload: SpaceSkillTestInputCreateRequest) =>
    api.post<SpaceSkillTestInput>(
      `/spaces/${encodeURIComponent(spaceId)}/skills/${encodeURIComponent(skillId)}/test-inputs`,
      payload,
    ),
  updateTestInput: (
    spaceId: string,
    skillId: string,
    inputId: string,
    payload: SpaceSkillTestInputUpdateRequest,
  ) =>
    api.patch<SpaceSkillTestInput>(
      `/spaces/${encodeURIComponent(spaceId)}/skills/${encodeURIComponent(skillId)}/test-inputs/${encodeURIComponent(inputId)}`,
      payload,
    ),
  deleteTestInput: (spaceId: string, skillId: string, inputId: string) =>
    api.delete<SpaceSkillTestInput>(
      `/spaces/${encodeURIComponent(spaceId)}/skills/${encodeURIComponent(skillId)}/test-inputs/${encodeURIComponent(inputId)}`,
    ),
  // --- Skill Studio cross-skill run templates ---
  testRunTemplates: (spaceId: string) =>
    api.get<SpaceSkillTestRunTemplate[]>(
      `/spaces/${encodeURIComponent(spaceId)}/skill-test-run-templates`,
    ),
  createTestRunTemplate: (spaceId: string, payload: SpaceSkillTestRunTemplateCreateRequest) =>
    api.post<SpaceSkillTestRunTemplate>(
      `/spaces/${encodeURIComponent(spaceId)}/skill-test-run-templates`,
      payload,
    ),
  updateTestRunTemplate: (spaceId: string, templateId: string, payload: SpaceSkillTestRunTemplateUpdateRequest) =>
    api.patch<SpaceSkillTestRunTemplate>(
      `/spaces/${encodeURIComponent(spaceId)}/skill-test-run-templates/${encodeURIComponent(templateId)}`,
      payload,
    ),
  deleteTestRunTemplate: (spaceId: string, templateId: string) =>
    api.delete<SpaceSkillTestRunTemplate>(
      `/spaces/${encodeURIComponent(spaceId)}/skill-test-run-templates/${encodeURIComponent(templateId)}`,
    ),
  // --- Skill Studio test runs ---
  testRuns: (spaceId: string, skillId: string, query: SpaceSkillTestRunListQuery = {}) => {
    const params = new URLSearchParams();
    if (query.inputId) params.set("inputId", query.inputId);
    const search = params.toString();
    return api.get<SpaceSkillTestRun[]>(
      `/spaces/${encodeURIComponent(spaceId)}/skills/${encodeURIComponent(skillId)}/test-runs${search ? `?${search}` : ""}`,
    );
  },
  testRunDetail: (spaceId: string, skillId: string, runId: string) =>
    api.get<SpaceSkillTestRunDetail>(
      `/spaces/${encodeURIComponent(spaceId)}/skills/${encodeURIComponent(skillId)}/test-runs/${encodeURIComponent(runId)}`,
    ),
  createTestRun: (spaceId: string, skillId: string, payload: SpaceSkillTestRunCreateRequest) =>
    api.post<SpaceSkillTestRun>(
      `/spaces/${encodeURIComponent(spaceId)}/skills/${encodeURIComponent(skillId)}/test-runs`,
      payload,
    ),
  cancelTestRun: (spaceId: string, skillId: string, runId: string) =>
    api.post<SpaceSkillTestRun>(
      `/spaces/${encodeURIComponent(spaceId)}/skills/${encodeURIComponent(skillId)}/test-runs/${encodeURIComponent(runId)}/cancel`,
      {},
    ),
  deleteTestRun: (spaceId: string, skillId: string, runId: string) =>
    api.delete<SpaceSkillTestRun>(
      `/spaces/${encodeURIComponent(spaceId)}/skills/${encodeURIComponent(skillId)}/test-runs/${encodeURIComponent(runId)}`,
    ),
  star: (spaceId: string, skillId: string) =>
    api.post<SpaceSkillStarResult>(
      `/spaces/${encodeURIComponent(spaceId)}/skills/${encodeURIComponent(skillId)}/star`,
      {},
    ),
  unstar: (spaceId: string, skillId: string) =>
    api.delete<SpaceSkillStarResult>(
      `/spaces/${encodeURIComponent(spaceId)}/skills/${encodeURIComponent(skillId)}/star`,
    ),
  fork: (spaceId: string, skillId: string, payload: SpaceSkillForkRequest = {}) =>
    api.post<SpaceSkillForkResult>(
      `/spaces/${encodeURIComponent(spaceId)}/skills/${encodeURIComponent(skillId)}/fork`,
      payload,
    ),
  forkPrecheck: (spaceId: string, skillId: string) =>
    api.get<SpaceSkillForkPrecheckResult>(
      `/spaces/${encodeURIComponent(spaceId)}/skills/${encodeURIComponent(skillId)}/fork-precheck`,
    ),
  comments: (spaceId: string, skillId: string) =>
    api.get<SpaceSkillComment[]>(
      `/spaces/${encodeURIComponent(spaceId)}/skills/${encodeURIComponent(skillId)}/comments`,
    ),
  createComment: (spaceId: string, skillId: string, payload: SpaceSkillCommentCreateRequest) =>
    api.post<SpaceSkillComment>(
      `/spaces/${encodeURIComponent(spaceId)}/skills/${encodeURIComponent(skillId)}/comments`,
      payload,
    ),
  updateComment: (spaceId: string, skillId: string, commentId: string, payload: SpaceSkillCommentUpdateRequest) =>
    api.patch<SpaceSkillComment>(
      `/spaces/${encodeURIComponent(spaceId)}/skills/${encodeURIComponent(skillId)}/comments/${encodeURIComponent(commentId)}`,
      payload,
    ),
  deleteComment: (spaceId: string, skillId: string, commentId: string) =>
    api.delete<SpaceSkillComment>(
      `/spaces/${encodeURIComponent(spaceId)}/skills/${encodeURIComponent(skillId)}/comments/${encodeURIComponent(commentId)}`,
    ),
  updateStatus: (spaceId: string, skillId: string) =>
    api.get<SpaceSkillUpdateStatus>(
      `/spaces/${encodeURIComponent(spaceId)}/skills/${encodeURIComponent(skillId)}/update-status`,
    ),
  file: (spaceId: string, skillId: string, relativePath: string) =>
    api.get<SpaceSkillFileDetail>(
      `/spaces/${encodeURIComponent(spaceId)}/skills/${encodeURIComponent(skillId)}/files?path=${encodeURIComponent(relativePath)}`,
    ),
  updateFile: (spaceId: string, skillId: string, path: string, content: string, format: Pick<SpaceSkillFileDetail, "encoding" | "executable"> & { expectedVersionId?: string | null } = {}) =>
    api.patch<SpaceSkillFileDetail>(
      `/spaces/${encodeURIComponent(spaceId)}/skills/${encodeURIComponent(skillId)}/files`,
      { path, content, ...format },
    ),
  deleteFile: (spaceId: string, skillId: string, payload: SpaceSkillFileDeleteRequest) =>
    api.deleteWithBody<SpaceSkillFileDeleteResult>(
      `/spaces/${encodeURIComponent(spaceId)}/skills/${encodeURIComponent(skillId)}/files`,
      payload,
    ),
  create: (spaceId: string, payload: SpaceSkillCreateRequest) =>
    api.post<SpaceSkill>(
      `/spaces/${encodeURIComponent(spaceId)}/skills`,
      payload,
    ),
  update: (spaceId: string, skillId: string, payload: SpaceSkillUpdateRequest) =>
    api.patch<SpaceSkill>(
      `/spaces/${encodeURIComponent(spaceId)}/skills/${encodeURIComponent(skillId)}`,
      payload,
    ),
  importFromSource: (spaceId: string, source: string) =>
    api.post<SpaceSkillImportResult>(
      `/spaces/${encodeURIComponent(spaceId)}/skills/import`,
      { source },
    ),
  browseProject: (spaceId: string, payload: SpaceSkillProjectBrowseRequest) =>
    api.post<SpaceSkillProjectBrowseResult>(
      `/spaces/${encodeURIComponent(spaceId)}/skills/browse-project`,
      payload,
    ),
  scanProjects: (spaceId: string, payload: SpaceSkillProjectScanRequest = {}) =>
    api.post<SpaceSkillProjectScanResult>(
      `/spaces/${encodeURIComponent(spaceId)}/skills/scan-projects`,
      payload,
    ),
  installUpdate: (spaceId: string, skillId: string) =>
    api.post<SpaceSkill>(
      `/spaces/${encodeURIComponent(spaceId)}/skills/${encodeURIComponent(skillId)}/install-update`,
      {},
    ),
  delete: (spaceId: string, skillId: string) =>
    api.delete<SpaceSkill>(
      `/spaces/${encodeURIComponent(spaceId)}/skills/${encodeURIComponent(skillId)}`,
    ),
  catalogList: (query: CatalogListQuery = {}) => {
    const params = new URLSearchParams();
    if (query.kind) params.set("kind", query.kind);
    if (query.category) params.set("category", query.category);
    if (query.q) params.set("q", query.q);
    const search = params.toString();
    return api.get<CatalogSkill[]>(`/skills/catalog${search ? `?${search}` : ""}`);
  },
  catalogDetail: (catalogRef: string) =>
    api.get<CatalogSkill>(`/skills/catalog/${encodeURIComponent(catalogRef)}`),
  catalogFile: (catalogRef: string, relativePath: string = "SKILL.md") =>
    api.get<CatalogSkillFileDetail>(
      `/skills/catalog/${encodeURIComponent(catalogRef)}/files?path=${encodeURIComponent(relativePath)}`,
    ),
  installCatalog: (spaceId: string, payload: SpaceSkillInstallCatalogRequest) =>
    api.post<SpaceSkillInstallCatalogResult>(
      `/spaces/${encodeURIComponent(spaceId)}/skills/install-catalog`,
      payload,
    ),
};
