import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { id } from "@/i18n/id";
import { BillReceipt } from "./BillReceipt";
import { PAPER, bpsPercent, buildReceipt, formatNpwp, groupLabel, parsePrintSize, printCss, type BillPrintData } from "./bill-print-model";

const data = (o: Partial<BillPrintData> = {}): BillPrintData => ({
  bill: { id: "b1", billNumber: 7, shareNo: 1, shareCount: 1, createdAt: "2026-11-12T10:30:00Z", businessDate: "2026-11-12" },
  location: { name: "Kemang", address: "Jl. Kemang Raya 12", city: "Jakarta Selatan", phone: "021-555", taxId: "123456789012345", timezone: "Asia/Jakarta", currency: "IDR" },
  order: { orderNumber: 41, channel: "dine_in", tableLabel: "T4 + T5", guestCount: 4 },
  lines: [{ name: "Nasi Goreng", variantName: "Large", modifiersText: "Extra spicy", quantity: 2, unitPrice: 38000, lineTotal: 76000 }],
  totals: { subtotal: 76000, discount: 0, serviceCharge: 3800, serviceChargeBps: 500, tax: 7980, taxRateBps: 1000, total: 87780 },
  payments: [], paymentStatus: "unpaid", printCount: 0, duplicate: false, ...o,
});
const r = (d: BillPrintData, duplicate = false, locale: "id" | "en" = "en") => buildReceipt(d, (locale === "id" ? id : en).bills.receipt, { locale, duplicate });

describe("paper sizes", () => {
  it("defaults to 80 mm; only 58 selects 58 mm", () => {
    expect(parsePrintSize(undefined)).toBe("80");
    expect(parsePrintSize("58")).toBe("58");
    for (const v of ["59", "<script>", "", 58, null]) expect(parsePrintSize(v)).toBe("80");
  });
  it("sizes @page to the roll and prints only the receipt", () => {
    expect(printCss("80")).toContain("size: 80mm auto");
    expect(printCss("58")).toContain("size: 58mm auto");
    expect(printCss("80")).toContain(`width: ${PAPER["80"].contentMm}mm`);
    expect(printCss("58")).toContain(`width: ${PAPER["58"].contentMm}mm`);
    expect(printCss("58")).toContain("body * { visibility: hidden; }");
  });
});

describe("receipt model", () => {
  it("group label is the table as the order has it ('T4 + T5'), else takeaway", () => {
    expect(groupLabel("T4 + T5", en.bills.receipt)).toBe("Table T4 + T5");
    expect(groupLabel(null, en.bills.receipt)).toBe("Takeaway");
    expect(groupLabel("  ", id.bills.receipt)).toBe("Bawa pulang");
  });
  it("NPWP is formatted when valid and never printed when missing or malformed", () => {
    expect(formatNpwp("123456789012345")).toBe("12.345.678.9-012.345");
    expect(formatNpwp("1234567890123456")).toBe("1234 5678 9012 3456");
    for (const v of [null, "", "12345", "12345678901234x", "1234567890123456789"]) expect(formatNpwp(v)).toBeNull();
    expect(r(data()).header.npwp).toBe("NPWP 12.345.678.9-012.345");
    expect(r(data({ location: { ...data().location, taxId: null } })).header.npwp).toBeNull();
  });
  it("formats percentages from basis points", () => {
    expect(bpsPercent(1000)).toBe("10%");
    expect(bpsPercent(550)).toBe("5.5%");
    expect(bpsPercent(0)).toBe("0%");
  });
  it("marks a reprint DUPLICATE (Bahasa: DUPLIKAT) and not the first print", () => {
    expect(r(data(), false).duplicateMark).toBeNull();
    expect(r(data(), true).duplicateMark).toBe("DUPLICATE");
    expect(r(data(), true, "id").duplicateMark).toBe("DUPLIKAT");
  });
  it("prints every amount as the server sent it, in Rupiah", () => {
    const rc = r(data(), false, "id");
    const all = JSON.stringify(rc);
    for (const s of ["Rp 76.000", "Rp 3.800", "Rp 7.980", "Rp 87.780"]) expect(all).toContain(s);
    expect(rc.totals.map((x) => x.label)).toEqual(["Subtotal", "Biaya layanan (5%)", "Pajak (10%)", "Total"]);
  });
  it("omits the discount row when there is none, and shows it when there is", () => {
    expect(r(data()).totals.some((x) => x.label === "Discount")).toBe(false);
    expect(r(data({ totals: { ...data().totals, discount: 5000 } })).totals.find((x) => x.label === "Discount")?.value).toBe("-Rp 5.000");
  });
  it("a pre-bill (no payment status, no payments) has no payment rows and says Pre-bill", () => {
    const pre = r(data({ paymentStatus: null, payments: [] }));
    expect(pre.title).toBe("Pre-bill #7");
    expect(pre.payments).toEqual([]);
  });
  it("a paid bill lists payments and the change given", () => {
    const paid = r(data({ paymentStatus: "paid", payments: [{ method: "cash", methodLabel: null, amount: 87780, tendered: 100000, changeGiven: 12220, at: "2026-11-12T10:40:00Z" }] }));
    expect(paid.title).toBe("Bill #7");
    expect(paid.payments).toEqual([{ label: "Cash", value: "Rp 87.780" }, { label: "Change", value: "Rp 12.220" }]);
  });
  it("shows 'share k of n' only for split bills", () => {
    expect(r(data()).meta.some((m) => m.startsWith("Share"))).toBe(false);
    expect(r(data({ bill: { ...data().bill, shareNo: 2, shareCount: 3 } })).meta).toContain("Share 2 of 3");
  });
});

describe("BillReceipt", () => {
  it("renders at 80 and 58 mm with the DUPLICATE mark on a reprint, and no ids or client data", () => {
    for (const size of ["80", "58"] as const) {
      const html = renderToStaticMarkup(<BillReceipt receipt={r(data(), true)} size={size} logoUrl={null} />);
      expect(html).toContain(`data-size="${size}"`);
      expect(html).toContain(`size: ${size}mm auto`);
      expect(html).toContain("DUPLICATE");
      expect(html).toContain("Nasi Goreng");
      expect(html).not.toContain('value="b1"');
    }
    expect(renderToStaticMarkup(<BillReceipt receipt={r(data(), false)} size="80" logoUrl={null} />)).not.toContain("DUPLICATE");
  });
});
