import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
class Forbidden extends Error {}
vi.mock("next/navigation", () => ({ forbidden: () => { throw new Forbidden("403"); }, notFound: () => { throw new Error("404"); } }));
const updateTag = vi.fn();
vi.mock("next/cache", () => ({ updateTag: (t: string) => updateTag(t) }));
const capture = vi.fn();
vi.mock("@/lib/posthog/server", () => ({ captureServer: (...a: unknown[]) => capture(...a) }));

const ORG = "99999999-9999-4999-8999-999999999999";
const LOC = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const OTHER_LOC = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const CAT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ITEM = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const GROUP = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const STATION = "abababab-abab-4bab-8bab-abababababab";
const V1 = "00000000-0000-4000-8000-000000000001";
const V2 = "00000000-0000-4000-8000-000000000002";
const V3 = "00000000-0000-4000-8000-000000000003";
const FOREIGN = "12121212-1212-4212-8212-121212121212";

let perms: string[] = ["menu.manage"];
vi.mock("@/lib/auth/dal", () => ({
  requireOrgContext: async () => ({ org: { id: ORG, slug: "demo", currency: "IDR" }, locations: [{ id: LOC, name: "Main" }], permissions: perms }),
  requirePermission: async (_org: string, perm: string) => { if (!perms.includes(perm)) throw new Forbidden("403"); },
  requireUser: async () => ({ id: "user-self", email: "me@x.test" }),
}));

type Res = { data?: unknown; error?: unknown };
let results: Record<string, Res | Res[]> = {};
const calls: { key: string; payload?: unknown; filters: [string, unknown][] }[] = [];
function chain(table: string) {
  let op = "select";
  let payload: unknown;
  const filters: [string, unknown][] = [];
  const get = (): Res => {
    const key = `${table}.${op}`;
    calls.push({ key, payload, filters: [...filters] });
    const r = results[key] ?? { data: null, error: null };
    return Array.isArray(r) ? (r.shift() ?? { data: null, error: null }) : r;
  };
  const c: Record<string, unknown> = {};
  for (const m of ["eq", "is", "in"]) c[m] = (col: string, v: unknown) => { filters.push([`${m}:${col}`, v]); return c; };
  for (const m of ["order", "select", "limit"]) c[m] = () => c;
  c.insert = (p: unknown) => { op = "insert"; payload = p; return c; };
  c.update = (p: unknown) => { op = "update"; payload = p; return c; };
  c.delete = () => { op = "delete"; return c; };
  c.maybeSingle = async () => get();
  c.then = (res: (v: Res) => unknown) => res(get());
  return c;
}
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (t: string) => chain(t), rpc }) }));

import * as A from "./actions";

const form = (pairs: [string, string][]) => { const fd = new FormData(); for (const [k, v] of pairs) fd.append(k, v); return fd; };
const sent = (key: string) => calls.filter((c) => c.key === key);
const writes = () => calls.filter((c) => /\.(insert|update|delete)$/.test(c.key));

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  perms = ["menu.manage"];
  rpc.mockResolvedValue({ data: "2026-11-10T17:00:00Z", error: null });
  // by default every id "exists" in this org
  results = {
    "menu_categories.select": { data: [{ id: CAT }] },
    "menu_items.select": { data: [{ id: ITEM }] },
    "modifier_groups.select": { data: [{ id: GROUP }] },
    "kitchen_stations.select": { data: { id: STATION } },
  };
});

