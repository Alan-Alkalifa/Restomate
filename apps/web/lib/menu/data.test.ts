import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
class Forbidden extends Error {}
vi.mock("next/navigation", () => ({ forbidden: () => { throw new Forbidden("403"); }, notFound: () => { throw new Error("404"); } }));

const ORG = "99999999-9999-4999-8999-999999999999";
const LOC = "ffffffff-ffff-4fff-8fff-ffffffffffff";
let perms: string[] = ["menu.manage"];
vi.mock("@/lib/auth/dal", () => ({
  requireOrgContext: async () => ({ org: { id: ORG, slug: "demo", currency: "IDR" }, locations: [{ id: LOC, name: "Main" }], permissions: perms }),
}));

const selects: Record<string, string> = {};
const rows: Record<string, unknown> = {};
function chain(table: string) {
  const c: Record<string, unknown> = {};
  for (const m of ["eq", "order"]) c[m] = () => c;
  c.select = (cols: string) => { selects[table] = cols; return c; };
  c.maybeSingle = async () => ({ data: rows[table] ?? null });
  c.then = (res: (v: unknown) => unknown) => res({ data: rows[table] ?? [], error: null });
  return c;
}
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (t: string) => chain(t) }) }));

import { getLocationMenu, getMenu } from "./data";

beforeEach(() => {
  perms = ["menu.manage"];
  for (const k of Object.keys(selects)) delete selects[k];
  rows.menu_categories = [{ id: "c1", name: "Makanan", description: null, sort_order: 1, is_active: true }];
  rows.menu_items = [
    { id: "i2", category_id: "c1", name: "Mie", description: null, base_price: 33000, image_path: null, dietary_tags: ["halal", "bogus"], is_published: true, is_active: true, sort_order: 2 },
    { id: "i1", category_id: "c1", name: "Nasi", description: "x", base_price: 35000, image_path: "a.jpg", dietary_tags: [], is_published: false, is_active: false, sort_order: 1 },
  ];
  rows.item_variants = [
    { id: "v2", item_id: "i2", name: "B", price_delta: 5, sort_order: 2, is_active: true },
    { id: "v1", item_id: "i2", name: "A", price_delta: -5, sort_order: 1, is_active: false },
  ];
  rows.modifier_groups = [{ id: "g1", name: "Level", min_select: 0, max_select: 1, sort_order: 1, is_active: true }];
  rows.modifiers = [{ id: "m1", group_id: "g1", name: "Pedas", price_delta: 0, sort_order: 1, is_active: true }];
  rows.menu_item_modifier_groups = [{ item_id: "i2", group_id: "g1", sort_order: 1 }];
  rows.locations = { timezone: "Asia/Jakarta" };
  rows.kitchen_stations = [{ id: "s1", name: "Bar", sort_order: 1, is_active: true }];
  rows.location_menu_overrides = [{ item_id: "i2", price_override: 30000, is_available: false, sold_out_until: "2026-11-10T17:00:00Z", kitchen_station_id: "s1" }];
});

describe("getMenu", () => {
  it("maps rows, orders them, counts active items and drops unknown tags", async () => {
    const m = await getMenu("demo");
    expect(m.currency).toBe("IDR");
    expect(m.canManage).toBe(true);
    expect(m.items.map((i) => i.id)).toEqual(["i1", "i2"]);
    expect(m.items[1]).toMatchObject({ basePrice: 33000, dietaryTags: ["halal"], modifierGroupIds: ["g1"] });
    expect(m.items[1]!.variants.map((v) => v.id)).toEqual(["v1", "v2"]); // active and inactive, ordered
    expect(m.categories[0]).toMatchObject({ itemCount: 1 }); // only the active item counts
    expect(m.modifierGroups[0]!.modifiers).toHaveLength(1);
  });
  it("is readable by non-managers and never selects *", async () => {
    perms = ["orders.create"];
    expect((await getMenu("demo")).canManage).toBe(false);
    for (const cols of Object.values(selects)) expect(cols).not.toMatch(/\*/);
  });
});

describe("getLocationMenu", () => {
  it("computes the effective price and exposes sold-out state", async () => {
    const m = await getLocationMenu("demo", LOC);
    expect(m.timezone).toBe("Asia/Jakarta");
    const mie = m.rows.find((r) => r.itemId === "i2")!;
    expect(mie).toMatchObject({ basePrice: 33000, priceOverride: 30000, effectivePrice: 30000, isAvailable: false, soldOutUntil: "2026-11-10T17:00:00Z", kitchenStationId: "s1" });
    const nasi = m.rows.find((r) => r.itemId === "i1")!;
    expect(nasi).toMatchObject({ priceOverride: null, effectivePrice: 35000, isAvailable: true, soldOutUntil: null, kitchenStationId: null });
    expect(m.stations).toHaveLength(1);
  });
  it("canToggleSoldOut for menu.manage or orders.create only; canManage only for menu.manage", async () => {
    perms = ["orders.create"];
    expect(await getLocationMenu("demo", LOC)).toMatchObject({ canManage: false, canToggleSoldOut: true });
    perms = ["kitchen.view"];
    expect(await getLocationMenu("demo", LOC)).toMatchObject({ canManage: false, canToggleSoldOut: false });
  });
  it("rejects a location the user cannot access", async () => {
    await expect(getLocationMenu("demo", "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")).rejects.toBeInstanceOf(Forbidden);
  });
});
