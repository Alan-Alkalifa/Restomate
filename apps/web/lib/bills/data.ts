import "server-only";
import { z } from "zod";
import { requireOrgContext, requirePermission } from "@/lib/auth/dal";
import type { PermissionKey } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { assertLocation } from "./shared";

/*
 * Bill data (docs/contracts/bills.md). Each function authorizes itself (requireOrgContext + a permission), takes the
 * org slug and a location id (never an org id), selects explicit columns, and must be called inside <Suspense>.
 * Payment fields only ever reach callers with payments.view: a bills.print-only user (a waiter) gets the pre-bill
 * (lines and totals) and nothing about payments, refunds or sessions.
 */
export type PaymentStatus = "unpaid" | "partially_paid" | "paid" | "partially_refunded" | "refunded";
export type PaymentMethod = "cash" | "edc_card" | "other" | "doku";
export type SplitKind = "none" | "equal" | "by_item";

export type BillLine = {
  id: string; billId: string | null; name: string; variantName: string | null; modifiersText: string | null;
  quantity: number; unitPrice: number; modifiersTotal: number; lineTotal: number;
};
export type BillTotals = { subtotal: number; discount: number; serviceCharge: number; tax: number; total: number };
export type BillSummary = BillTotals & {
  id: string; billNumber: number; shareNo: number; shareCount: number; printCount: number;
  /** Only for callers with payments.view; null for a bills.print-only user. */
  balance: { paidTotal: number; refundedTotal: number; outstanding: number; paymentStatus: PaymentStatus } | null;
};
export type BillSetDetail = {
  id: string; orderId: string; splitKind: SplitKind; currency: string; serviceChargeBps: number; taxRateBps: number;
  taxOnServiceCharge: boolean; totals: BillTotals; createdAt: string; bills: BillSummary[]; lines: BillLine[];
};
export type PaymentRow = {
  id: string; method: PaymentMethod; amount: number; tendered: number | null; changeGiven: number | null;
  methodLabel: string | null; approvalCode: string | null; createdAt: string; refundedTotal: number;
};
export type RefundRow = { id: string; paymentId: string; amount: number; reason: string; createdAt: string };
export type BillDetail = BillSummary & {
  billSetId: string; orderId: string; currency: string; lines: BillLine[]; payments: PaymentRow[]; refunds: RefundRow[];
};
export type CashSession = {
  id: string; status: "open" | "closed"; openingFloat: number; openedAt: string; closedAt: string | null;
  expectedCash: number | null; countedCash: number | null; variance: number | null; closeNote: string | null;
};
export type CashSessionSummary = CashSession & {
  /** Expected cash so far: float + cash payments - cash refunds (change is not counted). */
  expectedSoFar: number; cashPayments: number; cashRefunds: number; paymentCounts: Partial<Record<PaymentMethod, number>>;
};
export type PrebillDetail = Omit<BillSetDetail, "bills"> & { bills: (BillTotals & { id: string; billNumber: number; shareNo: number; shareCount: number; printCount: number })[] };

export type BillPrintData = {
  bill: { id: string; billNumber: number; shareNo: number; shareCount: number; createdAt: string; businessDate: string };
  location: { name: string; address: string | null; city: string | null; phone: string | null; taxId: string | null; timezone: string; currency: string };
  order: { orderNumber: number; channel: string; tableLabel: string | null; guestCount: number | null };
  lines: { name: string; variantName: string | null; modifiersText: string | null; quantity: number; unitPrice: number; lineTotal: number }[];
  totals: { subtotal: number; discount: number; serviceCharge: number; serviceChargeBps: number; tax: number; taxRateBps: number; total: number };
  payments: { method: string; methodLabel: string | null; amount: number; tendered: number | null; changeGiven: number | null; at: string }[];
  /** null unless the caller holds payments.view */
  paymentStatus: string | null;
  /** Value BEFORE this print; the print route calls record_bill_print and renders "DUPLICATE" when `duplicate`. */
  printCount: number;
  duplicate: boolean;
};