const ORG_ACTIONS: [string, (fd: FormData) => Promise<unknown>, [string, string][]][] = [
  ["createCategory", (fd) => A.createCategory("demo", null, fd), [["name", "Makanan"]]],
  ["updateCategory", (fd) => A.updateCategory("demo", null, fd), [["categoryId", CAT], ["name", "X"]]],
  ["setCategoryActive", (fd) => A.setCategoryActive("demo", null, fd), [["categoryId", CAT], ["active", "false"]]],
  ["reorderCategories", (fd) => A.reorderCategories("demo", null, fd), [["categoryIds", CAT]]],
  ["createItem", (fd) => A.createItem("demo", null, fd), [["categoryId", CAT], ["name", "Nasi"], ["basePrice", "35000"]]],
  ["updateItem", (fd) => A.updateItem("demo", null, fd), [["itemId", ITEM], ["categoryId", CAT], ["name", "Nasi"], ["basePrice", "35000"]]],
  ["setItemActive", (fd) => A.setItemActive("demo", null, fd), [["itemId", ITEM], ["active", "false"]]],
  ["setItemPublished", (fd) => A.setItemPublished("demo", null, fd), [["itemId", ITEM], ["published", "true"]]],
  ["reorderItems", (fd) => A.reorderItems("demo", null, fd), [["categoryId", CAT], ["itemIds", ITEM]]],
  ["saveItemVariants", (fd) => A.saveItemVariants("demo", null, fd), [["itemId", ITEM], ["variants", "[]"]]],
  ["createModifierGroup", (fd) => A.createModifierGroup("demo", null, fd), [["name", "Level"], ["minSelect", "0"], ["maxSelect", "1"]]],
  ["updateModifierGroup", (fd) => A.updateModifierGroup("demo", null, fd), [["groupId", GROUP], ["name", "Level"], ["minSelect", "0"], ["maxSelect", "1"]]],
  ["setModifierGroupActive", (fd) => A.setModifierGroupActive("demo", null, fd), [["groupId", GROUP], ["active", "false"]]],
  ["saveGroupModifiers", (fd) => A.saveGroupModifiers("demo", null, fd), [["groupId", GROUP], ["modifiers", "[]"]]],
  ["setItemModifierGroups", (fd) => A.setItemModifierGroups("demo", null, fd), [["itemId", ITEM]]],
];
const LOC_ACTIONS: [string, (fd: FormData) => Promise<unknown>, [string, string][]][] = [
  ["setLocationOverride", (fd) => A.setLocationOverride("demo", LOC, null, fd), [["itemId", ITEM]]],
  ["createStation", (fd) => A.createStation("demo", LOC, null, fd), [["name", "Bar"]]],
  ["renameStation", (fd) => A.renameStation("demo", LOC, null, fd), [["stationId", STATION], ["name", "Bar"]]],
  ["setStationActive", (fd) => A.setStationActive("demo", LOC, null, fd), [["stationId", STATION], ["active", "true"]]],
];

describe("permission matrix", () => {
  const roles: [string, string[]][] = [["cashier", ["orders.create", "orders.view", "pos.use"]], ["waiter", ["orders.create"]], ["kitchen", ["kitchen.view", "kitchen.update"]]];
  for (const [role, p] of roles) {
    it.each([...ORG_ACTIONS, ...LOC_ACTIONS])(`${role}: %s is forbidden and writes nothing`, async (_n, run, pairs) => {
      perms = p;
      await expect(run(form(pairs))).rejects.toBeInstanceOf(Forbidden);
      expect(writes()).toHaveLength(0);
      expect(rpc).not.toHaveBeenCalled();
    });
  }
  it.each([...ORG_ACTIONS, ...LOC_ACTIONS])("manager: %s is allowed (no throw)", async (_n, run, pairs) => {
    const r = await run(form(pairs));
    expect(r).toMatchObject({ ok: true });
  });
  it("location actions reject a location the user cannot access", async () => {
    await expect(A.createStation("demo", OTHER_LOC, null, form([["name", "Bar"]]))).rejects.toBeInstanceOf(Forbidden);
    await expect(A.setLocationOverride("demo", "nope", null, form([["itemId", ITEM]]))).rejects.toBeInstanceOf(Forbidden);
    expect(writes()).toHaveLength(0);
  });
});

