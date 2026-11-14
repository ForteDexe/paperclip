const STORAGE_KEY = "outpost:composer-effort";

/** Undefined means no preference; null is the user's explicit Default choice. */
export function getLastComposerEffort(spaceId: string): string | null | undefined {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}:${spaceId}`);
    if (raw === null) return undefined;
    const value: unknown = JSON.parse(raw);
    return value === null || typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

export function rememberComposerEffort(spaceId: string, effort: string | null): void {
  try {
    localStorage.setItem(`${STORAGE_KEY}:${spaceId}`, JSON.stringify(effort));
  } catch {
    // The current run setting still works without persistent storage.
  }
}