const uuid = z.string().uuid();

/**
 * The table label printed on a bill. A party that used several tables (a table group) prints the primary table and
 * every table it ever held, sorted by label, e.g. "T4 + T5". Released group rows count too, so a bill reprinted after
 * the order closed (which releases the group) still shows the whole party. Null for takeaway.
 */
export function joinTableLabels(labels: string[]): string | null {
  const unique = [...new Set(labels)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return unique.length ? unique.join(" + ") : null;
}
async function groupTableLabel(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string, orderId: string, primaryId: string | null) {
  if (!primaryId) return null;
  const { data: rows } = await supabase.from("order_tables").select("table_id").eq("organization_id", orgId).eq("order_id", orderId);
  const ids = [...new Set([primaryId, ...(rows ?? []).map((r) => r.table_id)])];
  const { data: tables } = await supabase.from("tables").select("label").eq("organization_id", orgId).in("id", ids);
  return joinTableLabels((tables ?? []).map((t) => t.label));
}

async function setup(orgSlug: string, locationId: string, anyOf: PermissionKey[]) {
  const ctx = await requireOrgContext(orgSlug);
  assertLocation(ctx, locationId);
  if (!anyOf.some((p) => ctx.permissions.includes(p))) await requirePermission(ctx.org.id, anyOf[0]!);
  return { ctx, supabase: await createClient(), canSeePayments: ctx.permissions.includes("payments.view") };
}
type Supabase = Awaited<ReturnType<typeof createClient>>;

const LINE_COLS = "id, bill_id, item_name, variant_name, modifiers_text, quantity, unit_price, modifiers_total, line_total, created_at";
const BILL_COLS = "id, bill_set_id, order_id, bill_number, business_date, share_no, share_count, subtotal, discount, service_charge, tax, total, print_count, created_at";
const SET_COLS = "id, order_id, split_kind, currency, service_charge_bps, tax_rate_bps, tax_on_service_charge, subtotal, discount_total, service_charge, tax, total, created_at";

type LineRow = {
  id: string; bill_id: string | null; item_name: string; variant_name: string | null; modifiers_text: string | null;
  quantity: number; unit_price: number; modifiers_total: number; line_total: number;
};
const toLine = (l: LineRow): BillLine => ({
  id: l.id, billId: l.bill_id, name: l.item_name, variantName: l.variant_name, modifiersText: l.modifiers_text,
  quantity: l.quantity, unitPrice: l.unit_price, modifiersTotal: l.modifiers_total, lineTotal: l.line_total,
});
type BillRow = {
  id: string; bill_number: number; share_no: number; share_count: number; subtotal: number; discount: number;
  service_charge: number; tax: number; total: number; print_count: number;
};
const totalsOf = (b: BillRow): BillTotals => ({ subtotal: b.subtotal, discount: b.discount, serviceCharge: b.service_charge, tax: b.tax, total: b.total });

async function balances(supabase: Supabase, orgId: string, billIds: string[]) {
  if (!billIds.length) return new Map<string, NonNullable<BillSummary["balance"]>>();
  const { data } = await supabase.from("bill_balances").select("bill_id, paid_total, refunded_total, outstanding, payment_status")
    .eq("organization_id", orgId).in("bill_id", billIds);
  return new Map((data ?? []).map((r) => [r.bill_id as string, {
    paidTotal: r.paid_total as number, refundedTotal: r.refunded_total as number, outstanding: r.outstanding as number,
    paymentStatus: r.payment_status as PaymentStatus,
  }]));
}

async function loadSet(supabase: Supabase, orgId: string, locationId: string, orderId: string) {
  const { data: set } = await supabase.from("bill_sets").select(SET_COLS).eq("organization_id", orgId).eq("location_id", locationId)
    .eq("order_id", orderId).eq("status", "active").maybeSingle();
  if (!set) return null;
  const [bills, lines] = await Promise.all([
    supabase.from("bills").select(BILL_COLS).eq("organization_id", orgId).eq("bill_set_id", set.id).order("share_no"),
    supabase.from("bill_items").select(LINE_COLS).eq("organization_id", orgId).eq("bill_set_id", set.id).order("created_at"),
  ]);
  return { set, bills: (bills.data ?? []) as BillRow[], lines: (lines.data ?? []) as LineRow[] };
}

const setHead = (set: NonNullable<Awaited<ReturnType<typeof loadSet>>>["set"]) => ({
  id: set.id, orderId: set.order_id, splitKind: set.split_kind as SplitKind, currency: set.currency.trim(),
  serviceChargeBps: set.service_charge_bps, taxRateBps: set.tax_rate_bps, taxOnServiceCharge: set.tax_on_service_charge,
  totals: { subtotal: set.subtotal, discount: set.discount_total, serviceCharge: set.service_charge, tax: set.tax, total: set.total },
  createdAt: set.created_at,
});

/** The active bill set of an order with each bill's balance and status. Needs payments.view. */
export async function getBillsForOrder(orgSlug: string, locationId: string, orderId: string): Promise<BillSetDetail | null> {
  const { ctx, supabase } = await setup(orgSlug, locationId, ["payments.view"]);
  if (!uuid.safeParse(orderId).success) return null;
  const loaded = await loadSet(supabase, ctx.org.id, locationId, orderId);
  if (!loaded) return null;
  const bal = await balances(supabase, ctx.org.id, loaded.bills.map((b) => b.id));
  return {
    ...setHead(loaded.set),
    bills: loaded.bills.map((b) => ({ id: b.id, billNumber: b.bill_number, shareNo: b.share_no, shareCount: b.share_count, printCount: b.print_count, ...totalsOf(b), balance: bal.get(b.id) ?? null })),
    lines: loaded.lines.map(toLine),
  };
}

/** The pre-bill: lines and totals only, no payment fields at all. Needs bills.print (or payments.view). */
export async function getPrebill(orgSlug: string, locationId: string, orderId: string): Promise<PrebillDetail | null> {
  const { ctx, supabase } = await setup(orgSlug, locationId, ["bills.print", "payments.view"]);
  if (!uuid.safeParse(orderId).success) return null;
  const loaded = await loadSet(supabase, ctx.org.id, locationId, orderId);
  if (!loaded) return null;
  return {
    ...setHead(loaded.set),
    bills: loaded.bills.map((b) => ({ id: b.id, billNumber: b.bill_number, shareNo: b.share_no, shareCount: b.share_count, printCount: b.print_count, ...totalsOf(b) })),
    lines: loaded.lines.map(toLine),
  };
}

/** One bill with its lines, payments, refunds and balance. Needs payments.view. */
export async function getBill(orgSlug: string, locationId: string, billId: string): Promise<BillDetail | null> {
  const { ctx, supabase } = await setup(orgSlug, locationId, ["payments.view"]);
  if (!uuid.safeParse(billId).success) return null;
  const { data: b } = await supabase.from("bills").select(BILL_COLS).eq("organization_id", ctx.org.id).eq("location_id", locationId).eq("id", billId).maybeSingle();
  if (!b) return null;
  const { data: set } = await supabase.from("bill_sets").select("id, currency").eq("organization_id", ctx.org.id).eq("id", b.bill_set_id).maybeSingle();
  const [lines, payments, refunds, bal] = await Promise.all([
    supabase.from("bill_items").select(LINE_COLS).eq("organization_id", ctx.org.id).eq("bill_set_id", b.bill_set_id).order("created_at"),
    supabase.from("payments").select("id, method, amount, tendered, change_given, method_label, approval_code, created_at").eq("organization_id", ctx.org.id).eq("bill_id", billId).order("created_at"),
    supabase.from("refunds").select("id, payment_id, amount, reason, created_at").eq("organization_id", ctx.org.id).eq("bill_id", billId).order("created_at"),
    balances(supabase, ctx.org.id, [billId]),
  ]);
  const refundedBy = new Map<string, number>();
  for (const r of refunds.data ?? []) refundedBy.set(r.payment_id, (refundedBy.get(r.payment_id) ?? 0) + r.amount);
  return {
    id: b.id, billNumber: b.bill_number, shareNo: b.share_no, shareCount: b.share_count, printCount: b.print_count, ...totalsOf(b as BillRow),
    balance: bal.get(billId) ?? null, billSetId: b.bill_set_id, orderId: b.order_id, currency: (set?.currency ?? "IDR").trim(),
    // an equal split shares every line; otherwise only this bill's own lines
    lines: ((lines.data ?? []) as LineRow[]).filter((l) => l.bill_id === null || l.bill_id === billId).map(toLine),
    payments: (payments.data ?? []).map((p) => ({
      id: p.id, method: p.method as PaymentMethod, amount: p.amount, tendered: p.tendered, changeGiven: p.change_given,
      methodLabel: p.method_label, approvalCode: p.approval_code, createdAt: p.created_at, refundedTotal: refundedBy.get(p.id) ?? 0,
    })),
    refunds: (refunds.data ?? []).map((r) => ({ id: r.id, paymentId: r.payment_id, amount: r.amount, reason: r.reason, createdAt: r.created_at })),
  };
}

/**
 * Everything a print route needs. The payments block and status are included only for callers with payments.view,
 * so a waiter's pre-bill never leaks payment data. `printCount` is the count BEFORE this print; call
 * `recordBillPrint` and render the DUPLICATE mark from its result. Needs bills.print (or payments.view).
 */
export async function getBillPrintData(orgSlug: string, locationId: string, billId: string): Promise<BillPrintData | null> {
  const { ctx, supabase, canSeePayments } = await setup(orgSlug, locationId, ["bills.print", "payments.view"]);
  if (!uuid.safeParse(billId).success) return null;
  const { data: b } = await supabase.from("bills").select(BILL_COLS).eq("organization_id", ctx.org.id).eq("location_id", locationId).eq("id", billId).maybeSingle();
  if (!b) return null;
  const [set, loc, order, lines] = await Promise.all([
    supabase.from("bill_sets").select("service_charge_bps, tax_rate_bps").eq("organization_id", ctx.org.id).eq("id", b.bill_set_id).maybeSingle(),
    supabase.from("locations").select("name, address, city, phone, timezone, currency").eq("organization_id", ctx.org.id).eq("id", locationId).maybeSingle(),
    supabase.from("orders").select("order_number, channel, table_id, guest_count").eq("organization_id", ctx.org.id).eq("id", b.order_id).maybeSingle(),
    supabase.from("bill_items").select(LINE_COLS).eq("organization_id", ctx.org.id).eq("bill_set_id", b.bill_set_id).order("created_at"),
  ]);
  const tableLabel = await groupTableLabel(supabase, ctx.org.id, b.order_id, order.data?.table_id ?? null);
  let payments: BillPrintData["payments"] = [];
  let paymentStatus: string | null = null;
  if (canSeePayments) {
    const [pay, bal] = await Promise.all([
      supabase.from("payments").select("method, method_label, amount, tendered, change_given, created_at").eq("organization_id", ctx.org.id).eq("bill_id", billId).order("created_at"),
      balances(supabase, ctx.org.id, [billId]),
    ]);
    payments = (pay.data ?? []).map((p) => ({ method: p.method, methodLabel: p.method_label, amount: p.amount, tendered: p.tendered, changeGiven: p.change_given, at: p.created_at }));
    paymentStatus = bal.get(billId)?.paymentStatus ?? null;
  }
  const own = ((lines.data ?? []) as LineRow[]).filter((l) => l.bill_id === null || l.bill_id === billId);
  return {
    bill: { id: b.id, billNumber: b.bill_number, shareNo: b.share_no, shareCount: b.share_count, createdAt: b.created_at, businessDate: b.business_date },
    location: {
      name: loc.data?.name ?? "", address: loc.data?.address ?? null, city: loc.data?.city ?? null, phone: loc.data?.phone ?? null,
      taxId: null, // locations.tax_id (NPWP) is the follow-up migration; null until it ships
      timezone: loc.data?.timezone ?? "Asia/Jakarta", currency: (loc.data?.currency ?? "IDR").trim(),
    },
    order: { orderNumber: order.data?.order_number ?? 0, channel: order.data?.channel ?? "dine_in", tableLabel, guestCount: order.data?.guest_count ?? null },
    lines: own.map((l) => ({ name: l.item_name, variantName: l.variant_name, modifiersText: l.modifiers_text, quantity: l.quantity, unitPrice: l.unit_price, lineTotal: l.line_total })),
    totals: {
      subtotal: b.subtotal, discount: b.discount, serviceCharge: b.service_charge, serviceChargeBps: set.data?.service_charge_bps ?? 0,
      tax: b.tax, taxRateBps: set.data?.tax_rate_bps ?? 0, total: b.total,
    },
    payments, paymentStatus, printCount: b.print_count, duplicate: b.print_count >= 1,
  };
}

const SESSION_COLS = "id, status, opening_float, opened_at, closed_at, expected_cash, counted_cash, variance, close_note";
type SessionRow = {
  id: string; status: string; opening_float: number; opened_at: string; closed_at: string | null;
  expected_cash: number | null; counted_cash: number | null; variance: number | null; close_note: string | null;
};
const toSession = (s: SessionRow): CashSession => ({
  id: s.id, status: s.status === "closed" ? "closed" : "open", openingFloat: s.opening_float, openedAt: s.opened_at, closedAt: s.closed_at,
  expectedCash: s.expected_cash, countedCash: s.counted_cash, variance: s.variance, closeNote: s.close_note,
});

/** The open cash session at a location, if any. Needs payments.view. */
export async function getOpenCashSession(orgSlug: string, locationId: string): Promise<CashSession | null> {
  const { ctx, supabase } = await setup(orgSlug, locationId, ["payments.view"]);
  const { data } = await supabase.from("cash_sessions").select(SESSION_COLS).eq("organization_id", ctx.org.id).eq("location_id", locationId).eq("status", "open").maybeSingle();
  return data ? toSession(data as SessionRow) : null;
}

/** A session with its running expected cash and payment counts by method. Needs payments.view. */
export async function getCashSessionSummary(orgSlug: string, locationId: string, sessionId: string): Promise<CashSessionSummary | null> {
  const { ctx, supabase } = await setup(orgSlug, locationId, ["payments.view"]);
  if (!uuid.safeParse(sessionId).success) return null;
  const { data: s } = await supabase.from("cash_sessions").select(SESSION_COLS).eq("organization_id", ctx.org.id).eq("location_id", locationId).eq("id", sessionId).maybeSingle();
  if (!s) return null;
  const [pay, ref] = await Promise.all([
    supabase.from("payments").select("method, amount").eq("organization_id", ctx.org.id).eq("cash_session_id", sessionId),
    supabase.from("refunds").select("amount").eq("organization_id", ctx.org.id).eq("cash_session_id", sessionId),
  ]);
  const counts: Partial<Record<PaymentMethod, number>> = {};
  let cashPayments = 0;
  for (const p of pay.data ?? []) {
    counts[p.method as PaymentMethod] = (counts[p.method as PaymentMethod] ?? 0) + 1;
    if (p.method === "cash") cashPayments += p.amount;
  }
  const cashRefunds = (ref.data ?? []).reduce((n, r) => n + r.amount, 0);
  const session = toSession(s as SessionRow);
  return { ...session, cashPayments, cashRefunds, expectedSoFar: session.openingFloat + cashPayments - cashRefunds, paymentCounts: counts };
}
