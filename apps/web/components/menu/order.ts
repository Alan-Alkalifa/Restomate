/** Move one id up (-1) or down (1) in a full ordering; returns the same array when it cannot move. */
export function moveId(ids: string[], id: string, dir: -1 | 1): string[] {
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return ids;
  const next = ids.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export const bySort = <T extends { sortOrder: number }>(a: T, b: T) => a.sortOrder - b.sortOrder;
