import { useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "@/lib/router";
import { useSpace } from "../context/SpaceContext";
import { toSpaceRelativePath } from "../lib/space-routes";
import {
  getRememberedPathOwnerSpaceId,
  isRememberableSpacePath,
  sanitizeRememberedPathForSpace,
} from "../lib/space-page-memory";

const STORAGE_KEY = "outpost.spacePaths";

function getSpacePaths(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return {};
}

function saveSpacePath(spaceId: string, path: string) {
  const paths = getSpacePaths();
  paths[spaceId] = path;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(paths));
}

/**
 * Remembers the last visited page per space and navigates to it on space switch.
 * Falls back to /dashboard if no page was previously visited for a space.
 */
export function useSpacePageMemory() {
  const { spaces, selectedSpaceId, selectedSpace, selectionSource } = useSpace();
  const location = useLocation();
  const navigate = useNavigate();
  const prevSpaceId = useRef<string | null>(selectedSpaceId);
  const rememberedPathOwnerSpaceId = useMemo(
    () =>
      getRememberedPathOwnerSpaceId({
        spaces,
        pathname: location.pathname,
        fallbackSpaceId: prevSpaceId.current,
      }),
    [spaces, location.pathname],
  );

  // Save current path for current space on every location change.
  // Uses prevSpaceId ref so we save under the correct space even
  // during the render where selectedSpaceId has already changed.
  const fullPath = location.pathname + location.search;
  useEffect(() => {
    const spaceId = rememberedPathOwnerSpaceId;
    const relativePath = toSpaceRelativePath(fullPath);
    if (spaceId && isRememberableSpacePath(relativePath)) {
      saveSpacePath(spaceId, relativePath);
    }
  }, [fullPath, rememberedPathOwnerSpaceId]);

  // Navigate to saved path when space changes
  useEffect(() => {
    if (!selectedSpaceId) return;

    if (
      prevSpaceId.current !== null &&
      selectedSpaceId !== prevSpaceId.current
    ) {
      if (selectionSource !== "route_sync" && selectedSpace) {
        const paths = getSpacePaths();
        const targetPath = sanitizeRememberedPathForSpace({
          path: paths[selectedSpaceId],
          spacePrefix: selectedSpace.issuePrefix,
        });
        navigate(`/${selectedSpace.issuePrefix}${targetPath}`, { replace: true });
      }
    }
    prevSpaceId.current = selectedSpaceId;
  }, [selectedSpace, selectedSpaceId, selectionSource, navigate]);
}
