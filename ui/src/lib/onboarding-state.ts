/**
 * localStorage is scoped per ORIGIN, not per account, so a browser that already
 * ran onboarding will happily hand a previous space's id to a brand new
 * session. Every downstream call then targets the wrong space: goals,
 * agents, and issues get created there, and requests targeting the actual
 * space fail with authorization errors.
 *
 * So restoring is an authorization decision, not a convenience. If the saved
 * space is not one the signed-in user owns, the whole blob is discarded.
 *
 * CONTRACT: `spaces` must be the caller's SETTLED spaces list (its
 * loading query/context has finished, e.g. `spacesLoading === false`).
 * This function has no way to tell an empty-because-still-loading list apart
 * from an empty-because-the-account-owns-nothing list, so it always treats
 * an empty `spaces` as "owns nothing" and discards a saved space id.
 * Callers must not invoke this while spaces are still loading, wait for
 * the settled list first, or a legitimate draft gets discarded by mistake.
 */
export function restoreOnboardingState(
  raw: unknown,
  spaces: Array<{ id: string }>,
): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const saved = { ...(raw as Record<string, unknown>) };

  const spaceId = saved.createdSpaceId;
  if (typeof spaceId !== "string" || spaceId === "") return saved;

  return spaces.some((c) => c.id === spaceId) ? saved : null;
}

// Exported so tests write/read the exact key the component uses, instead of
// duplicating the literal and silently drifting from it if it's ever renamed.
export const ONBOARDING_STORAGE_KEY = "outpost-onboarding-state";
/**
 * The onboarding draft in `localStorage`, via a browser that is allowed to say
 * no.
 *
 * Storage access throws outright where a browser denies it — Safari's private
 * mode, a blocked third-party context — and every call site here sits in a
 * render, an effect, or a close handler, so an escaping exception takes down
 * something the customer was using. Losing the ability to resume onboarding is
 * a far smaller failure than the wizard tearing down mid-answer, or refusing
 * to close.
 *
 * Routed through one object on purpose. Guarding these one at a time is how
 * three of the four call sites ended up unguarded while the fourth looked
 * fixed: the read, the stale-blob cleanup, the persist effect, and `reset()`
 * all have the same failure and want the same answer.
 */
export const onboardingDraftStorage = {
  read(): string | null {
    try {
      return window.localStorage.getItem(ONBOARDING_STORAGE_KEY);
    } catch {
      return null;
    }
  },
  write(value: string): void {
    try {
      window.localStorage.setItem(ONBOARDING_STORAGE_KEY, value);
    } catch {
      // Storage unavailable: the draft is simply not resumable this session.
    }
  },
  clear(): void {
    try {
      window.localStorage.removeItem(ONBOARDING_STORAGE_KEY);
    } catch {
      // Nothing to do. A draft that cannot be cleared is re-rejected on the
      // next load by the same ownership check that rejected it here.
    }
  },
};
