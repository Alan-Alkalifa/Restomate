import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
class Forbidden extends Error {}
vi.mock("next/navigation", () => ({ forbidden: () => { throw new Forbidden("403"); }, notFound: () => { throw new Error("404"); } }));
const updateTag = vi.fn();
vi.mock("next/cache", () => ({ updateTag: (t: string) => updateTag(t) }));
vi.mock("@/lib/env", () => ({ publicEnv: { NEXT_PUBLIC_APP_URL: "https://app.restomate.app", NEXT_PUBLIC_ROOT_DOMAIN: "restomate.app" } }));
const capture = vi.fn();
vi.mock("@/lib/posthog/server", () => ({ captureServer: (...a: unknown[]) => capture(...a) }));

const ORG = "99999999-9999-4999-8999-999999999999";
const LOC = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const OTHER_LOC = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const AREA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AREA2 = "abababab-abab-4bab-8bab-abababababab";
const TABLE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TABLE2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const requirePermission = vi.fn();
vi.mock("@/lib/auth/dal", () => ({
  requireOrgContext: async () => ({ org: { id: ORG, slug: "demo", name: "Demo" }, locations: [{ id: LOC, name: "Main" }], permissions: ["tables.manage"], package: null }),
  requirePermission: (...a: unknown[]) => requirePermission(...a),
  requireUser: async () => ({ id: "user-self", email: "me@x.test" }),
}));

type Res = { data?: unknown; error?: unknown };
let results: Record<string, Res | Res[]> = {};
const calls: { key: string; payload?: unknown }[] = [];
function chain(table: string) {
  let op = "select";
  let payload: unknown;
  const get = (): Res => {
    const key = `${table}.${op}`;
    calls.push({ key, payload });
    const r = results[key] ?? { data: null, error: null };
    return Array.isArray(r) ? (r.shift() ?? { data: null, error: null }) : r;
  };
  const c: Record<string, unknown> = {};
  for (const m of ["eq", "is", "in", "order", "select", "limit"]) c[m] = () => c;
  c.insert = (p: unknown) => { op = "insert"; payload = p; return c; };
  c.update = (p: unknown) => { op = "update"; payload = p; return c; };
  c.maybeSingle = async () => get();
  c.then = (res: (v: Res) => unknown) => res(get());
  return c;
}
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (t: string) => chain(t), rpc }) }));

import {
  createArea, createTable, renameArea, reorderAreas, rotateTableQr, saveTablePositions, setAreaActive, setTableActive, updateTable,
} from "./actions";

const form = (pairs: [string, string][]) => { const fd = new FormData(); for (const [k, v] of pairs) fd.append(k, v); return fd; };
const sent = (key: string) => calls.filter((c) => c.key === key);

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  requirePermission.mockResolvedValue(undefined);
  rpc.mockResolvedValue({ data: "newtoken", error: null });
  results = {
    "areas.select": { data: { id: AREA, is_active: true, sort_order: 2 } },
    "tables.select": { data: { id: TABLE } },
  };
});

