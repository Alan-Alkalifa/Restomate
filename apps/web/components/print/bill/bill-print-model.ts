import { fmt } from "@/i18n/config";
import type { BillsDictionary } from "@/i18n/types";
import { formatMoney } from "@/lib/money";

/*
 * Bill print model: pure data -> receipt rows, separate from the HTML (CLAUDE.md: the same payload can later feed ESC/POS).
 *
 * SEAM: `BillPrintData` mirrors docs/contracts/bills.md ("Printing hooks") and `lib/bills` (MSC-T07 / #134). When that
 * merges, import the type from there and delete it here.
 */
export type BillPrintData = {
  bill: { id: string; billNumber: number; shareNo: number; shareCount: number; createdAt: string; businessDate: string };
  location: { name: string; address: string | null; city: string | null; phone: string | null; taxId: string | null; timezone: string; currency: string };
  order: { orderNumber: number; channel: string; tableLabel: string | null; guestCount: number | null };
  lines: { name: string; variantName: string | null; modifiersText: string | null; quantity: number; unitPrice: number; lineTotal: number }[];
  totals: { subtotal: number; discount: number; serviceCharge: number; serviceChargeBps: number; tax: number; taxRateBps: number; total: number };
  /** [] for a caller without payments.view (a waiter): a pre-bill never leaks payment data. */
  payments: { method: string; methodLabel: string | null; amount: number; tendered: number | null; changeGiven: number | null; at: string }[];
  /** null unless the caller holds payments.view. */
  paymentStatus: string | null;
  /** Value BEFORE this print. */
  printCount: number;
  duplicate: boolean;
};
// ---- end of seam ----

export type PrintSize = "80" | "58";
export const DEFAULT_SIZE: PrintSize = "80";
export const parsePrintSize = (v: unknown): PrintSize => (v === "58" ? "58" : "80");

/** Printable width (mm) inside the paper margins. Thermal printers cannot print to the paper edge. */
export const PAPER: Record<PrintSize, { paperMm: number; contentMm: number; fontPt: number }> = {
  "80": { paperMm: 80, contentMm: 72, fontPt: 9.5 },
  "58": { paperMm: 58, contentMm: 48, fontPt: 8.5 },
};

/** `@page` sized to the roll, margins off, everything but the receipt hidden when printing. */
export function printCss(size: PrintSize): string {
  const p = PAPER[size];
  return `
@page { size: ${p.paperMm}mm auto; margin: 0; }
.bill-receipt { width: ${p.contentMm}mm; font-size: ${p.fontPt}pt; line-height: 1.25; color: #000; background: #fff; font-family: ui-monospace, "Courier New", monospace; }
.bill-receipt .r-row { display: flex; justify-content: space-between; gap: 2mm; }
.bill-receipt .r-row > :first-child { min-width: 0; overflow-wrap: anywhere; }
.bill-receipt .r-row > :last-child { white-space: nowrap; text-align: right; }
.bill-receipt hr { border: 0; border-top: 1px dashed #000; margin: 1.5mm 0; }
@media print {
  html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
  body * { visibility: hidden; }
  .bill-receipt, .bill-receipt * { visibility: visible; }
  .bill-receipt { position: absolute; left: 0; top: 0; margin: 0 ${(p.paperMm - p.contentMm) / 2}mm; }
  .no-print { display: none !important; }
}`;
}

/** "T4 + T5" (merged tables) is printed as the order has it; no table means takeaway. */
export const groupLabel = (tableLabel: string | null, t: Pick<BillsDictionary["receipt"], "table" | "takeaway">): string =>
  tableLabel && tableLabel.trim() ? fmt(t.table, { label: tableLabel.trim() }) : t.takeaway;

/** 15 digits as 99.999.999.9-999.999, 16 digits in groups of four. Anything else is not printed (null). */
export function formatNpwp(taxId: string | null): string | null {
  if (!taxId || !/^[0-9]{15,16}$/.test(taxId)) return null;
  if (taxId.length === 15) return `${taxId.slice(0, 2)}.${taxId.slice(2, 5)}.${taxId.slice(5, 8)}.${taxId[8]}-${taxId.slice(9, 12)}.${taxId.slice(12)}`;
  return taxId.replace(/(.{4})/g, "$1 ").trim();
}

