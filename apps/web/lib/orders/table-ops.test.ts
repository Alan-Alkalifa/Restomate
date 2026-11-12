import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("@/lib/auth/dal", () => ({ requireOrgContext: vi.fn(), requirePermission: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/venue/shared", () => ({ assertLocation: vi.fn() }));

import { buildTableBoard } from "./data";

const T = (id: string, label: string, status = "available") => ({ id, label, area_id: "area", capacity: 4, status, pos_x: 1, pos_y: 2, shape: "square" });
const O = (id: string, n: number, table: string | null, over: Record<string, unknown> = {}) => ({
  id, order_number: n, status: "ready", table_id: table, guest_count: 3, created_at: "2026-11-12T03:00:00Z", waiter_id: "u1", ...over,
});

describe("buildTableBoard", () => {
  const tables = [T("t10", "T10", "occupied"), T("t2", "T2", "occupied"), T("t3", "T3", "occupied"), T("t4", "T4")];
  it("sorts labels naturally (T2 before T10)", () => {
    expect(buildTableBoard({ tables, orders: [], group: [], waiterNames: new Map() }).map((t) => t.label)).toEqual(["T2", "T3", "T4", "T10"]);
  });
  it("a secondary table shows the same order as its primary, with the group listed", () => {
    const board = buildTableBoard({
      tables, orders: [O("o1", 7, "t2")], group: [{ order_id: "o1", table_id: "t3" }], waiterNames: new Map([["u1", "Ayu"]]),
    });
    const primary = board.find((t) => t.label === "T2")!;
    const secondary = board.find((t) => t.label === "T3")!;
    expect(primary.order).toMatchObject({ orderId: "o1", orderNumber: 7, primaryTableId: "t2", groupTableIds: ["t3"], waiterName: "Ayu" });
    expect(secondary.order).toEqual(primary.order);
    expect(board.find((t) => t.label === "T4")!.order).toBeNull();
  });
  it("seatedAt is the order's created_at; a waiter without a known name has a null name", () => {
    const board = buildTableBoard({ tables, orders: [O("o1", 7, "t2", { waiter_id: "gone" })], group: [], waiterNames: new Map() });
    expect(board.find((t) => t.label === "T2")!.order).toMatchObject({ seatedAt: "2026-11-12T03:00:00Z", waiterId: "gone", waiterName: null });
  });
  it("no orders (a caller without orders.view): status colours only", () => {
    const board = buildTableBoard({ tables, orders: [], group: [], waiterNames: new Map() });
    expect(board.every((t) => t.order === null)).toBe(true);
    expect(board.find((t) => t.label === "T10")!.status).toBe("occupied");
  });
  it("carries no money and no names beyond the waiter's display name", () => {
    const board = buildTableBoard({ tables, orders: [O("o1", 7, "t2")], group: [], waiterNames: new Map([["u1", "Ayu"]]) });
    const json = JSON.stringify(board);
    expect(json).not.toMatch(/subtotal|total|amount|price|discount|customer/i);
  });
});