describe("toggleSoldOut", () => {
  const fd = (v = "true") => form([["itemId", ITEM], ["soldOut", v]]);
  it("a cashier (orders.create only) can toggle at their location through the RPC", async () => {
    perms = ["orders.create"];
    expect(await A.toggleSoldOut("demo", LOC, null, fd())).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("set_item_sold_out", { location_id: LOC, item_id: ITEM, sold_out: true });
    expect(writes()).toHaveLength(0); // never a direct table write
    expect(updateTag).toHaveBeenCalledWith(`menu:${ORG}:${LOC}`);
    expect(capture).toHaveBeenCalledWith("menu_item_sold_out_toggled", { distinctId: "user-self", organizationId: ORG, properties: { sold_out: true } });
  });
  it("a manager can clear it", async () => {
    expect(await A.toggleSoldOut("demo", LOC, null, fd("false"))).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("set_item_sold_out", { location_id: LOC, item_id: ITEM, sold_out: false });
  });
  it("kitchen and a location outside their access are forbidden before the RPC", async () => {
    perms = ["kitchen.view"];
    await expect(A.toggleSoldOut("demo", LOC, null, fd())).rejects.toBeInstanceOf(Forbidden);
    perms = ["orders.create"];
    await expect(A.toggleSoldOut("demo", OTHER_LOC, null, fd())).rejects.toBeInstanceOf(Forbidden);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("maps an RPC FORBIDDEN (foreign item) and does not tag or capture", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "FORBIDDEN" } });
    expect(await A.toggleSoldOut("demo", LOC, null, fd())).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(updateTag).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });
  it("validates the form", async () => {
    expect(await A.toggleSoldOut("demo", LOC, null, form([["itemId", ITEM]]))).toMatchObject({ ok: false, fieldErrors: { soldOut: [expect.any(String)] } });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("IDOR: ids must belong to this org (and location)", () => {
  it("foreign item / category / group / station ids are rejected and nothing is written", async () => {
    results["menu_items.select"] = { data: [] };
    results["menu_categories.select"] = { data: [] };
    results["modifier_groups.select"] = { data: [] };
    results["kitchen_stations.select"] = { data: null };
    expect(await A.setItemActive("demo", null, form([["itemId", FOREIGN], ["active", "false"]]))).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await A.setItemPublished("demo", null, form([["itemId", FOREIGN], ["published", "true"]]))).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await A.setCategoryActive("demo", null, form([["categoryId", FOREIGN], ["active", "false"]]))).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await A.setModifierGroupActive("demo", null, form([["groupId", FOREIGN], ["active", "false"]]))).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await A.reorderCategories("demo", null, form([["categoryIds", FOREIGN]]))).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await A.saveItemVariants("demo", null, form([["itemId", FOREIGN], ["variants", "[]"]]))).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await A.saveGroupModifiers("demo", null, form([["groupId", FOREIGN], ["modifiers", "[]"]]))).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await A.setLocationOverride("demo", LOC, null, form([["itemId", FOREIGN]]))).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await A.renameStation("demo", LOC, null, form([["stationId", FOREIGN], ["name", "X"]]))).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await A.createItem("demo", null, form([["categoryId", FOREIGN], ["name", "X"], ["basePrice", "1"]]))).toMatchObject({ ok: false, fieldErrors: { categoryId: [expect.any(String)] } });
    expect(await A.setItemModifierGroups("demo", null, form([["itemId", ITEM], ["groupIds", FOREIGN]]))).toMatchObject({ ok: false });
    expect(writes()).toHaveLength(0);
    expect(updateTag).not.toHaveBeenCalled();
  });
  it("an item cannot use a kitchen station of another location (station lookup is scoped to this location)", async () => {
    results["kitchen_stations.select"] = { data: null };
    const r = await A.setLocationOverride("demo", LOC, null, form([["itemId", ITEM], ["kitchenStationId", STATION]]));
    expect(r).toMatchObject({ ok: false, fieldErrors: { kitchenStationId: [expect.any(String)] } });
    expect(sent("kitchen_stations.select")[0]!.filters).toContainEqual(["eq:location_id", LOC]);
    expect(writes()).toHaveLength(0);
  });
  it("a variant id that belongs to another item / org is rejected by the RPC (FORBIDDEN) and nothing is tagged", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "FORBIDDEN" } });
    const r = await A.saveItemVariants("demo", null, form([["itemId", ITEM], ["variants", JSON.stringify([{ id: FOREIGN, name: "X", priceDelta: 0 }])]]));
    expect(r).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(updateTag).not.toHaveBeenCalled();
    expect(writes()).toHaveLength(0);
  });
  it("reorderItems with ids outside the category is rejected", async () => {
    results["menu_items.select"] = { data: [] };
    expect(await A.reorderItems("demo", null, form([["categoryId", CAT], ["itemIds", ITEM]]))).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
});

