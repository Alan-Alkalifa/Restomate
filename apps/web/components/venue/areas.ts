import type { Area } from "./types";

export const byOrder = (areas: readonly Area[]) => [...areas].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

/** Full new order of area ids after moving one area up or down by one place; null when it cannot move. */
export function moveArea(areas: readonly Area[], id: string, dir: "up" | "down"): string[] | null {
  const ids = byOrder(areas).map((a) => a.id);
  const i = ids.indexOf(id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= ids.length) return null;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  return ids;
}
