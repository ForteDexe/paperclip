import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { agentsApi } from "../api/agents";
import { accessApi } from "../api/access";
import { useSpace } from "../context/SpaceContext";
import { buildMarkdownMentionOptions } from "../lib/space-members";
import { queryKeys } from "../lib/queryKeys";
import { spaceProjectsQuery } from "@/lib/space-projects-query";

type MarkdownMentionInputs = Parameters<typeof buildMarkdownMentionOptions>[0];

type StandardMarkdownMentionOptionsArgs = {
  spaceId?: string | null;
  enabled?: boolean;
} & Partial<MarkdownMentionInputs>;

export function useStandardMarkdownMentionOptions(args: StandardMarkdownMentionOptionsArgs = {}) {
  const { selectedSpaceId } = useSpace();
  const spaceId = args.spaceId ?? selectedSpaceId;
  const enabled = (args.enabled ?? true) && Boolean(spaceId);

  const agentsQuery = useQuery({
    queryKey: spaceId ? queryKeys.agents.list(spaceId) : ["agents", "standard-mentions", "none"],
    queryFn: () => agentsApi.list(spaceId!),
    enabled: enabled && args.agents === undefined,
  });
  const projectsQuery = useQuery({
    ...spaceProjectsQuery(spaceId ?? ""),
    enabled: enabled && args.projects === undefined,
  });
  const usersQuery = useQuery({
    queryKey: spaceId ? queryKeys.access.spaceUserDirectory(spaceId) : ["access", "standard-mentions", "users", "none"],
    queryFn: () => accessApi.listUserDirectory(spaceId!),
    enabled: enabled && args.members === undefined,
  });

  const agents = args.agents ?? agentsQuery.data;
  const projects = args.projects ?? projectsQuery.data;
  const members = args.members ?? usersQuery.data?.users;

  return useMemo(
    () => buildMarkdownMentionOptions({ agents, projects, members }),
    [agents, members, projects],
  );
}
