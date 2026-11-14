import { useRef, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccountBoundMutation } from "@/hooks/useAccountBoundMutation";
import { bindAccount } from "@/lib/account-scope";
import type { DefaultAgentPreference } from "@outpost/shared";
import { agentsApi } from "@/api/agents";
import { defaultAgentApi } from "@/api/defaultAgent";
import { describeError } from "@/api/errors";
import { DefaultAgentPresentationProvider } from "@/components/default-agent/DefaultAgentPresentation";
import { useDefaultAgent } from "@/hooks/useDefaultAgent";
import { queryKeys } from "@/lib/queryKeys";
import { useSpace } from "./SpaceContext";
import { useToastActions } from "./ToastContext";

export function DefaultAgentProvider({ children }: { children: ReactNode }) {
  const { selectedSpaceId: spaceId } = useSpace();
  const preference = useDefaultAgent(spaceId);
  const client = useQueryClient();
  const { pushToast } = useToastActions();
  const scope = useRef({ spaceId, userId: preference.userId });
  scope.current = { spaceId, userId: preference.userId };
  type Choice = { spaceId: string; userId: string; agentId: string };
  const keyFor = (choice: Choice) => queryKeys.defaultAgent.mine(choice.spaceId, choice.userId);
  const isCurrentScope = (choice: Choice) => choice.spaceId === scope.current.spaceId && choice.userId === scope.current.userId;
  const roster = useQuery({ queryKey: queryKeys.agents.list(spaceId!), queryFn: () => agentsApi.list(spaceId!), enabled: !!spaceId });
  const mutation = useAccountBoundMutation({
    mutationFn: (choice: Choice) => defaultAgentApi.set(choice.spaceId, { defaultAgentId: choice.agentId }),
    onMutate: async choice => {
      const account = bindAccount(client);
      const key = keyFor(choice);
      await client.cancelQueries({ queryKey: key });
      if (!account.isCurrentAccount()) return;
      const previous = client.getQueryData<DefaultAgentPreference>(key);
      const optimistic = { spaceId: choice.spaceId, userId: choice.userId, defaultAgentId: choice.agentId, initialized: true };
      client.setQueryData<DefaultAgentPreference>(key, optimistic);
      return { previous, optimistic: client.getQueryData(key), optimisticRevision: client.getQueryState(key)?.dataUpdateCount, account };
    },
    onError: (error, choice, context) => {
      if (context) client.setQueryData(keyFor(choice), context.previous);
      if (!isCurrentScope(choice)) return;
      pushToast({ title: "Couldn't change the default agent.", body: describeError(error).body, tone: "error",
        action: { label: "Retry", onClick: () => { if (isCurrentScope(choice)) mutation.mutate(choice); } } });
    },
    onSuccess: (data, choice) => client.setQueryData(keyFor(choice), data),
    onFinished: (choice, context) => {
      if (context && !context.account.isCurrentScope()
        && client.getQueryData(keyFor(choice)) === context.optimistic
        && client.getQueryState(keyFor(choice))?.dataUpdateCount === context.optimisticRevision) {
        client.setQueryData(keyFor(choice), context.previous);
      }
    },
    onSettled: (_data, _error, choice) => {
      void client.invalidateQueries({ queryKey: keyFor(choice) });
      void client.invalidateQueries({ queryKey: queryKeys.resourceMemberships.mine(choice.spaceId) });
    },
  });
  const defaultAgent = roster.data?.find(agent => agent.id === preference.data?.defaultAgentId && agent.status !== "terminated") ?? null;
  const error = preference.error ?? roster.error;
  return <DefaultAgentPresentationProvider value={spaceId ? {
    spaceId, defaultAgentId: defaultAgent?.id ?? null, defaultAgent,
    loading: preference.loading || roster.isPending,
    error: error ? describeError(error).body : undefined,
    onRetry: () => { void preference.retry(); void roster.refetch(); },
    pendingAgentId: mutation.isPending && isCurrentScope(mutation.variables) ? mutation.variables.agentId : null,
    onChange: agentId => mutation.mutate({ spaceId, userId: preference.userId, agentId }),
  } : null}>{children}</DefaultAgentPresentationProvider>;
}
