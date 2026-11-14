export type ContextualSidebarSurface =
  | "settings"
  | "apps"
  | "agent"
  | "routine"
  | "skills"
  | `plugin:${string}`;

export interface ShellRouteClassification {
  spaceSegments: string[];
  isTaskDetail: boolean;
  builtInContextualSurface: Exclude<ContextualSidebarSurface, `plugin:${string}`> | null;
}

const CONTEXTUAL_ORIGIN_KEY_PREFIX = "outpost.contextualSidebar.origin";

export function getSpacePathSegments(pathname: string, spacePrefix: string | undefined): string[] {
  if (!spacePrefix) return [];
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length < 2) return [];
  if (segments[0]?.toUpperCase() !== spacePrefix.toUpperCase()) return [];
  return segments.slice(1);
}

export function classifyShellRoute(
  pathname: string,
  spacePrefix: string | undefined,
): ShellRouteClassification {
  const spaceSegments = getSpacePathSegments(pathname, spacePrefix);
  const root = spaceSegments[0]?.toLowerCase();
  const isSpaceSettings = root === "space" && ["settings", "export", "import"].includes(
    spaceSegments[1]?.toLowerCase() ?? "",
  );
  const agentSegment = spaceSegments[1]?.toLowerCase();
  const isAgentDetail = root === "agents"
    && Boolean(agentSegment)
    && agentSegment !== "new"
    && !["all", "active", "paused", "error", "builtin"].includes(agentSegment ?? "");
  const isRoutineDetail = root === "routines" && spaceSegments.length >= 2;
  const isSkillsSurface = root === "skills";

  return {
    spaceSegments,
    isTaskDetail: (root === "issues" || root === "chats") && spaceSegments.length >= 2,
    builtInContextualSurface: isSpaceSettings
      ? "settings"
      : root === "apps" || root === "tools"
        ? "apps"
        : isAgentDetail
          ? "agent"
          : isRoutineDetail
            ? "routine"
            : isSkillsSurface
              ? "skills"
        : null,
  };
}

function contextualOriginStorageKey(surface: ContextualSidebarSurface, spacePrefix: string) {
  return `${CONTEXTUAL_ORIGIN_KEY_PREFIX}:${spacePrefix.toUpperCase()}:${surface}`;
}

function isSpacePath(pathname: string, spacePrefix: string) {
  const first = pathname.split("/").filter(Boolean)[0];
  return first?.toUpperCase() === spacePrefix.toUpperCase();
}

export function rememberContextualSidebarOrigin({
  surface,
  spacePrefix,
  previousPathname,
}: {
  surface: ContextualSidebarSurface;
  spacePrefix: string;
  previousPathname: string;
}) {
  if (typeof window === "undefined" || !isSpacePath(previousPathname, spacePrefix)) return;

  try {
    window.sessionStorage.setItem(
      contextualOriginStorageKey(surface, spacePrefix),
      previousPathname,
    );
  } catch {
    // Navigation still has a deterministic fallback when storage is unavailable.
  }
}

export function readContextualSidebarOrigin({
  surface,
  spacePrefix,
  fallbackTo,
}: {
  surface: ContextualSidebarSurface;
  spacePrefix: string | null | undefined;
  fallbackTo: string;
}) {
  if (typeof window === "undefined" || !spacePrefix) return fallbackTo;

  try {
    const stored = window.sessionStorage.getItem(contextualOriginStorageKey(surface, spacePrefix));
    return stored && isSpacePath(stored, spacePrefix) ? stored : fallbackTo;
  } catch {
    return fallbackTo;
  }
}
