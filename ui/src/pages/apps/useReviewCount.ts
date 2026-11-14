import { useQuery } from "@tanstack/react-query";
import { useSpace } from "@/context/SpaceContext";
import { queryKeys } from "@/lib/queryKeys";
import { toolsApi } from "@/api/tools";

/**
 * Live count of Ask-first requests waiting for the user's OK (PAP-12371,
 * Finding B). This is the "decisions waiting on you" signal — deliberately
 * separate from the health "Needs attention" count so an approval is never
 * hidden behind an error-triage label. Backs the sidebar "Review" badge and
 * the persistent review affordance on /apps.
 */
export function useReviewCount(): number {
  const { selectedSpaceId } = useSpace();
  const query = useQuery({
    queryKey: queryKeys.tools.actionRequests(selectedSpaceId ?? "__none__", "pending"),
    queryFn: () => toolsApi.listActionRequests(selectedSpaceId!, "pending"),
    enabled: !!selectedSpaceId,
    refetchInterval: 20_000,
  });
  return query.data?.actionRequests.length ?? 0;
}
