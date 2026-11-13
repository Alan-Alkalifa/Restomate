"use server";

import { createHash } from "node:crypto";
import { forbidden } from "next/navigation";
import { requireOrgContext } from "@/lib/auth/dal";
import { MAX_MONEY_INPUT } from "@/lib/money";
import { canCreateBill, outstandingOf, validateSplit, type BillActionResult, type PaymentOutcome, type SplitKind } from "@/components/bills/bills-model";
import { balanceRow, buildSet, expectedCash, fixtureOrder, openSession, paidOf, payments, refunds, refundedOf, replays, sessions, sets, uid } from "./_store";

/*
 * TEMPORARY SEAM until #134 (MSC-T07, lib/bills). Same action names and FormData fields as docs/contracts/bills.md;
 * orgSlug and locationId are bound by the page, FormData never carries an organization id. Every action checks the
 * permission FIRST (requirePermission -> forbidden()), then the location, then validates, like the real ones.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (code: string, formError: string): BillActionResult<never> => ({ ok: false, code, formError });
const INVALID = fail("INVALID_INPUT", "That request was not valid.");
const NOT_FOUND = fail("FORBIDDEN", "That could not be found in this location.");
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const int = (fd: FormData, k: string): number | null => {
  const v = str(fd, k);
  if (!/^\d{1,13}$/.test(v)) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) && n <= MAX_MONEY_INPUT ? n : null;
};
const hash = (o: unknown) => createHash("sha256").update(JSON.stringify(o)).digest("hex");

async function authorize(orgSlug: string, locationId: string, perms: string[]) {
  const ctx = await requireOrgContext(orgSlug);
  if (!perms.some((p) => (ctx.permissions as string[]).includes(p))) forbidden(); // the permission check comes first, before anything is read
  return ctx.locations.some((l) => l.id === locationId) ? ctx : null;
}
const findBill = (locationId: string, billId: string) => {
  const order = fixtureOrder(locationId);
  const set = sets.get(order.orderId);
  const bill = set?.bills.find((b) => b.id === billId);
  return set && bill ? { order, set, bill } : null;
};

export async function createBills(orgSlug: string, locationId: string, _p: unknown, fd: FormData): Promise<BillActionResult<{ billSetId: string; replayed: boolean }>> {
  const ctx = await authorize(orgSlug, locationId, ["payments.take", "bills.print"]);
  if (!ctx) return NOT_FOUND;
  const order = fixtureOrder(locationId);
  const kind = str(fd, "splitKind") as SplitKind;
  const clientRef = str(fd, "clientRef");
  if (str(fd, "orderId") !== order.orderId || !UUID.test(clientRef) || !["none", "equal", "by_item"].includes(kind)) return INVALID;
  let count: number | null = null;
  let assignments: string[][] | null = null;
  try {
    count = fd.get("splitCount") ? Number(str(fd, "splitCount")) : null;
    assignments = fd.get("assignments") ? (JSON.parse(str(fd, "assignments")) as string[][]) : null;
  } catch { return INVALID; }
  if (assignments && !(Array.isArray(assignments) && assignments.every((g) => Array.isArray(g) && g.every((x) => typeof x === "string")))) return INVALID;
  if (!canCreateBill(order.status)) return fail("ORDER_NOT_BILLABLE", "This order cannot be billed yet.");
  if (validateSplit(kind, count, assignments, order.lines.map((l) => l.id))) return fail("INVALID_SPLIT", "That split is not valid.");
  const request = hash({ kind, count, assignments });
  const existing = sets.get(order.orderId);
  if (existing?.status === "active") {
    return existing.clientRef === clientRef && existing.request === request
      ? { ok: true, data: { billSetId: existing.id, replayed: true } }
      : fail("BILL_EXISTS", "This order already has a bill.");
  }
  const set = buildSet(order, kind, count, assignments, clientRef, request);
  sets.set(order.orderId, set);
  return { ok: true, data: { billSetId: set.id, replayed: false } };
}

export async function recordPayment(orgSlug: string, locationId: string, _p: unknown, fd: FormData): Promise<BillActionResult<PaymentOutcome>> {
  const ctx = await authorize(orgSlug, locationId, ["payments.take"]);
  if (!ctx) return NOT_FOUND;
  const billId = str(fd, "billId");
  const method = str(fd, "method");
  const clientRef = str(fd, "clientRef");
  const amount = int(fd, "amount");
  const tendered = fd.get("tendered") ? int(fd, "tendered") : null;
  const label = str(fd, "methodLabel") || null;
  const approval = str(fd, "approvalCode") || null;
  if (!UUID.test(billId) || !UUID.test(clientRef) || amount === null || amount <= 0) return INVALID;
  if (method !== "cash" && method !== "edc_card" && method !== "other") return fail("METHOD_NOT_ALLOWED", "That payment method is not allowed.");
  const h = hash([billId, method, amount, tendered, label, approval]);
  const seen = replays.get(clientRef);
  if (seen) return seen.hash === h ? (seen.result as BillActionResult<PaymentOutcome>) : fail("CLIENT_REF_CONFLICT", "That request was already used for a different payment.");
  const found = findBill(locationId, billId);
  if (!found) return NOT_FOUND;
  if (found.set.status !== "active") return fail("BILL_VOID", "This bill was voided.");
  const bill = balanceRow(found.bill, true);
  if (amount > outstandingOf(bill)) return fail("PAYMENT_EXCEEDS_OUTSTANDING", "That is more than is owed.");
  let sessionId: string | null = null;
  if (method === "cash") {
    if (tendered === null || tendered < amount) return fail("TENDERED_TOO_LOW", "The cash received is less than the amount.");
    sessionId = openSession(locationId)?.id ?? null;
    if (!sessionId) return fail("NO_OPEN_SESSION", "Open a cash session first.");
  }
  if (method === "other" && (!label || label.length < 2 || label.length > 40)) return INVALID;
  if (method === "edc_card" && approval && !/^[A-Za-z0-9]{4,12}$/.test(approval)) return INVALID;
  const id = uid();
  payments.set(id, {
    id, billId, method, methodLabel: method === "other" ? label : null, amount, tendered: method === "cash" ? tendered : null,
    changeGiven: method === "cash" ? (tendered as number) - amount : null, approvalCode: method === "edc_card" ? approval : null,
    refunded: 0, createdAt: new Date().toISOString(), sessionId, hash: h,
  });
  const after = balanceRow(found.bill, true);
  const allPaid = found.set.bills.every((b) => balanceRow(b, true).paymentStatus === "paid");
  const result: BillActionResult<PaymentOutcome> = {
    ok: true,
    data: { paymentId: id, paymentStatus: after.paymentStatus ?? "unpaid", outstanding: after.outstanding, changeGiven: method === "cash" ? (tendered as number) - amount : null, orderCompleted: allPaid && found.order.status === "served" },
  };
  replays.set(clientRef, { hash: h, result });
  return result;
}

export async function recordRefund(orgSlug: string, locationId: string, _p: unknown, fd: FormData): Promise<BillActionResult<{ refundId: string }>> {
  const ctx = await authorize(orgSlug, locationId, ["payments.refund"]);
  if (!ctx) return NOT_FOUND;
  const paymentId = str(fd, "paymentId");
  const amount = int(fd, "amount");
  const reason = str(fd, "reason");
  const clientRef = str(fd, "clientRef");
  if (!UUID.test(clientRef) || amount === null || amount <= 0 || reason.length < 3 || reason.length > 200) return INVALID;
  const h = hash([paymentId, amount, reason]);
  const seen = replays.get(clientRef);
  if (seen) return seen.hash === h ? (seen.result as BillActionResult<{ refundId: string }>) : fail("CLIENT_REF_CONFLICT", "That request was already used for a different refund.");
  const pay = payments.get(paymentId);
  if (!pay || !findBill(locationId, pay.billId)) return NOT_FOUND;
  const left = pay.amount - refunds.filter((r) => r.paymentId === pay.id).reduce((a, r) => a + r.amount, 0);
  if (amount > left) return fail("REFUND_EXCEEDS_PAID", "That is more than can be refunded on this payment.");
  let sessionId: string | null = null;
  if (pay.method === "cash") {
    sessionId = openSession(locationId)?.id ?? null;
    if (!sessionId) return fail("NO_OPEN_SESSION", "Open a cash session first.");
  }
  const id = uid();
  refunds.push({ id, paymentId: pay.id, billId: pay.billId, amount, reason, sessionId });
  const result: BillActionResult<{ refundId: string }> = { ok: true, data: { refundId: id } };
  replays.set(clientRef, { hash: h, result });
  return result;
}

export async function voidBillSet(orgSlug: string, locationId: string, _p: unknown, fd: FormData): Promise<BillActionResult> {
  const ctx = await authorize(orgSlug, locationId, ["payments.take"]);
  if (!ctx) return NOT_FOUND;
  const order = fixtureOrder(locationId);
  const set = sets.get(order.orderId);
  const reason = str(fd, "reason");
  if (!set || set.id !== str(fd, "billSetId")) return NOT_FOUND;
  if (reason.length < 3 || reason.length > 200) return INVALID;
  if (set.status !== "active") return fail("BILL_VOID", "This bill was already voided.");
  const history = set.bills.some((b) => paidOf(b.id) > 0);
  if (history && !(ctx.permissions as string[]).includes("payments.refund")) forbidden(); // a set with payment history needs the refund permission
  if (set.bills.some((b) => paidOf(b.id) - refundedOf(b.id) > 0)) return fail("BILL_HAS_PAYMENTS", "This bill has payments. Refund them first.");
  set.status = "void";
  set.voidReason = reason;
  sets.delete(order.orderId);
  return { ok: true, data: null };
}

export async function openCashSession(orgSlug: string, locationId: string, _p: unknown, fd: FormData): Promise<BillActionResult> {
  const ctx = await authorize(orgSlug, locationId, ["payments.take"]);
  if (!ctx) return NOT_FOUND;
  const openingFloat = int(fd, "openingFloat");
  if (openingFloat === null) return INVALID;
  if (openSession(locationId)) return fail("SESSION_ALREADY_OPEN", "A cash session is already open.");
  const id = uid();
  sessions.set(id, { id, locationId, openedAt: new Date().toISOString(), openingFloat, status: "open", expected: null, counted: null, variance: null, note: null });
  return { ok: true, data: null };
}

export async function closeCashSession(orgSlug: string, locationId: string, _p: unknown, fd: FormData): Promise<BillActionResult<{ expected: number; variance: number }>> {
  const ctx = await authorize(orgSlug, locationId, ["payments.take"]);
  if (!ctx) return NOT_FOUND;
  const s = sessions.get(str(fd, "sessionId"));
  const counted = int(fd, "countedCash");
  const note = str(fd, "note");
  if (!s || s.locationId !== locationId) return NOT_FOUND;
  if (counted === null) return INVALID;
  if (s.status !== "open") return fail("SESSION_CLOSED", "This cash session is already closed.");
  const expected = expectedCash(s); // computed here from rows, never trusted from the client
  const variance = counted - expected;
  if (variance !== 0 && note.length < 3) return { ok: false, code: "INVALID_INPUT", formError: "Add a note (at least 3 characters).", fieldErrors: { note: ["Required when the count does not match."] } };
  Object.assign(s, { status: "closed", expected, counted, variance, note: note || null });
  return { ok: true, data: { expected, variance } };
}

export async function recordBillPrint(orgSlug: string, locationId: string, _p: unknown, fd: FormData): Promise<BillActionResult<{ printCount: number; duplicate: boolean }>> {
  const ctx = await authorize(orgSlug, locationId, ["bills.print", "payments.view"]);
  if (!ctx) return NOT_FOUND;
  const found = findBill(locationId, str(fd, "billId"));
  if (!found) return NOT_FOUND;
  const duplicate = found.bill.printCount >= 1;
  found.bill.printCount += 1;
  return { ok: true, data: { printCount: found.bill.printCount, duplicate } };
}
