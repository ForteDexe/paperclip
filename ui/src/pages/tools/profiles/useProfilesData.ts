import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { agentsApi } from "@/api/agents";
import { toolsApi } from "@/api/tools";
import { queryKeys } from "@/lib/queryKeys";
import { groupCatalogByApp } from "./profile-model";
import { spaceProjectsQuery } from "@/lib/space-projects-query";

/**
 * Shared data layer for the access-profiles index and wizard. Assembles the
 * space-wide catalog (there is no aggregate endpoint, so we fan out per
 * connection) and the lookup maps both surfaces need.
 */
export function useProfilesData(spaceId: string) {
  const profiles = useQuery({
    queryKey: queryKeys.tools.profiles(spaceId),
    queryFn: () => toolsApi.listProfiles(spaceId),
  });
  const applications = useQuery({
    queryKey: queryKeys.tools.applications(spaceId),
    queryFn: () => toolsApi.listApplications(spaceId),
  });
  const connections = useQuery({
    queryKey: queryKeys.tools.connections(spaceId),
    queryFn: () => toolsApi.listConnections(spaceId),
  });
  const agents = useQuery({
    queryKey: queryKeys.agents.list(spaceId),
    queryFn: () => agentsApi.list(spaceId),
  });
  const projects = useQuery({
    ...spaceProjectsQuery(spaceId),
  });
  const connectionList = connections.data?.connections ?? [];
  const catalogQueries = useQueries({
    queries: connectionList.map((c) => ({
      queryKey: queryKeys.tools.catalog(c.id),
      queryFn: () => toolsApi.listCatalog(c.id),
      staleTime: 60_000,
    })),
  });
  const catalog = useMemo(
    () => catalogQueries.flatMap((q) => q.data?.catalog ?? []),
    [catalogQueries],
  );
  const catalogLoading = connections.isLoading || catalogQueries.some((q) => q.isLoading);

  const maps = useMemo(
    () => ({
      applicationsById: new Map((applications.data?.applications ?? []).map((a) => [a.id, a.name])),
      connectionsById: new Map(connectionList.map((c) => [c.id, c.name])),
      agentsById: new Map((agents.data ?? []).map((a) => [a.id, a.name])),
      projectsById: new Map((projects.data ?? []).map((p) => [p.id, p.name])),
    }),
    [applications.data, connectionList, agents.data, projects.data],
  );

  const appGroups = useMemo(
    () => groupCatalogByApp(catalog, maps.applicationsById, maps.connectionsById),
    [catalog, maps.applicationsById, maps.connectionsById],
  );

  return {
    profiles,
    applications,
    connections,
    agents,
    projects,
    catalog,
    catalogLoading,
    appGroups,
    maps,
  };
}
