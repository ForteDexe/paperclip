import {
  readRecentSelectionIds,
  trackRecentSelectionId,
} from "./recent-selections";

const STORAGE_KEY = "outpost:recent-projects";

export function getRecentProjectIds(): string[] {
  return readRecentSelectionIds(STORAGE_KEY);
}

/** Undefined means no history; an empty string remembers an explicit No project. */
export function getLastProjectId(spaceId: string): string | undefined {
  try {
    return localStorage.getItem(`${STORAGE_KEY}:${spaceId}`) ?? undefined;
  } catch {
    return undefined;
  }
}

export function trackRecentProject(projectId: string, spaceId?: string): void {
  trackRecentSelectionId(STORAGE_KEY, projectId);
  if (spaceId) {
    try {
      localStorage.setItem(`${STORAGE_KEY}:${spaceId}`, projectId);
    } catch {
      // Selection remains usable when browser storage is unavailable.
    }
  }
}
