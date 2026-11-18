import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@/api/client";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/lib/queryKeys";

export function useTaskRecord(issueId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.issues.taskRecord(issueId ?? ""),
    enabled: Boolean(issueId) && !issueId?.startsWith("chat:"),
    queryFn: async () => {
      try {
        return await issuesApi.getTaskRecord(issueId!);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
  });
}
