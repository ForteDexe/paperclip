export function takeSpaceWorkBatch<T extends { spaceId: string }>(
  ordered: readonly T[],
  limit: number,
  afterSpace: string | null = null,
): { entries: T[]; lastSpace: string | null } {
  const grouped = new Map<string, T[]>();
  for (const entry of ordered) {
    const group = grouped.get(entry.spaceId);
    if (group) group.push(entry); else grouped.set(entry.spaceId, [entry]);
  }
  const spaces = [...grouped.keys()].sort();
  const next = afterSpace === null ? 0 : spaces.findIndex(id => id > afterSpace);
  const start = next < 0 ? 0 : next;
  const rotation = [...spaces.slice(start), ...spaces.slice(0, start)];
  const entries: T[] = [];
  let lastSpace = afterSpace;
  for (let round = 0; entries.length < limit; round++) {
    let added = false;
    for (const spaceId of rotation) {
      const entry = grouped.get(spaceId)![round];
      if (!entry) continue;
      entries.push(entry); lastSpace = spaceId; added = true;
      if (entries.length === limit) break;
    }
    if (!added) break;
  }
  return { entries, lastSpace };
}
