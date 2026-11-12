import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import { id } from "@/i18n/id";
import type { BillsDictionary } from "@/i18n/types";
import { BillsScreen, type BillsActions, type BillsPerms } from "./BillsScreen";
import { CashSessionPanel } from "./CashSessionPanel";
import { PaymentPanel } from "./PaymentPanel";
import type { BillRow, BillSetDetail, BillableOrder } from "./bills-model";

vi.mock("./bills-feed", () => ({ useBillsFeed: () => ({ online: true, connection: "connected", refreshing: false, refresh: () => {} }) }));

const noop = async () => ({ ok: true as const, data: null as never });
const actions = { createBills: noop, recordPayment: noop, recordRefund: noop, voidBillSet: noop, openCashSession: noop, closeCashSession: noop } as unknown as BillsActions;
const order = (o: Partial<BillableOrder> = {}): BillableOrder => ({
  orderId: "o1", orderNumber: 41, status: "served", tableLabel: "T4 + T5", currency: "IDR",
  lines: [{ id: "l1", name: "Nasi Goreng", variantName: "Large", modifiersText: null, quantity: 2, lineTotal: 76000 }, { id: "l2", name: "Es Teh", variantName: null, modifiersText: null, quantity: 1, lineTotal: 8000 }], ...o,
});
const bill = (o: Partial<BillRow> = {}): BillRow => ({
  id: "b1", billNumber: 7, shareNo: 1, shareCount: 1, subtotal: 84000, discount: 0, serviceCharge: 4200, tax: 8820, total: 97020, printCount: 0,
  paidTotal: 0, refundedTotal: 0, outstanding: 97020, paymentStatus: "unpaid", ...o,
});
const set = (bills: BillRow[], o: Partial<BillSetDetail> = {}): BillSetDetail => ({
  billSetId: "s1", orderId: "o1", orderNumber: 41, tableLabel: "T4 + T5", splitKind: "none", currency: "IDR",
  totals: { subtotal: 84000, discount: 0, serviceCharge: 4200, serviceChargeBps: 500, tax: 8820, taxRateBps: 1000, total: 97020 },
  lines: [{ id: "x1", orderItemId: "l1", billId: null, name: "Nasi Goreng", variantName: "Large", modifiersText: null, quantity: 2, unitPrice: 38000, lineTotal: 76000 }],
  bills, payments: [], ...o,
});
const payment = (o = {}) => ({ id: "p1", billId: "b1", method: "cash" as const, methodLabel: null, amount: 50000, tendered: 50000, changeGiven: 0, approvalCode: null, refunded: 0, createdAt: "2026-11-12T10:00:00Z", ...o });
const cashier: BillsPerms = { take: true, refund: false, viewPayments: true, print: true };
const manager: BillsPerms = { take: true, refund: true, viewPayments: true, print: true };
const waiter: BillsPerms = { take: false, refund: false, viewPayments: false, print: true };
const screen = (p: { perms: BillsPerms; order?: BillableOrder; set?: BillSetDetail | null; cash?: boolean; dict?: BillsDictionary; locale?: "id" | "en" }) =>
  renderToStaticMarkup(
    <BillsScreen t={p.dict ?? en.bills} locale={p.locale ?? "en"} locationId="11111111-1111-4111-8111-111111111111" order={p.order ?? order()} set={p.set ?? null}
      cash={p.cash ? { session: { id: "cs1", openedAt: "2026-11-12T08:00:00Z", openingFloat: 200000 }, expectedSoFar: 250000 } : null} perms={p.perms} actions={actions} printHref={(b) => `/print/${b}`} />,
  );

describe("creating a bill", () => {
  it("offers none / equal / by item for a billable order, with the order-lock note", () => {
    const html = screen({ perms: cashier });
    for (const s of ["Create bill", "One bill", "Split equally", "Split by item", "locks the order"]) expect(html).toContain(s);
  });
  it("does not offer it before the order is accepted (placed) or after it is closed", () => {
    for (const status of ["draft", "placed", "completed", "cancelled"] as const) {
      const html = screen({ perms: cashier, order: order({ status }) });
      expect(html, status).toContain("cannot be billed yet");
      expect(html, status).not.toContain("Create bill");
    }
  });
  it("a waiter can raise the pre-bill", () => {
    expect(screen({ perms: waiter })).toContain("Create bill");
  });
});

