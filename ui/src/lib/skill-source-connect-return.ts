const key = (spaceId: string) => `outpost.skill-source-connect-return:${spaceId}`;
const lifetime = 30 * 60 * 1000;

/** Tab-local intent survives the full-page OAuth round trip without a redirect URL. */
export function rememberSkillSourceReturn(spaceId: string, sourceId: string) {
  if (sourceId !== "new" && !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(sourceId)) return;
  sessionStorage.setItem(key(spaceId), JSON.stringify({ sourceId, expiresAt: Date.now() + lifetime }));
}

export function skillSourceReturnPath(spaceId: string): string | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key(spaceId)) ?? "null");
    if (!saved || typeof saved.expiresAt !== "number" || saved.expiresAt < Date.now()
      || typeof saved.sourceId !== "string"
      || (saved.sourceId !== "new" && !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(saved.sourceId))) return null;
    return `/skills/sources/${saved.sourceId}`;
  } catch { return null; }
}

export function consumeSkillSourceReturn(spaceId: string): string | null {
  const path = skillSourceReturnPath(spaceId);
  sessionStorage.removeItem(key(spaceId));
  return path;
}
