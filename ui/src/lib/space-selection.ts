export type SpaceSelectionSource = "manual" | "route_sync" | "bootstrap";

interface BounceCandidateSpace {
  id: string;
  name: string;
  issuePrefix: string;
  status: string;
}

/**
 * Decides whether a navigation that landed on an archived space's URL
 * should bounce to an active space instead of dwelling in the archive.
 *
 * Stale state deposits users into archived spaces long after archiving:
 * remembered last-visited paths, browser history, bookmarks, and restored
 * tabs all outlive the archive. Rendering those pages is safe, but it is
 * never where the user wants to *be* — the sidebar does not even list the
 * space. Cold arrivals therefore bounce to an active space.
 *
 * Deliberate visits still work: when the archived space is already the
 * selection (the user chose it from the spaces list), there is no
 * bounce, so its settings and unarchive flows stay reachable. When no
 * active space exists there is nowhere better to go, so the archive
 * renders rather than bouncing into a dead end.
 */
export function resolveArchivedSpaceBounce(params: {
  matchedSpace: BounceCandidateSpace | null;
  selectedSpaceId: string | null;
  spaces: BounceCandidateSpace[];
}): BounceCandidateSpace | null {
  const { matchedSpace, selectedSpaceId, spaces } = params;
  if (!matchedSpace || matchedSpace.status !== "archived") return null;
  if (selectedSpaceId === matchedSpace.id) return null;

  const selectedActive = spaces.find(
    (space) => space.id === selectedSpaceId && space.status !== "archived",
  );
  return selectedActive ?? spaces.find((space) => space.status !== "archived") ?? null;
}

export type SpaceArchiveDeparture =
  | { kind: "space"; space: BounceCandidateSpace }
  | { kind: "cloud_portfolio"; url: string }
  | { kind: "spaces_list" };

/**
 * Decides where the app should take the user after they archive a space
 * from its own settings page. Staying put is never right: the page they are
 * on belongs to the space they just archived, and the only visible change
 * would be the archive button going inert.
 *
 * Another active space wins — the user still has somewhere to work, so
 * switch there (mirroring the cold-arrival bounce above). With no active
 * space left on a Cloud instance, the whole organization is on its way to
 * being archived by the control plane, so leave for the Cloud portfolio's
 * manage view. Self-hosted with nothing active falls back to the spaces
 * list, which shows the archived state and owns the unarchive affordance.
 */
export function resolveSpaceArchiveDeparture(params: {
  archivedSpaceId: string;
  spaces: BounceCandidateSpace[];
  cloudPortfolioUrl: string | null;
}): SpaceArchiveDeparture {
  const { archivedSpaceId, spaces, cloudPortfolioUrl } = params;
  const nextSpace = spaces.find(
    (space) => space.id !== archivedSpaceId && space.status !== "archived",
  );
  if (nextSpace) return { kind: "space", space: nextSpace };
  if (cloudPortfolioUrl) return { kind: "cloud_portfolio", url: cloudPortfolioUrl };
  return { kind: "spaces_list" };
}

export function shouldSyncSpaceSelectionFromRoute(params: {
  selectionSource: SpaceSelectionSource;
  selectedSpaceId: string | null;
  routeSpaceId: string;
}): boolean {
  const { selectionSource, selectedSpaceId, routeSpaceId } = params;

  if (selectedSpaceId === routeSpaceId) return false;

  // Let manual space switches finish their remembered-path navigation first.
  if (selectionSource === "manual" && selectedSpaceId) {
    return false;
  }

  return true;
}