/** 1000 -> "10%", 550 -> "5.5%". */
export const bpsPercent = (bps: number): string => `${Number.isInteger(bps / 100) ? bps / 100 : (bps / 100).toFixed(2).replace(/0+$/, "")}%`;

export type ReceiptRow = { label: string; value: string; strong?: boolean };
export type Receipt = {
  title: string;
  /** Printed big and boxed when this is a reprint. */
  duplicateMark: string | null;
  header: { name: string; address: string[]; phone: string | null; npwp: string | null };
  meta: string[];
  lines: { text: string; detail: string[]; amount: string }[];
  totals: ReceiptRow[];
  payments: ReceiptRow[];
  footer: string;
};

const dateTime = (iso: string, timezone: string, locale: string) => {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short", timeZone: timezone }).format(new Date(iso));
  } catch {
    return iso;
  }
};

/**
 * Builds the receipt from the server's print data. Every amount comes from `data` (the server computed it); nothing
 * here computes money. `duplicate` and `printCount` also come from the server, never from the browser.
 * `duplicate` is passed in because the print route sets it from record_bill_print's result.
 */
export function buildReceipt(data: BillPrintData, t: BillsDictionary["receipt"], opts: { locale: "id" | "en"; duplicate: boolean; footer?: string }): Receipt {
  // Rupiah is always written the Indonesian way ("Rp 25.000"), in both languages (CLAUDE.md).
  const money = (n: number) => formatMoney(n, data.location.currency);
  const { totals, bill, order, location } = data;
  const isPrebill = data.paymentStatus === null;
  const numberLocale = opts.locale === "id" ? "id-ID" : "en-GB";
  const meta = [
    fmt(t.order, { number: order.orderNumber }),
    groupLabel(order.tableLabel, t),
    ...(order.guestCount ? [fmt(t.guests, { count: order.guestCount })] : []),
    ...(bill.shareCount > 1 ? [fmt(t.share, { k: bill.shareNo, n: bill.shareCount })] : []),
    dateTime(bill.createdAt, location.timezone, numberLocale),
  ];
  const npwp = formatNpwp(location.taxId);
  return {
    title: `${isPrebill ? t.prebill : t.bill} #${bill.billNumber}`,
    duplicateMark: opts.duplicate ? t.duplicate : null,
    header: {
      name: location.name,
      address: [location.address, location.city].filter((s): s is string => !!s && s.trim() !== ""),
      phone: location.phone,
      npwp: npwp ? fmt(t.npwp, { value: npwp }) : null,
    },
    meta,
    lines: data.lines.map((l) => ({
      text: `${l.quantity}× ${l.name}${l.variantName ? ` (${l.variantName})` : ""}`,
      detail: l.modifiersText ? [l.modifiersText] : [],
      amount: money(l.lineTotal),
    })),
    totals: [
      { label: t.subtotal, value: money(totals.subtotal) },
      ...(totals.discount > 0 ? [{ label: t.discount, value: `-${money(totals.discount)}` }] : []),
      ...(totals.serviceCharge > 0 ? [{ label: fmt(t.serviceCharge, { percent: bpsPercent(totals.serviceChargeBps) }), value: money(totals.serviceCharge) }] : []),
      ...(totals.tax > 0 ? [{ label: fmt(t.tax, { percent: bpsPercent(totals.taxRateBps) }), value: money(totals.tax) }] : []),
      { label: t.total, value: money(totals.total), strong: true },
    ],
    // A pre-bill (payments = [] and status null) has no payment rows at all.
    payments: data.payments.flatMap((p): ReceiptRow[] => [
      { label: p.method === "other" && p.methodLabel ? p.methodLabel : (t.method as Record<string, string>)[p.method] ?? p.method, value: money(p.amount) },
      ...(p.changeGiven ? [{ label: t.change, value: money(p.changeGiven) }] : []),
    ]),
    footer: opts.footer ?? t.thanks,
  };
}
