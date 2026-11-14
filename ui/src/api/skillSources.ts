import type { ProjectRepositoryOptions, ProjectSkillRepository, SkillSourceSettingsRequest, SkillSourceFilePreview, SkillSourcePreviewRequest, SkillSource, SkillSourceCreateRequest, SkillSourceDiscovery, SkillSourceDiscoveryRequest, SkillSourceRefreshResult, SkillSourceSelectionRequest, SkillSourceScanUpdate, SkillSourceDiscoveryEvent, SkillSourceDisconnectRequest, SkillSourceDisconnectResult } from '@outpost/shared';
import { api, ApiError, requestResponse } from './client';
import type { SkillSourceBranches, SkillSourceBranchesQuery } from '@outpost/shared';
const base = (spaceId: string) => `/spaces/${spaceId}/skill-sources`;
export const skillSourcesApi = {
  list: (spaceId: string) => api.get<SkillSource[]>(base(spaceId)),
  projectRepositories: (spaceId: string) => api.get<ProjectSkillRepository[]>(`${base(spaceId)}/project-repositories`),
  adoptProject: (spaceId: string, workspaceId: string) => api.post<{ bindingId: string }>(`${base(spaceId)}/adopt-project`, { workspaceId }),
  settings: (spaceId: string, id: string, input: SkillSourceSettingsRequest) => api.patch<SkillSource>(`${base(spaceId)}/${id}/settings`, input),
  branches: (spaceId: string, id: string, input: SkillSourceBranchesQuery = {}, signal?: AbortSignal) => api.get<SkillSourceBranches>(`${base(spaceId)}/${id}/branches${input.connectionId ? `?connectionId=${encodeURIComponent(input.connectionId)}` : ''}`, { signal }),
  repositories: (spaceId: string) => api.get<ProjectRepositoryOptions>(`${base(spaceId)}/repositories`),
  discover: (spaceId: string, input: SkillSourceDiscoveryRequest) => api.post<SkillSourceDiscovery>(`${base(spaceId)}/discover`, input),
  discoverStream: async (spaceId: string, input: SkillSourceDiscoveryRequest, onProgress: (event: SkillSourceScanUpdate) => void, signal?: AbortSignal): Promise<SkillSourceDiscovery> => {
    const response = await requestResponse(`${base(spaceId)}/discover`, {
      method: 'POST', body: JSON.stringify(input), headers: { Accept: 'application/x-ndjson' }, signal,
    });
    if (!response.body || !response.headers.get('Content-Type')?.includes('application/x-ndjson')) throw new Error('Live scan unavailable. Refresh the page and try again.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        signal?.throwIfAborted();
        const { value, done } = await reader.read();
        signal?.throwIfAborted();
        buffer += decoder.decode(value, { stream: !done });
        let newline: number;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          signal?.throwIfAborted();
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          if (!line.trim()) continue;
          const event = JSON.parse(line) as SkillSourceDiscoveryEvent;
          if (event.type === 'error') throw new ApiError(event.error, event.status, event);
          if (event.type === 'complete') return event.discovery;
          if (event.type === 'progress' || event.type === 'candidate') onProgress(event);
          else throw new Error('Unexpected repository scan response. Try again.');
        }
        if (done) throw new Error('Repository scan interrupted. Try again.');
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  },
  preview: (spaceId: string, input: SkillSourcePreviewRequest) => api.post<SkillSourceFilePreview>(`${base(spaceId)}/preview`, input),
  create: (spaceId: string, input: SkillSourceCreateRequest) => api.post<SkillSourceRefreshResult>(base(spaceId), input),
  select: (spaceId: string, id: string, input: SkillSourceSelectionRequest) => api.patch<SkillSourceRefreshResult>(`${base(spaceId)}/${id}`, input),
  refresh: (spaceId: string, id: string) => api.post<SkillSourceRefreshResult>(`${base(spaceId)}/${id}/refresh`, {}),
  disconnect: (spaceId: string, id: string, input: SkillSourceDisconnectRequest) => api.delete<SkillSourceDisconnectResult>(`${base(spaceId)}/${id}`, input),
};
