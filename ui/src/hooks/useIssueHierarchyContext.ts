import { useQueryView } from "../components/QueryView";
import { loadIssueHierarchyChildren } from "../lib/issue-hierarchy-context";
import { useQuery } from "@tanstack/react-query";
import type { Issue } from "@outpost/shared";
import { issuesApi } from "../api/issues";
import { queryKeys } from "../lib/queryKeys";

export function useIssueHierarchyContext(spaceId: string | null, matches: Issue[], collapsedParents: string[], enabled: boolean, rowBudget: number) {
  const parents = [...new Set(matches.map((issue) => issue.parentId).filter((id): id is string => Boolean(id)))].sort();
  const ancestors = useQuery<Issue[]>({
    queryKey: [...queryKeys.issues.list(spaceId ?? "__unscoped__"), "hierarchy-index-ancestors", parents],
    enabled: enabled && Boolean(spaceId) && parents.length > 0,
    staleTime: 30_000,
    placeholderData: (previous) => previous?.filter((issue) => issue.spaceId === spaceId),
    queryFn: async ({ signal }) => {
      const rows: Issue[] = [];
      const visited = new Set<string>();
      let frontier = parents;
      while (frontier.length > 0) {
        const next: string[] = [];
        for (let offset = 0; offset < frontier.length; offset += 100) {
          const ids = frontier.slice(offset, offset + 100);
          ids.forEach((id) => visited.add(id));
          const batch = await issuesApi.listCompact(spaceId!, { ids, projection: "index", limit: 100, includeRoutineExecutions: true }, { signal });
          for (const issue of batch) {
            if (issue.spaceId !== spaceId) continue;
            rows.push(issue as Issue);
            if (issue.parentId && !visited.has(issue.parentId)) next.push(issue.parentId);
          }
        }
        frontier = [...new Set(next)].filter((id) => !visited.has(id));
      }
      return rows;
    },
  });
  const children = useQuery<Awaited<ReturnType<typeof loadIssueHierarchyChildren>>>({
    queryKey: [...queryKeys.issues.list(spaceId ?? "__unscoped__"), "hierarchy-index-children", matches.map((issue) => issue.id), collapsedParents, rowBudget],
    enabled: enabled && Boolean(spaceId) && matches.length > 0,
    staleTime: 30_000,
    placeholderData: (previous) => previous ? {
      ...previous, issues: previous.issues.filter((issue) => issue.spaceId === spaceId),
    } : undefined,
    queryFn: ({ signal }) => loadIssueHierarchyChildren(spaceId!, matches, collapsedParents, rowBudget,
      async (parentIds, limit, offset, oneChildPerParent) => await issuesApi.listCompact(spaceId!, {
        parentIds, oneChildPerParent, projection: "index", limit, offset, includeRoutineExecutions: true,
      }, { signal }) as Issue[]),
  });
  const ancestorsView = useQueryView(ancestors);
  const childrenView = useQueryView(children);
  return {
    issues: [...(ancestorsView.kind === "error" ? [] : ancestors.data ?? []), ...(childrenView.kind === "error" ? [] : children.data?.issues ?? [])],
    hasMore: children.data?.hasMore ?? false,
    isLoading: ancestors.isLoading || children.isLoading || ancestorsView.kind === "reconnecting" || childrenView.kind === "reconnecting",
    isFetching: ancestors.isFetching || children.isFetching,
    error: (ancestorsView.kind === "error" ? ancestors.error : null) ?? (childrenView.kind === "error" ? children.error : null),
    refetch: () => { ancestorsView.retry(); childrenView.retry(); },
  };
}
