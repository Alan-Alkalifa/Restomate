import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
class Forbidden extends Error {}
vi.mock("next/navigation", () => ({ forbidden: () => { throw new Forbidden("403"); }, notFound: () => { throw new Error("404"); } }));
vi.mock("@/lib/env", () => ({ publicEnv: { NEXT_PUBLIC_APP_URL: "https://app.restomate.app", NEXT_PUBLIC_ROOT_DOMAIN: "restomate.app" } }));

const ORG = "99999999-9999-4999-8999-999999999999";
const LOC = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const T1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
let permissions: string[] = ["tables.manage"];
const requirePermission = vi.fn();
vi.mock("@/lib/auth/dal", () => ({
  requireOrgContext: async () => ({ org: { id: ORG, slug: "demo" }, locations: [{ id: LOC, name: "Main" }], permissions, package: { limits: { max_tables: 20 } } }),
  requirePermission: (...a: unknown[]) => requirePermission(...a),
}));

const selects: string[] = [];
const rows: Record<string, unknown[]> = {};
function chain(table: string) {
  const c: Record<string, unknown> = {};
  for (const m of ["eq", "order"]) c[m] = () => c;
  c.select = (cols: string, opts?: { head?: boolean }) => { selects.push(cols); (c as { head?: boolean }).head = !!opts?.head; return c; };
  c.then = (res: (v: unknown) => unknown) => res((c as { head?: boolean }).head ? { count: 7, data: null } : { data: rows[table] ?? [], error: null });
  return c;
}
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (t: string) => chain(t), rpc }) }));

import { getTableQrTokens, getVenue } from "./data";

beforeEach(() => {
  vi.clearAllMocks();
  selects.length = 0;
  permissions = ["tables.manage"];
  requirePermission.mockResolvedValue(undefined);
  rows.areas = [{ id: "a1", name: "Indoor", sort_order: 0, is_active: true }];
  rows.tables = [
    { id: T1, area_id: "a1", label: "T1", capacity: 4, shape: "round", status: "available", pos_x: 1, pos_y: 2, is_active: true },
    { id: "t2", area_id: "a1", label: "T2", capacity: 2, shape: "weird", status: "weird", pos_x: null, pos_y: null, is_active: false },
  ];
});

describe("getVenue", () => {
  it("maps rows, counts active tables per area, and never selects qr_token", async () => {
    const v = await getVenue("demo", LOC);
    expect(v.areas).toEqual([{ id: "a1", name: "Indoor", sortOrder: 0, isActive: true, tableCount: 1 }]);
    expect(v.tables[0]).toEqual({ id: T1, areaId: "a1", label: "T1", capacity: 4, shape: "round", status: "available", posX: 1, posY: 2, isActive: true });
    expect(v.tables[1]).toMatchObject({ shape: "square", status: "available" });
    expect(v.canManage).toBe(true);
    expect(v.tableLimit).toEqual({ used: 7, max: 20 });
    expect(selects.join(" ")).not.toMatch(/qr_token|\*/);
    expect(JSON.stringify(v)).not.toContain("qr");
  });
  it("canManage is false without tables.manage; readers are allowed", async () => {
    permissions = ["tables.view"];
    expect((await getVenue("demo", LOC)).canManage).toBe(false);
  });
  it("rejects a location the user cannot access", async () => {
    await expect(getVenue("demo", "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")).rejects.toBeInstanceOf(Forbidden);
  });
});

describe("getTableQrTokens", () => {
  it("requires tables.manage", async () => {
    requirePermission.mockImplementation(() => { throw new Forbidden("403"); });
    await expect(getTableQrTokens("demo", LOC)).rejects.toBeInstanceOf(Forbidden);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("builds storefront URLs from the RPC rows", async () => {
    rpc.mockResolvedValue({ data: [{ table_id: T1, label: "T1", area_name: "Indoor", qr_token: "tok_-123" }], error: null });
    expect(await getTableQrTokens("demo", LOC, [T1])).toEqual([{ tableId: T1, label: "T1", areaName: "Indoor", url: "https://demo.restomate.app/t/tok_-123" }]);
    expect(rpc).toHaveBeenCalledWith("get_table_qr_tokens", { location_id: LOC, table_ids: [T1] });
  });
  it("omits table_ids when not given and rejects malformed ids and RPC errors", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await getTableQrTokens("demo", LOC);
    expect(rpc).toHaveBeenCalledWith("get_table_qr_tokens", { location_id: LOC });
    await expect(getTableQrTokens("demo", LOC, ["x"])).rejects.toThrow();
    rpc.mockResolvedValue({ data: null, error: { message: "boom secret" } });
    await expect(getTableQrTokens("demo", LOC)).rejects.toThrow("Could not load QR codes.");
  });
});
