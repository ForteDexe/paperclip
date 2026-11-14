import { useQuery } from "@tanstack/react-query";
import { emailApi } from "@/api/email";

export function useEmailThread(spaceId: string, issueId: string) {
  return useQuery({
    queryKey: ["email-thread", spaceId, issueId],
    queryFn: () => emailApi.thread(spaceId, issueId),
    enabled: Boolean(spaceId && issueId) && !issueId.startsWith("chat:"),
    // A null response identifies an ordinary task. It can still refetch on
    // focus or invalidation, but only email tasks need recurring updates.
    refetchInterval: (query) => query.state.data === null ? false : 3000,
  });
}
