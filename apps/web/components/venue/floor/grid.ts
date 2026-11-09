/** Pure floor plan helpers: grid snapping, bounds, and the changed-positions diff (docs/contracts/venue.md). */

/** Positions are integers in 0..999 on both axes. */
export const GRID_MAX = 999;
/** Snap step in grid units: the canvas has a 100 x 100 cell grid. */
export const STEP = 10;
/** Contract limit for one saveTablePositions call. */
export const MAX_POSITIONS = 500;

export type Pos = { x: number; y: number };
export type PositionMap = Record<string, Pos | null>;
export type PositionChange = { tableId: string; posX: number; posY: number };

export const clamp = (n: number, lo = 0, hi = GRID_MAX) => Math.min(hi, Math.max(lo, n));

/** Round to the nearest grid step, then keep inside the plan. Non-finite input falls back to 0. */
export function snap(n: number, step = STEP): number {
  if (!Number.isFinite(n)) return 0;
  return clamp(Math.round(n / step) * step);
}

/** Pointer position in client pixels -> snapped grid position, relative to the canvas rectangle. */
export function pointerToGrid(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): Pos {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
  return {
    x: snap(((clientX - rect.left) / rect.width) * (GRID_MAX + 1)),
    y: snap(((clientY - rect.top) / rect.height) * (GRID_MAX + 1)),
  };
}

export const insideRect = (clientX: number, clientY: number, r: { left: number; top: number; right: number; bottom: number }) =>
  clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;

/** Move by whole steps (arrow keys), staying inside the plan. */
export function nudge(p: Pos, dx: number, dy: number, step = STEP): Pos {
  return { x: snap(p.x + dx * step, step), y: snap(p.y + dy * step, step) };
}

export const samePos = (a: Pos | null | undefined, b: Pos | null | undefined) => (!a && !b) || (!!a && !!b && a.x === b.x && a.y === b.y);

/** Only tables that are placed now and differ from the saved baseline. At most `limit` entries (the contract maximum). */
export function diffPositions(baseline: PositionMap, current: PositionMap, limit = MAX_POSITIONS): PositionChange[] {
  const out: PositionChange[] = [];
  for (const [tableId, pos] of Object.entries(current)) {
    if (!pos || samePos(baseline[tableId], pos)) continue;
    out.push({ tableId, posX: clamp(Math.trunc(pos.x)), posY: clamp(Math.trunc(pos.y)) });
    if (out.length >= limit) break;
  }
  return out;
}

export const countChanged = (baseline: PositionMap, current: PositionMap) => diffPositions(baseline, current, Infinity).length;

/** Next free-ish spot when placing from the keyboard: first grid slot (row by row) that no other table sits on. */
export function firstFreeSpot(taken: Pos[], step = STEP * 10): Pos {
  for (let y = step; y <= GRID_MAX; y += step) {
    for (let x = step; x <= GRID_MAX; x += step) {
      if (!taken.some((t) => Math.abs(t.x - x) < step / 2 && Math.abs(t.y - y) < step / 2)) return { x, y };
    }
  }
  return { x: 500, y: 500 };
}
