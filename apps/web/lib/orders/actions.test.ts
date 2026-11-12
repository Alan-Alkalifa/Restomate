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
const TABLE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ITEM = "11111111-1111-4111-8111-111111111111";
const MOD = "22222222-2222-4222-8222-222222222222";
const REF = "33333333-3333-4333-8333-333333333333";
const ORDER = "44444444-4444-4444-8444-444444444444";
const OLINE = "55555555-5555-4555-8555-555555555555";
const TICKET = "66666666-6666-4666-8666-666666666666";

let permissions = ["orders.create", "pos.use", "orders.void", "pos.discount", "kitchen.update"];
const requirePermission = vi.fn();
vi.mock("@/lib/auth/dal", () => ({
  requireOrgContext: async () => ({ org: { id: ORG, slug: "demo", name: "Demo" }, locations: [{ id: LOC, name: "Main" }], permissions, package: null }),
  requirePermission: (...a: unknown[]) => requirePermission(...a),
  requireUser: async () => ({ id: "user-self", email: "me@x.test" }),
}));

let found: unknown = { id: "x" };
const filters: string[] = [];
function chain() {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) c[m] = (...a: unknown[]) => { if (m === "eq") filters.push(`${a[0]}=${a[1]}`); return c; };
  c.maybeSingle = async () => ({ data: found, error: null });
  return c;
}
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => chain(), rpc }) }));

import {
  applyDiscount, assignWaiter, bumpKot, cancelOrder, markOrderServed, markTableClean, mergeTables, moveOrder, removeDiscount, sendRound,
  setKotItemStatus, unmergeTable, updateKotStatus, voidItem,
} from "./actions";

const form = (pairs: [string, string][]) => { const fd = new FormData(); for (const [k, v] of pairs) fd.append(k, v); return fd; };
const lines = (extra: Record<string, unknown> = {}) =>
  JSON.stringify([{ itemId: ITEM, modifierIds: [MOD], quantity: 2, note: "no onion", ...extra }]);
const round = (over: [string, string][] = []) => {
  const base = new Map<string, string>([["tableId", TABLE], ["channel", "dine_in"], ["lines", lines()], ["clientRef", REF]]);
  for (const [k, v] of over) base.set(k, v);
  return form([...base]);
};

beforeEach(() => {
  vi.clearAllMocks();
  filters.length = 0;
  found = { id: "x" };
  permissions = ["orders.create", "pos.use", "orders.void", "pos.discount", "kitchen.update"];
  requirePermission.mockResolvedValue(undefined);
  rpc.mockResolvedValue({ data: { orderId: ORDER, orderNumber: 7, roundNo: 1, replayed: false }, error: null });
});

