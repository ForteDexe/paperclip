import { useContext } from "react";
import { QueryClient, QueryClientContext, useQuery } from "@tanstack/react-query";
import { useAccountBoundMutation } from "./useAccountBoundMutation";
import { authApi } from "@/api/auth";
import { healthApi } from "@/api/health";
import { workspacePreferencesApi } from "@/api/workspacePreferences";
import { queryKeys } from "@/lib/queryKeys";

let detachedClient: QueryClient | null = null;
const getDetachedClient = () => detachedClient ??= new QueryClient();

export function useCoordinatorWorkspaceEnabled() {
  const contextClient = useContext(QueryClientContext);
  const client = contextClient ?? getDetachedClient();
  const session = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    enabled: contextClient != null,
  }, client);
  const sessionUserId = session.data?.user?.id ?? session.data?.session?.userId ?? null;
  const health = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => healthApi.get(),
    enabled: contextClient != null && session.isSuccess && !sessionUserId,
  }, client);
  const userId = session.isSuccess
    ? sessionUserId ?? (health.isSuccess && health.data.deploymentMode === "local_trusted" ? "local-operator" : null)
    : null;
  const preference = useQuery({
    queryKey: queryKeys.workspacePreferences.mine(userId),
    queryFn: () => workspacePreferencesApi.get(),
    enabled: contextClient != null && !!userId,
  }, client);
  const mutation = useAccountBoundMutation({
    mutationFn: async ({ spaceId, enabled, owner }: { spaceId: string; enabled: boolean; owner: string }) => {
      const result = await workspacePreferencesApi.update(spaceId, { coordinatorWorkspaceEnabled: enabled });
      if (result.userId !== owner) throw new Error("Your account changed. Reload your workspace preference and try again.");
      return result;
    },
    onSuccess: (result) => {
      // Only a response in its original verified account may update the cache.
      client.setQueryData(queryKeys.workspacePreferences.mine(result.userId), result);
    },
  }, client);
  const identityLoaded = session.isFetched && (!!sessionUserId || session.isError || health.isFetched);
  return {
    // Outpost retired the Coordinator workspace as an alternate shell. The
    // preference remains in the API for old databases, but cannot affect UI.
    enabled: false,
    loaded: !contextClient || (identityLoaded && (!userId || preference.isFetched)),
    userId,
    error: session.error ?? (!sessionUserId ? health.error : null) ?? preference.error
      ?? (mutation.variables?.owner === userId ? mutation.error : null),
    isSaving: mutation.isPending && mutation.variables?.owner === userId,
    setEnabled: async (spaceId: string, enabled: boolean) => {
      if (!contextClient || !userId) throw new Error("Sign in before changing your workspace.");
      return mutation.mutateAsync({ spaceId, enabled, owner: userId });
    },
    retry: async () => {
      mutation.reset();
      if (session.isError) return session.refetch();
      if (!sessionUserId && health.isError) return health.refetch();
      if (userId) return preference.refetch();
    },
  };
}
