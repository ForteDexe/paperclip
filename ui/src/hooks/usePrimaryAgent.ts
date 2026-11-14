import { useQuery } from "@tanstack/react-query";
import { authApi } from "@/api/auth";
import { primaryAgentApi } from "@/api/primaryAgent";
import { queryKeys } from "@/lib/queryKeys";

export function usePrimaryAgent(spaceId: string | null | undefined) {
  const session = useQuery({ queryKey: queryKeys.auth.session, queryFn: () => authApi.getSession() });
  const userId = session.data?.user?.id ?? session.data?.session?.userId ?? "local-operator";
  const query = useQuery({
    queryKey: queryKeys.primaryAgent.mine(spaceId ?? "__none__", userId),
    queryFn: () => primaryAgentApi.get(spaceId!),
    enabled: !!spaceId && session.isSuccess,
  });
  return {
    ...query,
    userId,
    loading: !!spaceId && (session.isPending || query.isPending && !session.error),
    error: session.error ?? query.error,
    retry: () => (session.isError ? session.refetch() : query.refetch()), // query-error-ok: retry dispatch targets the failed read
  };
}