describe("authorization", () => {
  const all: [string, () => Promise<unknown>][] = [
    ["createArea", () => createArea("demo", LOC, null, form([["name", "Patio"]]))],
    ["renameArea", () => renameArea("demo", LOC, null, form([["areaId", AREA], ["name", "X"]]))],
    ["setAreaActive", () => setAreaActive("demo", LOC, null, form([["areaId", AREA], ["active", "false"]]))],
    ["reorderAreas", () => reorderAreas("demo", LOC, null, form([["areaIds", AREA]]))],
    ["createTable", () => createTable("demo", LOC, null, form([["areaId", AREA], ["label", "T1"], ["capacity", "2"], ["shape", "square"]]))],
    ["updateTable", () => updateTable("demo", LOC, null, form([["tableId", TABLE], ["areaId", AREA], ["label", "T1"], ["capacity", "2"], ["shape", "square"]]))],
    ["setTableActive", () => setTableActive("demo", LOC, null, form([["tableId", TABLE], ["active", "true"]]))],
    ["saveTablePositions", () => saveTablePositions("demo", LOC, null, form([["positions", JSON.stringify([{ tableId: TABLE, posX: 1, posY: 1 }])]]))],
    ["rotateTableQr", () => rotateTableQr("demo", LOC, null, form([["tableId", TABLE]]))],
  ];
  it.each(all)("%s is forbidden without tables.manage and writes nothing", async (_n, run) => {
    requirePermission.mockImplementation(() => { throw new Forbidden("403"); });
    await expect(run()).rejects.toBeInstanceOf(Forbidden);
    expect(calls.filter((c) => /insert|update/.test(c.key))).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("requires tables.manage on the org derived from the slug", async () => {
    await createArea("demo", LOC, null, form([["name", "Patio"]]));
    expect(requirePermission).toHaveBeenCalledWith(ORG, "tables.manage");
  });
  it("rejects a location the user cannot access", async () => {
    await expect(createArea("demo", OTHER_LOC, null, form([["name", "Patio"]]))).rejects.toBeInstanceOf(Forbidden);
    await expect(createArea("demo", "not-a-uuid", null, form([["name", "Patio"]]))).rejects.toBeInstanceOf(Forbidden);
    expect(sent("areas.insert")).toHaveLength(0);
  });
});

describe("areas", () => {
  it("createArea appends after the last sort_order, ignores client org/location, tags and captures", async () => {
    results["areas.select"] = { data: { sort_order: 4 } };
    const r = await createArea("demo", LOC, null, form([["name", " Patio "], ["organization_id", "x"], ["locationId", OTHER_LOC]]));
    expect(r).toEqual({ ok: true });
    expect(sent("areas.insert")[0]!.payload).toEqual({ organization_id: ORG, location_id: LOC, name: "Patio", sort_order: 5 });
    expect(updateTag).toHaveBeenCalledWith(`venue:${LOC}`);
    expect(capture).toHaveBeenCalledWith("area_created", { distinctId: "user-self", organizationId: ORG });
  });
  it("maps duplicate names and does not tag on failure", async () => {
    results["areas.insert"] = { error: { code: "23505", message: "duplicate" } };
    expect(await createArea("demo", LOC, null, form([["name", "Patio"]]))).toMatchObject({ ok: false, code: "DUPLICATE_NAME" });
    expect(updateTag).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });
  it("validates the name", async () => {
    expect(await createArea("demo", LOC, null, form([["name", "   "]]))).toMatchObject({ ok: false, fieldErrors: { name: [expect.any(String)] } });
  });
  it("rename / setActive reject an area of another location (IDOR)", async () => {
    results["areas.select"] = { data: null };
    expect(await renameArea("demo", LOC, null, form([["areaId", AREA], ["name", "X"]]))).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await setAreaActive("demo", LOC, null, form([["areaId", AREA], ["active", "false"]]))).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(sent("areas.update")).toHaveLength(0);
  });
  it("setAreaActive maps AREA_NOT_EMPTY", async () => {
    results["areas.update"] = { error: { code: "P0001", message: "AREA_NOT_EMPTY" } };
    expect(await setAreaActive("demo", LOC, null, form([["areaId", AREA], ["active", "false"]]))).toMatchObject({ ok: false, code: "AREA_NOT_EMPTY" });
  });
  it("reorderAreas rejects foreign or duplicate ids and updates only what moved", async () => {
    results["areas.select"] = { data: [{ id: AREA, sort_order: 0 }] };
    expect(await reorderAreas("demo", LOC, null, form([["areaIds", AREA], ["areaIds", AREA2]]))).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await reorderAreas("demo", LOC, null, form([["areaIds", AREA], ["areaIds", AREA]]))).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(sent("areas.update")).toHaveLength(0);
    results["areas.select"] = { data: [{ id: AREA, sort_order: 0 }, { id: AREA2, sort_order: 1 }] };
    expect(await reorderAreas("demo", LOC, null, form([["areaIds", AREA2], ["areaIds", AREA]]))).toEqual({ ok: true });
    expect(sent("areas.update")).toHaveLength(2);
  });
});

describe("tables", () => {
  const valid = (extra: [string, string][] = []) => form([["areaId", AREA], ["label", "T1"], ["capacity", "4"], ["shape", "round"], ...extra]);
  it("createTable inserts with server-side org/location and captures", async () => {
    expect(await createTable("demo", LOC, null, valid())).toEqual({ ok: true });
    expect(sent("tables.insert")[0]!.payload).toEqual({ organization_id: ORG, location_id: LOC, area_id: AREA, label: "T1", capacity: 4, shape: "round" });
    expect(capture).toHaveBeenCalledWith("table_created", { distinctId: "user-self", organizationId: ORG });
  });
  it("createTable rejects an area outside this location", async () => {
    results["areas.select"] = { data: null };
    expect(await createTable("demo", LOC, null, valid())).toMatchObject({ ok: false, fieldErrors: { areaId: [expect.any(String)] } });
    expect(sent("tables.insert")).toHaveLength(0);
  });
  it("createTable maps PLAN_LIMIT, DUPLICATE_NAME and AREA_INACTIVE", async () => {
    results["tables.insert"] = [{ error: { code: "P0001", message: "PLAN_LIMIT:max_tables" } }, { error: { code: "23505", message: "dup" } }, { error: { code: "P0001", message: "AREA_INACTIVE" } }];
    expect(await createTable("demo", LOC, null, valid())).toMatchObject({ ok: false, code: "PLAN_LIMIT" });
    expect(await createTable("demo", LOC, null, valid())).toMatchObject({ ok: false, code: "DUPLICATE_NAME" });
    expect(await createTable("demo", LOC, null, valid())).toMatchObject({ ok: false, formError: expect.stringContaining("inactive") });
  });
  it("updateTable / setTableActive / rotate reject a table of another location (IDOR)", async () => {
    results["tables.select"] = { data: null };
    expect(await updateTable("demo", LOC, null, valid([["tableId", TABLE]]))).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await setTableActive("demo", LOC, null, form([["tableId", TABLE], ["active", "true"]]))).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await rotateTableQr("demo", LOC, null, form([["tableId", TABLE]]))).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(sent("tables.update")).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("updateTable rejects a foreign area", async () => {
    results["areas.select"] = { data: null };
    expect(await updateTable("demo", LOC, null, valid([["tableId", TABLE]]))).toMatchObject({ ok: false, fieldErrors: { areaId: [expect.any(String)] } });
  });
  it("setTableActive maps PLAN_LIMIT on reactivation", async () => {
    results["tables.update"] = { error: { code: "P0001", message: "PLAN_LIMIT:max_tables" } };
    expect(await setTableActive("demo", LOC, null, form([["tableId", TABLE], ["active", "true"]]))).toMatchObject({ ok: false, code: "PLAN_LIMIT" });
  });
});

