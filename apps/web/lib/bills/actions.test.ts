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
const ORDER = "44444444-4444-4444-8444-444444444444";
const SET = "55555555-5555-4555-8555-555555555555";
const BILL = "66666666-6666-4666-8666-666666666666";
const PAY = "77777777-7777-4777-8777-777777777777";
const SESSION = "88888888-8888-4888-8888-888888888888";
const REF = "33333333-3333-4333-8333-333333333333";
const LINE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LINE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let permissions = ["payments.take", "payments.refund", "payments.view", "bills.print"];
const requirePermission = vi.fn();
vi.mock("@/lib/auth/dal", () => ({
  requireOrgContext: async () => ({ org: { id: ORG, slug: "demo", name: "Demo" }, locations: [{ id: LOC, name: "Main" }], permissions, package: null }),
  requirePermission: (...a: unknown[]) => requirePermission(...a),
  requireUser: async () => ({ id: "user-self", email: "me@x.test" }),
}));

let found: unknown = { id: "x" };
const filters: string[] = [];
const tables: string[] = [];
function chain() {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq"]) c[m] = (...a: unknown[]) => { if (m === "eq") filters.push(`${a[0]}=${a[1]}`); return c; };
  c.maybeSingle = async () => ({ data: found, error: null });
  return c;
}
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (t: string) => { tables.push(t); return chain(); }, rpc }) }));

import { closeCashSession, createBills, openCashSession, recordBillPrint, recordPayment, recordRefund, voidBillSet } from "./actions";
import { mapBillError } from "./errors";

const form = (pairs: [string, string][]) => { const fd = new FormData(); for (const [k, v] of pairs) fd.append(k, v); return fd; };
const run = (fn: typeof createBills, over: [string, string][]) => fn("demo", LOC, null, form(over));

beforeEach(() => {
  vi.clearAllMocks();
  filters.length = 0;
  tables.length = 0;
  found = { id: "x" };
  permissions = ["payments.take", "payments.refund", "payments.view", "bills.print"];
  requirePermission.mockResolvedValue(undefined);
  rpc.mockResolvedValue({ data: {}, error: null });
});

