import "server-only";

import { allocate, calculateBill } from "@/lib/money";
import type { BillLine, BillRow, BillableOrder, CashSession, PaymentMethod, PaymentRow, PaymentStatus, SplitKind } from "@/components/bills/bills-model";

/*
 * TEMPORARY SEAM until #134 (MSC-T07, lib/bills) merges. Delete this folder's _store.ts, _data.ts and _actions.ts and
 * import the real `lib/bills` data and actions in the pages (docs/contracts/bills.md, "What ADIT consumes").
 *
 * An in-memory domain (one dev server process) that follows the contract's rules and math (calculateBill / allocate
 * from lib/money; service charge then tax; equal split allocates every component; payments capped at outstanding; gross
 * payments; cash needs an open session; refunds never re-open a bill) so the screens can be built and driven. It is
 * NOT a database: nothing here is a source of truth, and every real check also exists in the RPCs.
 */
export const SERVICE_BPS = 500;
export const TAX_BPS = 1000;
let seq = 0;
export const uid = (): string => `00000000-0000-4000-8000-${(++seq).toString(16).padStart(12, "0")}`;

export const orderIdFor = (locationId: string): string => `0b0b0b0b-${locationId.slice(9, 13)}-4000-8000-${locationId.slice(24)}`;

/** One billable fixture order per location, so the screens have something to bill. */
export function fixtureOrder(locationId: string): BillableOrder {
  return {
    orderId: orderIdFor(locationId), orderNumber: 41, status: "served", tableLabel: "T4 + T5", currency: "IDR",
    lines: [
      { id: "fx-1", name: "Nasi Goreng", variantName: "Large", modifiersText: "Extra spicy", quantity: 2, lineTotal: 76000 },
      { id: "fx-2", name: "Sate Ayam", variantName: null, modifiersText: null, quantity: 1, lineTotal: 32000 },
      { id: "fx-3", name: "Es Teh", variantName: null, modifiersText: "Less sugar", quantity: 3, lineTotal: 24000 },
      { id: "fx-4", name: "Kopi Susu", variantName: "Iced", quantity: 1, modifiersText: null, lineTotal: 22000 },
    ],
  };
}

type Pay = PaymentRow & { sessionId: string | null; hash: string };
type Refund = { id: string; paymentId: string; billId: string; amount: number; reason: string; sessionId: string | null };
export type SetState = {
  id: string; orderId: string; splitKind: SplitKind; status: "active" | "void"; request: string; clientRef: string;
  lines: BillLine[]; bills: (Omit<BillRow, "paidTotal" | "refundedTotal" | "outstanding" | "paymentStatus">)[];
  voidReason: string | null;
};
export type Session = CashSession & { locationId: string; status: "open" | "closed"; expected: number | null; counted: number | null; variance: number | null; note: string | null };

export const sets = new Map<string, SetState>(); // orderId -> latest set
export const payments = new Map<string, Pay>();
export const refunds: Refund[] = [];
export const sessions = new Map<string, Session>();
export const replays = new Map<string, { hash: string; result: unknown }>(); // clientRef -> stored result
let billNumber = 100;

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function paidOf(billId: string): number {
  return sum([...payments.values()].filter((p) => p.billId === billId).map((p) => p.amount));
}
export function refundedOf(billId: string): number {
  return sum(refunds.filter((r) => r.billId === billId).map((r) => r.amount));
}
export function statusOf(total: number, paid: number, refunded: number): PaymentStatus {
  if (refunded > 0 && refunded === paid) return "refunded";
  if (refunded > 0) return "partially_refunded";
  if (paid === 0 && total > 0) return "unpaid";
  return paid >= total ? "paid" : "partially_paid";
}
export function balanceRow(b: SetState["bills"][number], withPayments: boolean): BillRow {
  const paid = paidOf(b.id);
  const refunded = refundedOf(b.id);
  return withPayments
    ? { ...b, paidTotal: paid, refundedTotal: refunded, outstanding: Math.max(b.total - paid, 0), paymentStatus: statusOf(b.total, paid, refunded) }
    : { ...b, paidTotal: 0, refundedTotal: 0, outstanding: 0, paymentStatus: null }; // a pre-bill never shows payment data
}
export const paymentRows = (billIds: string[]): PaymentRow[] =>
  [...payments.values()].filter((p) => billIds.includes(p.billId)).map((p): PaymentRow => ({
    id: p.id, billId: p.billId, method: p.method, methodLabel: p.methodLabel, amount: p.amount, tendered: p.tendered, changeGiven: p.changeGiven,
    approvalCode: p.approvalCode, createdAt: p.createdAt, refunded: sum(refunds.filter((r) => r.paymentId === p.id).map((r) => r.amount)),
  }));

/** create_bills: the set locks the order; totals are computed once, here, from the order's own lines. */
export function buildSet(order: BillableOrder, kind: SplitKind, count: number | null, assignments: string[][] | null, clientRef: string, request: string): SetState {
  const lines: BillLine[] = order.lines.map((l) => ({
    id: uid(), orderItemId: l.id, billId: null, name: l.name, variantName: l.variantName, modifiersText: l.modifiersText,
    quantity: l.quantity, unitPrice: l.lineTotal / l.quantity, lineTotal: l.lineTotal,
  }));
  const calc = (subtotal: number) => calculateBill({ subtotal, serviceChargeBps: SERVICE_BPS, taxRateBps: TAX_BPS, taxOnServiceCharge: true });
  const mk = (i: number, n: number, parts: { subtotal: number; discount: number; serviceCharge: number; tax: number }) => ({
    id: uid(), billNumber: ++billNumber, shareNo: i + 1, shareCount: n, ...parts, total: parts.subtotal - parts.discount + parts.serviceCharge + parts.tax, printCount: 0,
  });
  let bills: SetState["bills"];
  if (kind === "none") {
    const c = calc(sum(lines.map((l) => l.lineTotal)));
    bills = [mk(0, 1, { subtotal: c.subtotal, discount: 0, serviceCharge: c.serviceCharge, tax: c.tax })];
    for (const l of lines) l.billId = bills[0].id;
  } else if (kind === "equal") {
    const c = calc(sum(lines.map((l) => l.lineTotal)));
    const n = count as number;
    const [s, sc, t] = [allocate(c.subtotal, n), allocate(c.serviceCharge, n), allocate(c.tax, n)];
    bills = Array.from({ length: n }, (_, i) => mk(i, n, { subtotal: s[i], discount: 0, serviceCharge: sc[i], tax: t[i] }));
  } else {
    const groups = assignments as string[][];
    bills = groups.map((g, i) => {
      const c = calc(sum(lines.filter((l) => g.includes(l.orderItemId)).map((l) => l.lineTotal)));
      return mk(i, groups.length, { subtotal: c.subtotal, discount: 0, serviceCharge: c.serviceCharge, tax: c.tax });
    });
    groups.forEach((g, i) => lines.filter((l) => g.includes(l.orderItemId)).forEach((l) => { l.billId = bills[i].id; }));
  }
  return { id: uid(), orderId: order.orderId, splitKind: kind, status: "active", request, clientRef, lines, bills, voidReason: null };
}

export const openSession = (locationId: string): Session | undefined => [...sessions.values()].find((s) => s.locationId === locationId && s.status === "open");
export function expectedCash(s: Session): number {
  const cash = sum([...payments.values()].filter((p) => p.sessionId === s.id).map((p) => p.amount));
  return s.openingFloat + cash - sum(refunds.filter((r) => r.sessionId === s.id).map((r) => r.amount));
}
export type { PaymentMethod };
