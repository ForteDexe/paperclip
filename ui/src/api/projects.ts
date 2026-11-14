import type {
  Project,
  ProjectAccessMember,
  ProjectRepositoryOptions,
  ProjectEnvironmentOptions,
  ProjectGitAuthorization,
  ProjectWorkspace,
  WorkspaceOperation,
  WorkspaceRuntimeControlTarget,
} from "@outpost/shared";
import { api } from "./client";
import { sanitizeWorkspaceRuntimeControlTarget } from "./workspace-runtime-control";

function withSpaceScope(path: string, spaceId?: string) {
  if (!spaceId) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}spaceId=${encodeURIComponent(spaceId)}`;
}

function projectPath(id: string, spaceId?: string, suffix = "") {
  return withSpaceScope(`/projects/${encodeURIComponent(id)}${suffix}`, spaceId);
}

export const projectsApi = {
  environmentOptions: (spaceId: string) => api.get<ProjectEnvironmentOptions>(`/spaces/${spaceId}/project-environments`),
  gitAuthorization: (id: string) => api.get<ProjectGitAuthorization>(projectPath(id, undefined, "/git-authorization")),
  setGitAuthorization: (id: string, grantId: string | null) => api.put<ProjectGitAuthorization>(projectPath(id, undefined, "/git-authorization"), { grantId }),
  repositoryOptions: (spaceId: string) => api.get<ProjectRepositoryOptions>(`/spaces/${spaceId}/project-repositories`),
  setRepositories: (id: string, repositoryIds: string[]) => api.put<Project>(projectPath(id, undefined, "/repositories"), { repositoryIds }),
  list: (spaceId: string, opts: { includeArchived?: boolean } = {}) => {
    const params = new URLSearchParams();
    if (opts.includeArchived) params.set("includeArchived", "true");
    const query = params.toString();
    return api.get<Project[]>("/spaces/" + encodeURIComponent(spaceId) + "/projects" + (query ? "?" + query : ""));
  },
  get: (id: string, spaceId?: string) => api.get<Project>(projectPath(id, spaceId)),
  create: (spaceId: string, data: Record<string, unknown>) =>
    api.post<Project>(`/spaces/${spaceId}/projects`, data),
  update: (id: string, data: Record<string, unknown>, spaceId?: string) =>
    api.patch<Project>(projectPath(id, spaceId), data),
  listAccessMembers: (id: string, spaceId?: string) =>
    api.get<ProjectAccessMember[]>(projectPath(id, spaceId, "/access-members")),
  addAccessMember: (
    id: string,
    data: { subjectType: "user" | "agent"; subjectId: string },
    spaceId?: string,
  ) => api.post<ProjectAccessMember>(projectPath(id, spaceId, "/access-members"), data),
  removeAccessMember: (id: string, memberId: string, spaceId?: string) =>
    api.delete<ProjectAccessMember>(
      projectPath(id, spaceId, `/access-members/${encodeURIComponent(memberId)}`),
    ),
  listWorkspaces: (projectId: string, spaceId?: string) =>
    api.get<ProjectWorkspace[]>(projectPath(projectId, spaceId, "/workspaces")),
  createWorkspace: (projectId: string, data: Record<string, unknown>, spaceId?: string) =>
    api.post<ProjectWorkspace>(projectPath(projectId, spaceId, "/workspaces"), data),
  updateWorkspace: (projectId: string, workspaceId: string, data: Record<string, unknown>, spaceId?: string) =>
    api.patch<ProjectWorkspace>(
      projectPath(projectId, spaceId, `/workspaces/${encodeURIComponent(workspaceId)}`),
      data,
    ),
  controlWorkspaceRuntimeServices: (
    projectId: string,
    workspaceId: string,
    action: "start" | "stop" | "restart",
    spaceId?: string,
    target: WorkspaceRuntimeControlTarget = {},
  ) =>
    api.post<{ workspace: ProjectWorkspace; operation: WorkspaceOperation }>(
      projectPath(projectId, spaceId, `/workspaces/${encodeURIComponent(workspaceId)}/runtime-services/${action}`),
      sanitizeWorkspaceRuntimeControlTarget(target),
    ),
  controlWorkspaceCommands: (
    projectId: string,
    workspaceId: string,
    action: "start" | "stop" | "restart" | "run",
    spaceId?: string,
    target: WorkspaceRuntimeControlTarget = {},
  ) =>
    api.post<{ workspace: ProjectWorkspace; operation: WorkspaceOperation }>(
      projectPath(projectId, spaceId, `/workspaces/${encodeURIComponent(workspaceId)}/runtime-commands/${action}`),
      sanitizeWorkspaceRuntimeControlTarget(target),
    ),
  removeWorkspace: (projectId: string, workspaceId: string, spaceId?: string) =>
    api.delete<ProjectWorkspace>(projectPath(projectId, spaceId, `/workspaces/${encodeURIComponent(workspaceId)}`)),
  remove: (id: string, spaceId?: string) => api.delete<Project>(projectPath(id, spaceId)),
};