describe("saveTablePositions", () => {
  const body = (v: unknown) => form([["positions", typeof v === "string" ? v : JSON.stringify(v)]]);
  const p = (tableId: string) => ({ tableId, posX: 10, posY: 20 });
  it("rejects malformed JSON, oversized input and foreign ids", async () => {
    expect(await saveTablePositions("demo", LOC, null, body("{bad"))).toMatchObject({ ok: false, fieldErrors: { positions: [expect.any(String)] } });
    results["tables.select"] = { data: [{ id: TABLE }] };
    expect(await saveTablePositions("demo", LOC, null, body([p(TABLE), p(TABLE2)]))).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(sent("tables.update")).toHaveLength(0);
  });
  it("rejects positions outside the 0..999 canvas before touching the database", async () => {
    for (const bad of [{ tableId: TABLE, posX: -1, posY: 0 }, { tableId: TABLE, posX: 1000, posY: 0 }, { tableId: TABLE, posX: 0, posY: -1 }, { tableId: TABLE, posX: 0, posY: 1000 }]) {
      expect(await saveTablePositions("demo", LOC, null, body([bad]))).toMatchObject({ ok: false, formError: expect.stringContaining("floor plan") });
    }
    expect(sent("tables.update")).toHaveLength(0);
    expect(sent("tables.select")).toHaveLength(0);
  });
  it("maps a position CHECK violation from the database to a friendly message", async () => {
    results["tables.select"] = { data: [{ id: TABLE }] };
    results["tables.update"] = { error: { code: "23514", message: 'new row violates check constraint "tables_pos_x_range"' } };
    const r = await saveTablePositions("demo", LOC, null, body([p(TABLE)]));
    expect(r).toMatchObject({ ok: false, formError: expect.stringContaining("floor plan") });
    expect(JSON.stringify(r)).not.toContain("tables_pos_x_range");
  });
  it("saves positions for tables of this location", async () => {
    results["tables.select"] = { data: [{ id: TABLE }, { id: TABLE2 }] };
    expect(await saveTablePositions("demo", LOC, null, body([p(TABLE), p(TABLE2)]))).toEqual({ ok: true });
    expect(sent("tables.update").map((c) => c.payload)).toEqual([{ pos_x: 10, pos_y: 20 }, { pos_x: 10, pos_y: 20 }]);
    expect(updateTag).toHaveBeenCalledWith(`venue:${LOC}`);
  });
});

describe("rotateTableQr", () => {
  it("calls the RPC, never returns or logs the token", async () => {
    const r = await rotateTableQr("demo", LOC, null, form([["tableId", TABLE]]));
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("rotate_table_qr_token", { table_id: TABLE });
    expect(JSON.stringify(capture.mock.calls)).not.toContain("newtoken");
    expect(capture).toHaveBeenCalledWith("table_qr_rotated", { distinctId: "user-self", organizationId: ORG });
    expect(updateTag).toHaveBeenCalledWith(`venue:${LOC}`);
  });
  it("maps RPC errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "TABLE_INACTIVE" } });
    expect(await rotateTableQr("demo", LOC, null, form([["tableId", TABLE]]))).toMatchObject({ ok: false, formError: expect.stringContaining("Reactivate") });
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "FORBIDDEN" } });
    expect(await rotateTableQr("demo", LOC, null, form([["tableId", TABLE]]))).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(updateTag).not.toHaveBeenCalled();
  });
});