describe("createBills", () => {
  it("sends only the order id, the split choice and the client ref; the org and location come from the server", async () => {
    rpc.mockResolvedValue({ data: { billSetId: SET, replayed: false }, error: null });
    const r = await run(createBills, [["orderId", ORDER], ["clientRef", REF]]);
    expect(r).toEqual({ ok: true, data: { billSetId: SET } });
    expect(rpc).toHaveBeenCalledWith("create_bills", { order_id: ORDER, client_ref: REF, split_kind: "none" });
    expect(JSON.stringify(rpc.mock.calls[0])).not.toContain(ORG);
    expect(filters).toContain(`organization_id=${ORG}`);
    expect(filters).toContain(`location_id=${LOC}`);
    expect(updateTag).toHaveBeenCalledWith(`bills:${LOC}`);
    expect(updateTag).toHaveBeenCalledWith(`orders:${LOC}`);
    expect(capture).toHaveBeenCalledWith("bill_created", { distinctId: "user-self", organizationId: ORG });
  });
  it("a waiter (bills.print only) may raise the pre-bill", async () => {
    permissions = ["bills.print"];
    expect(await run(createBills, [["orderId", ORDER], ["clientRef", REF]])).toMatchObject({ ok: true });
    expect(requirePermission).not.toHaveBeenCalled();
  });
  it("neither payments.take nor bills.print: requirePermission decides (and refuses)", async () => {
    permissions = ["orders.view"];
    requirePermission.mockRejectedValue(new Forbidden("403"));
    await expect(run(createBills, [["orderId", ORDER], ["clientRef", REF]])).rejects.toBeInstanceOf(Forbidden);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("equal needs a share count; by_item needs groups; counts and groups are bounded", async () => {
    expect(await run(createBills, [["orderId", ORDER], ["clientRef", REF], ["splitKind", "equal"]])).toMatchObject({ ok: false, fieldErrors: { splitCount: [expect.any(String)] } });
    expect(await run(createBills, [["orderId", ORDER], ["clientRef", REF], ["splitKind", "equal"], ["splitCount", "21"]])).toMatchObject({ ok: false });
    expect(await run(createBills, [["orderId", ORDER], ["clientRef", REF], ["splitKind", "by_item"]])).toMatchObject({ ok: false, fieldErrors: { assignments: [expect.any(String)] } });
    expect(await run(createBills, [["orderId", ORDER], ["clientRef", REF], ["splitKind", "by_item"], ["assignments", JSON.stringify([[LINE_A]])]])).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("forwards a valid equal and by_item split", async () => {
    rpc.mockResolvedValue({ data: { billSetId: SET, replayed: false }, error: null });
    await run(createBills, [["orderId", ORDER], ["clientRef", REF], ["splitKind", "equal"], ["splitCount", "3"]]);
    expect(rpc).toHaveBeenLastCalledWith("create_bills", { order_id: ORDER, client_ref: REF, split_kind: "equal", split_count: 3 });
    await run(createBills, [["orderId", ORDER], ["clientRef", REF], ["splitKind", "by_item"], ["assignments", JSON.stringify([[LINE_A], [LINE_B]])]]);
    expect(rpc).toHaveBeenLastCalledWith("create_bills", { order_id: ORDER, client_ref: REF, split_kind: "by_item", assignments: [[LINE_A], [LINE_B]] });
  });
  it("an order of another location is NOT_FOUND-as-FORBIDDEN and never reaches the RPC", async () => {
    found = null;
    expect(await run(createBills, [["orderId", ORDER], ["clientRef", REF]])).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("a replay does not count a second bill_created", async () => {
    rpc.mockResolvedValue({ data: { billSetId: SET, replayed: true }, error: null });
    await run(createBills, [["orderId", ORDER], ["clientRef", REF]]);
    expect(capture).not.toHaveBeenCalled();
  });
  it("maps BILL_EXISTS to a friendly error without ids", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "BILL_EXISTS", details: SET } });
    const r = await run(createBills, [["orderId", ORDER], ["clientRef", REF]]);
    expect(r).toMatchObject({ ok: false, code: "BILL_EXISTS" });
    expect(JSON.stringify(r)).not.toContain(SET);
    expect(updateTag).not.toHaveBeenCalled();
  });
});

describe("recordPayment", () => {
  const base: [string, string][] = [["billId", BILL], ["clientRef", REF]];
  it("cash: sends amount, tendered and the client ref; returns the change and the new status", async () => {
    rpc.mockResolvedValue({ data: { paymentId: PAY, paymentStatus: "partially_paid", outstanding: 26018, changeGiven: 20000, orderCompleted: false, replayed: false }, error: null });
    const r = await run(recordPayment, [...base, ["method", "cash"], ["amount", "30000"], ["tendered", "50000"]]);
    expect(r).toEqual({ ok: true, data: { paymentId: PAY, paymentStatus: "partially_paid", outstanding: 26018, changeGiven: 20000, orderCompleted: false } });
    expect(rpc).toHaveBeenCalledWith("record_payment", { bill_id: BILL, method: "cash", amount: 30000, client_ref: REF, tendered: 50000 });
    expect(capture).toHaveBeenCalledWith("payment_recorded", { distinctId: "user-self", organizationId: ORG, properties: { method: "cash" } });
    expect(JSON.stringify(capture.mock.calls)).not.toContain("30000");
  });
  it("card with an approval code; other with a label", async () => {
    await run(recordPayment, [...base, ["method", "edc_card"], ["amount", "1000"], ["approvalCode", "A1B2C3"]]);
    expect(rpc).toHaveBeenLastCalledWith("record_payment", { bill_id: BILL, method: "edc_card", amount: 1000, client_ref: REF, approval_code: "A1B2C3" });
    await run(recordPayment, [...base, ["method", "other"], ["amount", "1000"], ["methodLabel", "Voucher"]]);
    expect(rpc).toHaveBeenLastCalledWith("record_payment", { bill_id: BILL, method: "other", amount: 1000, client_ref: REF, method_label: "Voucher" });
  });
  it("doku is not selectable from the client (reserved for the verified M5 notification)", async () => {
    expect(await run(recordPayment, [...base, ["method", "doku"], ["amount", "1000"]])).toMatchObject({ ok: false, fieldErrors: { method: [expect.any(String)] } });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("validation: positive whole amounts, cash needs tendered >= amount, other needs a label, no card number as an approval code", async () => {
    for (const amount of ["0", "-5", "10.5", "1e3", "abc", "", "1000000000000"]) {
      expect(await run(recordPayment, [...base, ["method", "edc_card"], ["amount", amount]]), amount).toMatchObject({ ok: false, fieldErrors: { amount: [expect.any(String)] } });
    }
    expect(await run(recordPayment, [...base, ["method", "cash"], ["amount", "1000"]])).toMatchObject({ ok: false, fieldErrors: { tendered: [expect.any(String)] } });
    expect(await run(recordPayment, [...base, ["method", "cash"], ["amount", "1000"], ["tendered", "999"]])).toMatchObject({ ok: false, fieldErrors: { tendered: [expect.any(String)] } });
    expect(await run(recordPayment, [...base, ["method", "edc_card"], ["amount", "1000"], ["tendered", "1000"]])).toMatchObject({ ok: false, fieldErrors: { tendered: [expect.any(String)] } });
    expect(await run(recordPayment, [...base, ["method", "cash"], ["amount", "1000"], ["tendered", "1000000000000"]])).toMatchObject({ ok: false, fieldErrors: { tendered: [expect.any(String)] } });
    expect(await run(recordPayment, [...base, ["method", "other"], ["amount", "1000"], ["methodLabel", "  Voucher "]])).toMatchObject({ ok: true });
    expect(rpc).toHaveBeenLastCalledWith("record_payment", expect.objectContaining({ method_label: "Voucher" }));
    expect(await run(recordPayment, [...base, ["method", "other"], ["amount", "1000"]])).toMatchObject({ ok: false, fieldErrors: { methodLabel: [expect.any(String)] } });
    expect(await run(recordPayment, [...base, ["method", "edc_card"], ["amount", "1000"], ["approvalCode", "4111111111111111"]])).toMatchObject({ ok: false, fieldErrors: { approvalCode: [expect.any(String)] } });
    expect(await run(recordPayment, [...base, ["method", "cash"], ["amount", "1000"], ["tendered", "1000"], ["approvalCode", "ABCD"]])).toMatchObject({ ok: false, fieldErrors: { approvalCode: [expect.any(String)] } });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("a waiter cannot take a payment; a missing permission goes to requirePermission", async () => {
    permissions = ["bills.print"];
    requirePermission.mockRejectedValue(new Forbidden("403"));
    await expect(run(recordPayment, [...base, ["method", "edc_card"], ["amount", "1000"]])).rejects.toBeInstanceOf(Forbidden);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("a replay returns the stored result without a second analytics event", async () => {
    rpc.mockResolvedValue({ data: { paymentId: PAY, paymentStatus: "paid", outstanding: 0, changeGiven: null, orderCompleted: true, replayed: true }, error: null });
    const r = await run(recordPayment, [...base, ["method", "edc_card"], ["amount", "1000"]]);
    expect(r).toEqual({ ok: true, data: { paymentId: PAY, paymentStatus: "paid", outstanding: 0, orderCompleted: true } });
    expect(capture).not.toHaveBeenCalled();
  });
  it.each([
    ["PAYMENT_EXCEEDS_OUTSTANDING", "PAYMENT_EXCEEDS_OUTSTANDING"], ["TENDERED_TOO_LOW", "TENDERED_TOO_LOW"], ["NO_OPEN_SESSION", "NO_OPEN_SESSION"],
    ["METHOD_NOT_ALLOWED", "METHOD_NOT_ALLOWED"], ["BILL_VOID", "BILL_VOID"], ["CLIENT_REF_CONFLICT", "CLIENT_REF_CONFLICT"],
  ])("maps %s", async (message, code) => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message, details: "26018" } });
    const r = await run(recordPayment, [...base, ["method", "edc_card"], ["amount", "1000"]]);
    expect(r).toMatchObject({ ok: false, code });
    expect(updateTag).not.toHaveBeenCalled();
  });
});

describe("recordRefund / voidBillSet", () => {
  it("refund needs payments.refund and sends the reason, amount and client ref", async () => {
    rpc.mockResolvedValue({ data: { paymentStatus: "partially_refunded", replayed: false }, error: null });
    const r = await run(recordRefund, [["paymentId", PAY], ["amount", "10000"], ["reason", "Wrong order"], ["clientRef", REF]]);
    expect(r).toEqual({ ok: true, data: { paymentStatus: "partially_refunded" } });
    expect(rpc).toHaveBeenCalledWith("record_refund", { payment_id: PAY, amount: 10000, reason: "Wrong order", client_ref: REF });
    expect(capture).toHaveBeenCalledWith("refund_recorded", { distinctId: "user-self", organizationId: ORG });
  });
  it("a cashier (no payments.refund) cannot refund", async () => {
    permissions = ["payments.take", "payments.view", "bills.print"];
    requirePermission.mockRejectedValue(new Forbidden("403"));
    await expect(run(recordRefund, [["paymentId", PAY], ["amount", "1"], ["reason", "Wrong order"], ["clientRef", REF]])).rejects.toBeInstanceOf(Forbidden);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("a refund needs a reason of 3+ characters", async () => {
    expect(await run(recordRefund, [["paymentId", PAY], ["amount", "1000"], ["reason", "x"], ["clientRef", REF]])).toMatchObject({ ok: false, fieldErrors: { reason: [expect.any(String)] } });
  });
  it("REFUND_EXCEEDS_PAID maps to its code", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "REFUND_EXCEEDS_PAID" } });
    expect(await run(recordRefund, [["paymentId", PAY], ["amount", "99999"], ["reason", "Too much"], ["clientRef", REF]])).toMatchObject({ ok: false, code: "REFUND_EXCEEDS_PAID" });
  });
  it("voiding needs a reason; BILL_HAS_PAYMENTS tells the manager to refund first", async () => {
    expect(await run(voidBillSet, [["billSetId", SET], ["reason", "x"]])).toMatchObject({ ok: false, fieldErrors: { reason: [expect.any(String)] } });
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "BILL_HAS_PAYMENTS" } });
    expect(await run(voidBillSet, [["billSetId", SET], ["reason", "customer left"]])).toMatchObject({ ok: false, code: "BILL_HAS_PAYMENTS", formError: expect.stringContaining("refund") });
  });
  it("a bill set of another location never reaches the RPC", async () => {
    found = null;
    expect(await run(voidBillSet, [["billSetId", SET], ["reason", "customer left"]])).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("cash sessions and printing", () => {
  it("open: the location comes from the server; a 0 float is allowed", async () => {
    rpc.mockResolvedValue({ data: { sessionId: SESSION }, error: null });
    expect(await run(openCashSession, [["openingFloat", "0"]])).toEqual({ ok: true, data: { sessionId: SESSION } });
    expect(rpc).toHaveBeenCalledWith("open_cash_session", { location_id: LOC, opening_float: 0 });
    expect(await run(openCashSession, [["openingFloat", "-1"]])).toMatchObject({ ok: false });
    expect(capture).toHaveBeenCalledWith("cash_session_opened", { distinctId: "user-self", organizationId: ORG });
  });
  it("SESSION_ALREADY_OPEN maps", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "SESSION_ALREADY_OPEN" } });
    expect(await run(openCashSession, [["openingFloat", "100"]])).toMatchObject({ ok: false, code: "SESSION_ALREADY_OPEN" });
  });
  it("close: sends the counted cash and the note; returns the variance", async () => {
    rpc.mockResolvedValue({ data: { expectedCash: 525000, variance: -1000, replayed: false }, error: null });
    expect(await run(closeCashSession, [["sessionId", SESSION], ["countedCash", "524000"], ["note", "short 1k"]])).toEqual({ ok: true, data: { expectedCash: 525000, variance: -1000 } });
    expect(rpc).toHaveBeenCalledWith("close_cash_session", { session_id: SESSION, counted_cash: 524000, note: "short 1k" });
  });
  it("close: a variance without a note comes back as a field error on note", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "INVALID_INPUT", details: "note" } });
    expect(await run(closeCashSession, [["sessionId", SESSION], ["countedCash", "524000"]])).toMatchObject({ ok: false, code: "INVALID_INPUT", fieldErrors: { note: [expect.any(String)] } });
  });
  it("print: needs bills.print; returns the print count and the duplicate flag", async () => {
    rpc.mockResolvedValue({ data: { printCount: 2, duplicate: true }, error: null });
    expect(await run(recordBillPrint, [["billId", BILL]])).toEqual({ ok: true, data: { printCount: 2, duplicate: true } });
    expect(rpc).toHaveBeenCalledWith("record_bill_print", { bill_id: BILL });
    permissions = ["orders.view"];
    requirePermission.mockRejectedValue(new Forbidden("403"));
    await expect(run(recordBillPrint, [["billId", BILL]])).rejects.toBeInstanceOf(Forbidden);
  });
});

describe("mapBillError", () => {
  it("never echoes SQL text, ids or unknown messages", () => {
    const r = mapBillError({ message: `insert into x values ('${SET}') failed`, code: "XX000" });
    expect(r).toMatchObject({ ok: false, formError: "Something went wrong. Please try again." });
    expect(JSON.stringify(r)).not.toContain(SET);
  });
  it("42501 and RLS errors are FORBIDDEN", () => {
    expect(mapBillError({ code: "42501", message: "x" })).toMatchObject({ code: "FORBIDDEN" });
    expect(mapBillError({ message: "new row violates row-level security policy" })).toMatchObject({ code: "FORBIDDEN" });
  });
});