describe("sendRound", () => {
  it("forwards only ids, quantities and notes to submit_order_round; the org comes from the server", async () => {
    const r = await sendRound("demo", LOC, null, round());
    expect(r).toEqual({ ok: true, data: { orderId: ORDER, orderNumber: 7, roundNo: 1 } });
    expect(rpc).toHaveBeenCalledWith("submit_order_round", {
      location_id: LOC, table_id: TABLE, channel: "dine_in", client_ref: REF, customer_name: undefined, guest_count: undefined,
      lines: [{ item_id: ITEM, variant_id: null, modifier_ids: [MOD], quantity: 2, note: "no onion" }],
    });
    expect(JSON.stringify(rpc.mock.calls[0])).not.toContain(ORG);
    expect(updateTag).toHaveBeenCalledWith(`orders:${LOC}`);
    expect(capture).toHaveBeenCalledWith("order_placed", { distinctId: "user-self", organizationId: ORG });
  });
  it("later rounds are order_round_sent; a replay captures nothing", async () => {
    rpc.mockResolvedValueOnce({ data: { orderId: ORDER, orderNumber: 7, roundNo: 2, replayed: false }, error: null });
    await sendRound("demo", LOC, null, round());
    expect(capture).toHaveBeenLastCalledWith("order_round_sent", expect.anything());
    capture.mockClear();
    rpc.mockResolvedValueOnce({ data: { orderId: ORDER, orderNumber: 7, roundNo: 2, replayed: true }, error: null });
    await sendRound("demo", LOC, null, round());
    expect(capture).not.toHaveBeenCalled();
  });
  it("takeaway sends an explicit null table", async () => {
    await sendRound("demo", LOC, null, form([["tableId", ""], ["channel", "takeaway"], ["lines", lines()], ["clientRef", REF], ["customerName", "Ayu"]]));
    expect(rpc.mock.calls[0][1]).toMatchObject({ table_id: null, channel: "takeaway", customer_name: "Ayu" });
  });
  it("rejects a client price, name or total in a line (strict), and never calls the RPC", async () => {
    for (const extra of [{ price: 1 }, { unitPrice: 1 }, { total: 1 }, { organizationId: ORG }, { name: "x" }]) {
      const r = await sendRound("demo", LOC, null, round([["lines", lines(extra)]]));
      expect(r).toMatchObject({ ok: false, fieldErrors: { lines: expect.any(Array) } });
    }
    expect(rpc).not.toHaveBeenCalled();
  });
  it("validates shape: dine_in needs a table, takeaway has none, quantity 1..99, at least one line", async () => {
    expect(await sendRound("demo", LOC, null, form([["channel", "dine_in"], ["lines", lines()], ["clientRef", REF]]))).toMatchObject({ ok: false });
    expect(await sendRound("demo", LOC, null, round([["channel", "takeaway"]]))).toMatchObject({ ok: false });
    expect(await sendRound("demo", LOC, null, round([["lines", lines({ quantity: 100 })]]))).toMatchObject({ ok: false });
    expect(await sendRound("demo", LOC, null, round([["lines", "[]"]]))).toMatchObject({ ok: false });
    expect(await sendRound("demo", LOC, null, round([["lines", "{not json"]]))).toMatchObject({ ok: false });
    expect(await sendRound("demo", LOC, null, round([["clientRef", "nope"]]))).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("maps RPC errors to codes, with the unavailable item ids", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "ITEM_UNAVAILABLE", details: `["${ITEM}"]`, code: "P0001" } });
    expect(await sendRound("demo", LOC, null, round())).toMatchObject({ ok: false, code: "ITEM_UNAVAILABLE", details: { itemIds: [ITEM] } });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "CLIENT_REF_CONFLICT", code: "P0001" } });
    expect(await sendRound("demo", LOC, null, round())).toMatchObject({ code: "CLIENT_REF_CONFLICT" });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "PLAN_LIMIT:max_orders_per_month", code: "P0001" } });
    expect(await sendRound("demo", LOC, null, round())).toMatchObject({ code: "PLAN_LIMIT" });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "permission denied", code: "42501" } });
    expect(await sendRound("demo", LOC, null, round())).toMatchObject({ code: "FORBIDDEN" });
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'syntax error at "select"', code: "42601" } });
    const r = await sendRound("demo", LOC, null, round());
    expect(JSON.stringify(r)).not.toContain("syntax");
  });
  it("refuses a location the caller cannot access, and a caller without the permission", async () => {
    await expect(sendRound("demo", OTHER_LOC, null, round())).rejects.toBeInstanceOf(Forbidden);
    permissions = [];
    requirePermission.mockImplementation(() => { throw new Forbidden("403"); });
    await expect(sendRound("demo", LOC, null, round())).rejects.toBeInstanceOf(Forbidden);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("mutations scoped to the bound location", () => {
  const cases: [string, () => Promise<unknown>, string][] = [
    ["voidItem", () => voidItem("demo", LOC, null, form([["orderItemId", OLINE], ["reason", "customer left"]])), "void_order_item"],
    ["cancelOrder", () => cancelOrder("demo", LOC, null, form([["orderId", ORDER], ["reason", "guest left"]])), "cancel_order"],
    ["applyDiscount", () => applyDiscount("demo", LOC, null, form([["orderId", ORDER], ["amount", "5000"], ["reason", "loyal guest"]])), "apply_order_discount"],
    ["removeDiscount", () => removeDiscount("demo", LOC, null, form([["discountId", OLINE], ["reason", "by mistake"]])), "remove_order_discount"],
    ["markOrderServed", () => markOrderServed("demo", LOC, null, form([["orderId", ORDER]])), "set_order_status"],
    ["updateKotStatus", () => updateKotStatus("demo", LOC, null, form([["ticketId", TICKET], ["status", "in_progress"]])), "update_kot_status"],
    ["bumpKot", () => bumpKot("demo", LOC, null, form([["ticketId", TICKET]])), "update_kot_status"],
    ["setKotItemStatus", () => setKotItemStatus("demo", LOC, null, form([["ticketItemId", OLINE], ["status", "ready"]])), "set_kot_item_status"],
    ["markTableClean", () => markTableClean("demo", LOC, null, form([["tableId", TABLE]])), "mark_table_clean"],
  ];
  it.each(cases)("%s calls its RPC when the id is in this location", async (_n, call, fn) => {
    rpc.mockResolvedValue({ data: {}, error: null });
    expect(await call()).toMatchObject({ ok: true });
    expect(rpc.mock.calls[0][0]).toBe(fn);
    expect(updateTag).toHaveBeenCalledWith(`orders:${LOC}`);
    expect(filters).toContain(`location_id=${LOC}`);
    expect(filters).toContain(`organization_id=${ORG}`);
  });
  it.each(cases)("%s refuses an id outside this location without calling the RPC", async (_n, call) => {
    found = null;
    expect(await call()).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("bumpKot sends bumped; updateKotStatus rejects bumped (use bumpKot)", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    await bumpKot("demo", LOC, null, form([["ticketId", TICKET]]));
    expect(rpc).toHaveBeenCalledWith("update_kot_status", { ticket_id: TICKET, to_status: "bumped" });
    expect(await updateKotStatus("demo", LOC, null, form([["ticketId", TICKET], ["status", "bumped"]]))).toMatchObject({ ok: false });
  });
  it("applyDiscount takes whole minor units only", async () => {
    for (const amount of ["0", "-5", "1.5", "5e3", "", "1000000000000"]) {
      expect(await applyDiscount("demo", LOC, null, form([["orderId", ORDER], ["amount", amount], ["reason", "loyal guest"]]))).toMatchObject({ ok: false });
    }
    expect(rpc).not.toHaveBeenCalled();
  });
  it("a void needs a reason", async () => {
    expect(await voidItem("demo", LOC, null, form([["orderItemId", OLINE], ["reason", "x"]]))).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("voidItem is open to orders.create alone (the RPC allows the creator while the ticket is new)", async () => {
    permissions = ["orders.create"];
    rpc.mockResolvedValue({ data: {}, error: null });
    expect(await voidItem("demo", LOC, null, form([["orderItemId", OLINE], ["reason", "changed mind"]]))).toMatchObject({ ok: true });
    rpc.mockResolvedValue({ data: null, error: { message: "FORBIDDEN", code: "42501" } });
    expect(await voidItem("demo", LOC, null, form([["orderItemId", OLINE], ["reason", "changed mind"]]))).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
  it("cancelOrder and discounts need their own permission", async () => {
    permissions = ["orders.create"];
    requirePermission.mockImplementation(() => { throw new Forbidden("403"); });
    await expect(cancelOrder("demo", LOC, null, form([["orderId", ORDER], ["reason", "guest left"]]))).rejects.toBeInstanceOf(Forbidden);
    await expect(applyDiscount("demo", LOC, null, form([["orderId", ORDER], ["amount", "1"], ["reason", "loyal guest"]]))).rejects.toBeInstanceOf(Forbidden);
    expect(rpc).not.toHaveBeenCalled();
  });
});


describe("table operations", () => {
  const TO = "77777777-7777-4777-8777-777777777777";
  const T2 = "88888888-8888-4888-8888-888888888888";
  const WAITER = "99999999-9999-4999-8999-999999999990";

  it("moveOrder sends only the order and the target; the location is checked first", async () => {
    rpc.mockResolvedValue({ data: { orderId: ORDER }, error: null });
    expect(await moveOrder("demo", LOC, null, form([["orderId", ORDER], ["toTableId", TO]]))).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("move_order_to_table", { order_id: ORDER, to_table_id: TO });
    expect(filters).toContain(`location_id=${LOC}`);
    expect(updateTag).toHaveBeenCalledWith(`orders:${LOC}`);
    expect(capture).toHaveBeenCalledWith("order_moved", { distinctId: "user-self", organizationId: ORG });
    expect(JSON.stringify(rpc.mock.calls[0])).not.toContain(ORG);
  });
  it("an order of another location never reaches the RPC", async () => {
    found = null;
    for (const call of [
      () => moveOrder("demo", LOC, null, form([["orderId", ORDER], ["toTableId", TO]])),
      () => mergeTables("demo", LOC, null, form([["orderId", ORDER], ["tableIds", JSON.stringify([TO])]])),
      () => unmergeTable("demo", LOC, null, form([["orderId", ORDER], ["tableId", TO]])),
      () => assignWaiter("demo", LOC, null, form([["orderId", ORDER], ["waiterId", WAITER]])),
    ]) expect(await call()).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("mergeTables validates the list: 1..9 distinct uuids", async () => {
    rpc.mockResolvedValue({ data: { orderId: ORDER, tableIds: [TO] }, error: null });
    expect(await mergeTables("demo", LOC, null, form([["orderId", ORDER], ["tableIds", JSON.stringify([TO, T2])]]))).toEqual({ ok: true });
    expect(rpc).toHaveBeenLastCalledWith("merge_tables", { order_id: ORDER, table_ids: [TO, T2] });
    expect(capture).toHaveBeenCalledWith("tables_merged", { distinctId: "user-self", organizationId: ORG });
    rpc.mockClear();
    for (const bad of ["[]", "not json", JSON.stringify([TO, TO]), JSON.stringify(Array.from({ length: 10 }, (_, i) => `00000000-0000-4000-8000-00000000000${i}`)), JSON.stringify(["x"])]) {
      expect(await mergeTables("demo", LOC, null, form([["orderId", ORDER], ["tableIds", bad]])), bad).toMatchObject({ ok: false, fieldErrors: { tableIds: [expect.any(String)] } });
    }
    expect(rpc).not.toHaveBeenCalled();
  });
  it("unmergeTable sends the order and the table", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    expect(await unmergeTable("demo", LOC, null, form([["orderId", ORDER], ["tableId", TO]]))).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("unmerge_table", { order_id: ORDER, table_id: TO });
    expect(capture).toHaveBeenCalledWith("table_unmerged", { distinctId: "user-self", organizationId: ORG });
  });
  it("assignWaiter: an empty waiter clears; the permission is orders.create OR tables.manage", async () => {
    rpc.mockResolvedValue({ data: {}, error: null });
    expect(await assignWaiter("demo", LOC, null, form([["orderId", ORDER], ["waiterId", ""]]))).toEqual({ ok: true });
    expect(rpc).toHaveBeenLastCalledWith("assign_order_waiter", { order_id: ORDER, waiter_id: null });
    await assignWaiter("demo", LOC, null, form([["orderId", ORDER], ["waiterId", WAITER]]));
    expect(rpc).toHaveBeenLastCalledWith("assign_order_waiter", { order_id: ORDER, waiter_id: WAITER });
    expect(capture).toHaveBeenCalledWith("waiter_assigned", { distinctId: "user-self", organizationId: ORG });
    permissions = ["tables.manage"];
    expect(await assignWaiter("demo", LOC, null, form([["orderId", ORDER], ["waiterId", WAITER]]))).toEqual({ ok: true });
    expect(requirePermission).not.toHaveBeenCalled();
    permissions = ["kitchen.update"];
    requirePermission.mockRejectedValue(new Forbidden("403"));
    await expect(assignWaiter("demo", LOC, null, form([["orderId", ORDER], ["waiterId", WAITER]]))).rejects.toBeInstanceOf(Forbidden);
  });
  it("maps the new error codes to friendly messages without ids", async () => {
    for (const code of ["ORDER_NOT_MOVABLE", "ORDER_HAS_GROUP", "TABLE_NOT_AVAILABLE", "TABLE_IN_GROUP", "TABLE_NOT_IN_GROUP", "INVALID_ASSIGNEE"]) {
      rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: code, details: TO } });
      const r = await moveOrder("demo", LOC, null, form([["orderId", ORDER], ["toTableId", TO]]));
      expect(r, code).toMatchObject({ ok: false, code });
      expect(JSON.stringify(r)).not.toContain(TO);
    }
    expect(updateTag).not.toHaveBeenCalled();
  });
  it("a kitchen user (no orders.create) cannot move", async () => {
    permissions = ["kitchen.update"];
    requirePermission.mockRejectedValue(new Forbidden("403"));
    await expect(moveOrder("demo", LOC, null, form([["orderId", ORDER], ["toTableId", TO]]))).rejects.toBeInstanceOf(Forbidden);
    expect(rpc).not.toHaveBeenCalled();
  });
});
