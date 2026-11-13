import "server-only";

import { requireOrgContext, requirePermission } from "@/lib/auth/dal";
import type { BillPrintData } from "@/components/print/bill/bill-print-model";
import type { BillSetDetail, BillableOrder, CashSession } from "@/components/bills/bills-model";
import { balanceRow, expectedCash, fixtureOrder, openSession, paymentRows, sets, SERVICE_BPS, TAX_BPS } from "./_store";

/*
 * TEMPORARY SEAM until #134 (MSC-T07, lib/bills). Same names and argument order as docs/contracts/bills.md:
 * getBillsForOrder / getPrebill (merged here into getBillSet: payment fields only for payments.view), getBill,
 * getBillPrintData, getOpenCashSession + getCashSessionSummary. Delete with ./_store.ts and ./_actions.ts.
 */
type Ctx = Awaited<ReturnType<typeof requireOrgContext>>;
export const can = (ctx: Ctx, perm: string): boolean => (ctx.permissions as string[]).includes(perm);

/** Access: payments.view, or bills.print (a waiter: pre-bill only). Anyone else is forbidden. */
async function gate(orgSlug: string, locationId: string) {
  const ctx = await requireOrgContext(orgSlug);
  if (!can(ctx, "payments.view") && !can(ctx, "bills.print")) await requirePermission(ctx.org.id, "payments.view"); // forbidden()
  if (!ctx.locations.some((l) => l.id === locationId)) return null; // looks like "not found"
  return { ctx, withPayments: can(ctx, "payments.view") };
}

export async function getBillableOrder(orgSlug: string, locationId: string, orderId: string): Promise<BillableOrder | null> {
  const g = await gate(orgSlug, locationId);
  const order = fixtureOrder(locationId);
  return g && order.orderId === orderId ? order : null;
}

export async function getBillSet(orgSlug: string, locationId: string, orderId: string): Promise<BillSetDetail | null> {
  const g = await gate(orgSlug, locationId);
  const order = fixtureOrder(locationId);
  const set = g && order.orderId === orderId ? sets.get(orderId) : undefined;
  if (!g || !set || set.status !== "active") return null;
  const bills = set.bills.map((b) => balanceRow(b, g.withPayments));
  const sum = (k: "subtotal" | "discount" | "serviceCharge" | "tax" | "total") => bills.reduce((a, b) => a + b[k], 0);
  return {
    billSetId: set.id, orderId, orderNumber: order.orderNumber, tableLabel: order.tableLabel, splitKind: set.splitKind, currency: order.currency,
    totals: { subtotal: sum("subtotal"), discount: sum("discount"), serviceCharge: sum("serviceCharge"), serviceChargeBps: SERVICE_BPS, tax: sum("tax"), taxRateBps: TAX_BPS, total: sum("total") },
    lines: set.lines, bills, payments: g.withPayments ? paymentRows(bills.map((b) => b.id)) : [],
  };
}

export async function getOpenCashSession(orgSlug: string, locationId: string): Promise<{ session: CashSession; expectedSoFar: number } | null> {
  const ctx = await requireOrgContext(orgSlug);
  await requirePermission(ctx.org.id, "payments.view");
  if (!ctx.locations.some((l) => l.id === locationId)) return null;
  const s = openSession(locationId);
  return s ? { session: { id: s.id, openedAt: s.openedAt, openingFloat: s.openingFloat }, expectedSoFar: expectedCash(s) } : null;
}

export async function getBillPrintData(orgSlug: string, locationId: string, billId: string): Promise<BillPrintData | null> {
  const g = await gate(orgSlug, locationId);
  const order = fixtureOrder(locationId);
  const set = g ? sets.get(order.orderId) : undefined;
  const bill = set?.bills.find((b) => b.id === billId);
  if (!g || !set || !bill) return null;
  const row = balanceRow(bill, g.withPayments);
  const mine = g.withPayments ? paymentRows([bill.id]) : [];
  return {
    bill: { id: bill.id, billNumber: bill.billNumber, shareNo: bill.shareNo, shareCount: bill.shareCount, createdAt: new Date().toISOString(), businessDate: new Date().toISOString().slice(0, 10) },
    location: { name: ctx2name(g.ctx, locationId), address: "Jl. Kemang Raya No. 12", city: "Jakarta Selatan", phone: "021-555-0123", taxId: "123456789012345", timezone: "Asia/Jakarta", currency: order.currency },
    order: { orderNumber: order.orderNumber, channel: "dine_in", tableLabel: order.tableLabel, guestCount: 4 },
    lines: set.lines.filter((l) => l.billId === null || l.billId === bill.id).map((l) => ({ name: l.name, variantName: l.variantName, modifiersText: l.modifiersText, quantity: l.quantity, unitPrice: l.unitPrice, lineTotal: l.lineTotal })),
    totals: { subtotal: bill.subtotal, discount: bill.discount, serviceCharge: bill.serviceCharge, serviceChargeBps: SERVICE_BPS, tax: bill.tax, taxRateBps: TAX_BPS, total: bill.total },
    payments: mine.map((p) => ({ method: p.method, methodLabel: p.methodLabel, amount: p.amount, tendered: p.tendered, changeGiven: p.changeGiven, at: p.createdAt })),
    paymentStatus: row.paymentStatus,
    printCount: bill.printCount,
    duplicate: bill.printCount >= 1,
  };
}
const ctx2name = (ctx: Ctx, locationId: string): string => ctx.locations.find((l) => l.id === locationId)?.name ?? "";
