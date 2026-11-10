import { describe, expect, it } from "vitest";
import { clamp, diffPositions, firstFreeSpot, nudge, pointerToGrid, snap } from "./grid";

describe("floor grid", () => {
  it("snaps to the step and stays in 0..999", () => {
    expect(snap(14)).toBe(10);
    expect(snap(15)).toBe(20);
    expect(snap(-40)).toBe(0);
    expect(snap(5000)).toBe(999);
    expect(snap(Number.NaN)).toBe(0);
    expect(Number.isInteger(snap(993))).toBe(true);
  });
  it("maps pointer pixels to grid units inside a canvas", () => {
    const rect = { left: 100, top: 50, width: 500, height: 500 };
    expect(pointerToGrid(350, 300, rect)).toEqual({ x: 500, y: 500 });
    expect(pointerToGrid(0, 0, rect)).toEqual({ x: 0, y: 0 });
    expect(pointerToGrid(9999, 9999, rect)).toEqual({ x: 999, y: 999 });
    expect(pointerToGrid(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 });
  });
  it("nudges by whole steps and clamps", () => {
    expect(nudge({ x: 500, y: 500 }, 1, -1)).toEqual({ x: 510, y: 490 });
    expect(nudge({ x: 0, y: 990 }, -1, 5)).toEqual({ x: 0, y: 999 });
  });
  it("diffs only placed, changed tables", () => {
    const base = { a: { x: 10, y: 10 }, b: null, c: { x: 30, y: 30 } };
    const cur = { a: { x: 10, y: 10 }, b: { x: 50, y: 60 }, c: { x: 40, y: 30 }, d: null };
    expect(diffPositions(base, cur)).toEqual([
      { tableId: "b", posX: 50, posY: 60 },
      { tableId: "c", posX: 40, posY: 30 },
    ]);
    expect(diffPositions(base, base)).toEqual([]);
  });
  it("never exceeds the contract limit and keeps every value in bounds", () => {
    const cur = Object.fromEntries(Array.from({ length: 700 }, (_, i) => [`t${i}`, { x: 5000, y: -3 }]));
    const d = diffPositions({}, cur);
    expect(d).toHaveLength(500);
    expect(d.every((p) => p.posX === 999 && p.posY === 0)).toBe(true);
  });
  it("clamps and finds a free spot", () => {
    expect(clamp(1200)).toBe(999);
    expect(firstFreeSpot([])).toEqual({ x: 100, y: 100 });
    expect(firstFreeSpot([{ x: 100, y: 100 }])).toEqual({ x: 200, y: 100 });
  });
});
