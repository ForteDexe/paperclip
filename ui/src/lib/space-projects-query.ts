import { queryOptions } from "@tanstack/react-query";
import type { Project } from "@outpost/shared";
import { projectsApi } from "@/api/projects";
import { queryKeys } from "@/lib/queryKeys";

/** Active projects are exactly those the server would return without `includeArchived`. */
export function selectActiveProjects(projects: Project[]): Project[] {
  return projects.filter((project) => !project.archivedAt);
}

/**
 * The space project list. Every consumer shares the single
 * `includeArchived=true` read; active-only consumers filter it with `select`.
 * Two lists under separate keys used to fetch the same large payload twice on
 * one page (for example the sidebar and the Mine inbox).
 * `queryKeys.projects.all(spaceId)` invalidation still reaches it.
 */
export function spaceProjectsQuery(spaceId: string, opts: { includeArchived?: boolean } = {}) {
  const base = {
    queryKey: queryKeys.projects.list(spaceId, { includeArchived: true }),
    queryFn: () => projectsApi.list(spaceId, { includeArchived: true }),
  };
  return opts.includeArchived
    ? queryOptions(base)
    : queryOptions({ ...base, select: selectActiveProjects });
}
