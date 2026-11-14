import type { SpaceUserProfile } from "./space-members";

/** Task messages load uploaded Outpost avatars automatically, never remote URLs. */
export function outpostHumanAvatarUrl(value: string | null | undefined): string | null {
  return value && /^\/api\/assets\/[^/?#]+\/content$/.test(value) ? value : null;
}

export function resolveIssueChatHumanAuthor(args: {
  authorName?: string | null;
  authorUserId?: string | null;
  currentUserId?: string | null;
  userProfileMap?: ReadonlyMap<string, SpaceUserProfile> | null;
}) {
  const { authorName, authorUserId, currentUserId, userProfileMap } = args;
  const profile = authorUserId ? userProfileMap?.get(authorUserId) : null;
  const isCurrentUser = Boolean(authorUserId && currentUserId && authorUserId === currentUserId);
  return {
    isCurrentUser,
    authorName: profile?.label?.trim() || authorName?.trim() ||
      (authorUserId === "local-operator" ? "You" : isCurrentUser ? "You" : "User"),
    avatarUrl: profile?.image ?? null,
  };
}