describe("taking payment", () => {
  it("a cashier sees the payment panel with cash, card (EDC) and other, and the balance", () => {
    const html = screen({ perms: cashier, set: set([bill()]), cash: true });
    for (const s of ["Take payment", "Cash", "Card (EDC)", "Other", "Outstanding", "Unpaid"]) expect(html).toContain(s);
    expect(html).toContain('name="billId"');
    expect(html).not.toContain('name="organizationId"'); // no org id in any payload
  });
  it("there is no card number / expiry / CVV field anywhere on the screen", () => {
    const html = screen({ perms: manager, set: set([bill()]), cash: true });
    expect(html).not.toMatch(/card.?number|cvv|cvc|expiry|expiration|name="card/i);
    // The only card-related input is the terminal's approval code, and it is only shown for EDC.
    const panel = renderToStaticMarkup(<PaymentPanel bill={bill()} currency="IDR" t={en.bills} hasOpenSession online recordPayment={noop as never} onPaid={() => {}} />);
    expect(panel).not.toMatch(/card.?number|cvv|cvc|expiry/i);
  });
  it("cash without an open session asks to open one and disables the button", () => {
    const html = screen({ perms: cashier, set: set([bill()]), cash: false });
    expect(html).toContain("Open a session before taking cash payments.");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Record payment/);
  });
  it("a paid bill takes no more payments", () => {
    const html = screen({ perms: cashier, set: set([bill({ paidTotal: 97020, outstanding: 0, paymentStatus: "paid" })]), cash: true });
    expect(html).not.toContain("Take payment");
    expect(html).toContain("Paid");
  });
  it("shows a bill per share with its status", () => {
    const html = screen({ perms: cashier, set: set([bill({ shareCount: 2, id: "a" }), bill({ id: "b", shareNo: 2, shareCount: 2, paymentStatus: "partially_paid", paidTotal: 1000, outstanding: 96020 })], { splitKind: "equal" }), cash: true });
    expect(html).toContain("Share 1 of 2");
    expect(html).toContain("Partly paid");
  });
});

describe("a waiter sees the pre-bill only", () => {
  const html = screen({ perms: waiter, set: set([bill({ paidTotal: 0, refundedTotal: 0, outstanding: 0, paymentStatus: null })]) });
  it("has the pre-bill heading, items, totals and a print link", () => {
    for (const s of ["Pre-bill", "Nasi Goreng", "Total", "Print pre-bill", "/print/b1"]) expect(html).toContain(s);
  });
  it("has no payment UI, no status, no paid/outstanding rows, no refund, no void, no cash drawer", () => {
    for (const s of ["Take payment", "Record payment", "Outstanding", "Unpaid", "Refund", "Void bill", "Cash drawer", "Paid"]) expect(html, s).not.toContain(s);
  });
});

describe("permissions gate the dangerous actions (the server refuses as well)", () => {
  const paid = set([bill({ paidTotal: 50000, outstanding: 47020, paymentStatus: "partially_paid" })], { payments: [payment()] });
  it("refund appears only for payments.refund", () => {
    expect(screen({ perms: cashier, set: paid, cash: true })).not.toContain("Refund…");
    expect(screen({ perms: manager, set: paid, cash: true })).toContain("Refund…");
  });
  it("a bill that holds money says refund first instead of offering void", () => {
    const html = screen({ perms: manager, set: paid, cash: true });
    expect(html).toContain("Refund them first");
    expect(html).not.toContain("Void bill…");
  });
  it("an unpaid set can be voided by whoever may take payments", () => {
    expect(screen({ perms: cashier, set: set([bill()]), cash: true })).toContain("Void bill…");
  });
  it("a cashier cannot void a set that has payment history (needs payments.refund)", () => {
    const refunded = set([bill({ paidTotal: 50000, refundedTotal: 50000, outstanding: 47020, paymentStatus: "partially_refunded" })], { payments: [payment({ refunded: 50000 })] });
    expect(screen({ perms: cashier, set: refunded, cash: true })).not.toContain("Void bill…");
    expect(screen({ perms: manager, set: refunded, cash: true })).toContain("Void bill…");
  });
});

describe("cash drawer", () => {
  const panel = (session: boolean) => renderToStaticMarkup(
    <CashSessionPanel session={session ? { id: "cs1", openedAt: "2026-11-12T08:00:00Z", openingFloat: 200000 } : null} expectedSoFar={250000} currency="IDR" t={en.bills} locale="en"
      openCashSession={noop as never} closeCashSession={noop as never} onChanged={() => {}} />,
  );
  it("with no session it asks for an opening float", () => {
    const html = panel(false);
    expect(html).toContain("Opening float");
    expect(html).toContain("Open session");
    expect(html).toContain('name="openingFloat"');
  });
  it("with a session it shows the opening float and offers to close", () => {
    const html = panel(true);
    expect(html).toContain("Opening float: Rp 200.000");
    expect(html).toContain("Close session…");
  });
});

describe("Bahasa Indonesia", () => {
  it("renders the same screens in id", () => {
    const html = screen({ perms: cashier, set: set([bill()]), cash: true, dict: id.bills, locale: "id" });
    for (const s of ["Terima pembayaran", "Tunai", "Belum dibayar", "Sisa tagihan", "Rp 97.020"]) expect(html).toContain(s);
  });
});