describe("writes", () => {
  it("createItem uses the org from the session, appends sort order, tags and captures", async () => {
    results["menu_items.select"] = { data: { sort_order: 4 } };
    const r = await A.createItem("demo", null, form([["categoryId", CAT], ["name", " Nasi "], ["basePrice", "35000"], ["organization_id", FOREIGN], ["dietaryTags", "halal"]]));
    expect(r).toEqual({ ok: true });
    expect(sent("menu_items.insert")[0]!.payload).toEqual({
      organization_id: ORG, category_id: CAT, name: "Nasi", description: null, base_price: 35000, dietary_tags: ["halal"], is_published: false, sort_order: 5,
    });
    expect(updateTag).toHaveBeenCalledWith(`menu:${ORG}`);
    expect(capture).toHaveBeenCalledWith("menu_item_created", { distinctId: "user-self", organizationId: ORG });
  });
  it("updateItem captures and money outside bounds becomes a field error without writing", async () => {
    expect(await A.updateItem("demo", null, form([["itemId", ITEM], ["categoryId", CAT], ["name", "N"], ["basePrice", "1000000000001"]])))
      .toMatchObject({ ok: false, fieldErrors: { basePrice: [expect.any(String)] } });
    expect(await A.updateItem("demo", null, form([["itemId", ITEM], ["categoryId", CAT], ["name", "N"], ["basePrice", "10.5"]])))
      .toMatchObject({ ok: false, fieldErrors: { basePrice: [expect.any(String)] } });
    expect(writes()).toHaveLength(0);
    expect(await A.updateItem("demo", null, form([["itemId", ITEM], ["categoryId", CAT], ["name", "N"], ["basePrice", "100"]]))).toEqual({ ok: true });
    expect(capture).toHaveBeenCalledWith("menu_item_updated", { distinctId: "user-self", organizationId: ORG });
  });
  it("item writes that can change the menu setup step also refresh the setup checklist", async () => {
    const tag = `setup-progress:${ORG}`;
    const cases: [string, () => Promise<unknown>][] = [
      ["createItem", () => A.createItem("demo", null, form([["categoryId", CAT], ["name", "Nasi"], ["basePrice", "35000"], ["isPublished", "true"]]))],
      ["updateItem", () => A.updateItem("demo", null, form([["itemId", ITEM], ["categoryId", CAT], ["name", "N"], ["basePrice", "100"]]))],
      ["setItemActive", () => A.setItemActive("demo", null, form([["itemId", ITEM], ["active", "false"]]))],
      ["setItemPublished", () => A.setItemPublished("demo", null, form([["itemId", ITEM], ["published", "false"]]))],
    ];
    for (const [name, call] of cases) {
      updateTag.mockClear();
      expect(await call(), name).toEqual({ ok: true });
      expect(updateTag, name).toHaveBeenCalledWith(tag);
      expect(updateTag, name).toHaveBeenCalledWith(`menu:${ORG}`);
    }
  });
  it("a failed item write refreshes nothing; category, variant and reorder writes do not touch the checklist", async () => {
    results["menu_items.update"] = { error: { code: "42501", message: "denied" } };
    expect(await A.setItemActive("demo", null, form([["itemId", ITEM], ["active", "false"]]))).toMatchObject({ ok: false });
    expect(updateTag).not.toHaveBeenCalled();
    results["menu_items.update"] = { data: null, error: null };
    await A.reorderItems("demo", null, form([["categoryId", CAT], ["itemIds", ITEM]]));
    await A.setCategoryActive("demo", null, form([["categoryId", CAT], ["active", "false"]]));
    expect(updateTag).not.toHaveBeenCalledWith(`setup-progress:${ORG}`);
  });
  it("duplicate names surface as DUPLICATE_NAME with fieldErrors.name and do not tag", async () => {
    results["menu_categories.insert"] = { error: { code: "23505", message: "duplicate key" } };
    expect(await A.createCategory("demo", null, form([["name", "Makanan"]]))).toMatchObject({ ok: false, code: "DUPLICATE_NAME", fieldErrors: { name: [expect.any(String)] } });
    results["kitchen_stations.insert"] = { error: { code: "23505", message: "dup" } };
    expect(await A.createStation("demo", LOC, null, form([["name", "Bar"]]))).toMatchObject({ ok: false, code: "DUPLICATE_NAME" });
    expect(updateTag).not.toHaveBeenCalled();
  });
  it("a database 42501 maps to FORBIDDEN", async () => {
    results["menu_items.update"] = { error: { code: "42501", message: "permission denied" } };
    expect(await A.setItemActive("demo", null, form([["itemId", ITEM], ["active", "false"]]))).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
  it("setLocationOverride: absent isAvailable is false, empty price clears, sold_out_until is never written; inserts when none exists", async () => {
    results["location_menu_overrides.select"] = { data: null };
    expect(await A.setLocationOverride("demo", LOC, null, form([["itemId", ITEM], ["priceOverride", ""], ["kitchenStationId", STATION]]))).toEqual({ ok: true });
    const payload = sent("location_menu_overrides.insert")[0]!.payload as Record<string, unknown>;
    expect(payload).toEqual({ organization_id: ORG, location_id: LOC, item_id: ITEM, price_override: null, is_available: false, kitchen_station_id: STATION });
    expect("sold_out_until" in payload).toBe(false);
    expect(updateTag).toHaveBeenCalledWith(`menu:${ORG}:${LOC}`);
  });
  it("setLocationOverride updates an existing override", async () => {
    results["location_menu_overrides.select"] = { data: { id: FOREIGN } };
    expect(await A.setLocationOverride("demo", LOC, null, form([["itemId", ITEM], ["priceOverride", "26000"], ["isAvailable", "true"]]))).toEqual({ ok: true });
    expect(sent("location_menu_overrides.update")[0]!.payload).toEqual({ price_override: 26000, is_available: true, kitchen_station_id: null });
    expect(sent("location_menu_overrides.insert")).toHaveLength(0);
  });
});

describe("full-list saves (one RPC each, atomic in the database)", () => {
  it("saveItemVariants sends the whole ordered list to save_item_variants in a single call, with no table writes", async () => {
    const list = [{ id: V3, name: "Jumbo", priceDelta: 10000 }, { name: "Regular", priceDelta: 0 }, { id: V1, name: "Large", priceDelta: -5000 }];
    expect(await A.saveItemVariants("demo", null, form([["itemId", ITEM], ["variants", JSON.stringify(list)]]))).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("save_item_variants", { item_id: ITEM, variants: list });
    expect(writes()).toHaveLength(0);
    expect(updateTag).toHaveBeenCalledWith(`menu:${ORG}`);
  });
  it("an empty list is sent as an empty array (the RPC deactivates every variant)", async () => {
    await A.saveItemVariants("demo", null, form([["itemId", ITEM], ["variants", "[]"]]));
    expect(rpc).toHaveBeenCalledWith("save_item_variants", { item_id: ITEM, variants: [] });
  });
  it("saveGroupModifiers calls save_group_modifiers the same way", async () => {
    const list = [{ id: V1, name: "Keju", priceDelta: 6000 }, { name: "Telur", priceDelta: 5000 }];
    expect(await A.saveGroupModifiers("demo", null, form([["groupId", GROUP], ["modifiers", JSON.stringify(list)]]))).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("save_group_modifiers", { group_id: GROUP, modifiers: list });
    expect(writes()).toHaveLength(0);
  });
  it("a unique violation from the RPC is reported on the list field, and a failed save does not tag", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "23505", message: "dup" } });
    expect(await A.saveItemVariants("demo", null, form([["itemId", ITEM], ["variants", JSON.stringify([{ name: "A", priceDelta: 0 }])]])))
      .toMatchObject({ ok: false, code: "DUPLICATE_NAME", fieldErrors: { variants: [expect.any(String)] } });
    expect(await A.saveGroupModifiers("demo", null, form([["groupId", GROUP], ["modifiers", JSON.stringify([{ name: "A", priceDelta: 0 }])]])))
      .toMatchObject({ ok: false, code: "DUPLICATE_NAME", fieldErrors: { modifiers: [expect.any(String)] } });
    expect(updateTag).not.toHaveBeenCalled();
  });
  it("INVALID_LIST from the RPC is a field error on the list; FORBIDDEN maps to FORBIDDEN", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "INVALID_LIST" } });
    expect(await A.saveGroupModifiers("demo", null, form([["groupId", GROUP], ["modifiers", "[]"]]))).toMatchObject({ ok: false, fieldErrors: { modifiers: [expect.any(String)] } });
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "FORBIDDEN" } });
    expect(await A.saveGroupModifiers("demo", null, form([["groupId", GROUP], ["modifiers", "[]"]]))).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
  it("oversized or malformed JSON is rejected before any query", async () => {
    const big = " ".repeat(40_000) + "[]";
    expect(await A.saveItemVariants("demo", null, form([["itemId", ITEM], ["variants", big]]))).toMatchObject({ ok: false, fieldErrors: { variants: ["Too much data."] } });
    expect(await A.saveGroupModifiers("demo", null, form([["groupId", GROUP], ["modifiers", "{bad"]]))).toMatchObject({ ok: false, fieldErrors: { modifiers: [expect.any(String)] } });
    expect(calls).toHaveLength(0);
  });
  it("setItemModifierGroups removes unlisted links, updates kept ones and inserts new ones in order", async () => {
    const G2 = "13131313-1313-4313-8313-131313131313";
    results["modifier_groups.select"] = { data: [{ id: GROUP }, { id: G2 }] };
    results["menu_item_modifier_groups.select"] = { data: [{ group_id: GROUP }, { group_id: FOREIGN }] };
    expect(await A.setItemModifierGroups("demo", null, form([["itemId", ITEM], ["groupIds", G2], ["groupIds", GROUP]]))).toEqual({ ok: true });
    expect(sent("menu_item_modifier_groups.delete")[0]!.filters).toContainEqual(["in:group_id", [FOREIGN]]);
    expect(sent("menu_item_modifier_groups.insert")[0]!.payload).toEqual({ organization_id: ORG, item_id: ITEM, group_id: G2, sort_order: 0 });
    expect(sent("menu_item_modifier_groups.update")[0]!.payload).toEqual({ sort_order: 1 });
  });
});
