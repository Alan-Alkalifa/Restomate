import { describe, expect, it } from "vitest";
import { allocate, applyBps, calculateBill, currencyExponent, formatMoney, parseMoneyInput } from "./money";

describe("currencyExponent", () => {
  it.each([["IDR", 0], ["USD", 2], ["JPY", 0]])("%s -> %i", (c, e) => expect(currencyExponent(c)).toBe(e));
  it("rejects unknown currency", () => expect(() => currencyExponent("XXX")).toThrow(RangeError));
  it.each(["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf", "prototype", "", "idr"])(
    "rejects %j (own keys only, case-sensitive)", (c) => expect(() => currencyExponent(c)).toThrow(RangeError));
  it("every public entry point refuses a prototype key", () => {
    expect(() => formatMoney(100, "__proto__")).toThrow(RangeError);
    expect(() => formatMoney(100, "constructor")).toThrow(RangeError);
    for (const c of ["__proto__", "constructor", "toString"]) {
      expect(parseMoneyInput("10", c)).toEqual({ ok: false, message: "This currency is not supported." });
    }
  });
});

describe("formatMoney", () => {
  it("IDR", () => {
    expect(formatMoney(25000, "IDR")).toBe("Rp 25.000");
    expect(formatMoney(0, "IDR")).toBe("Rp 0");
    expect(formatMoney(1234567, "IDR")).toBe("Rp 1.234.567");
  });
  it("USD en-US", () => {
    expect(formatMoney(2550, "USD", "en-US")).toBe("$25.50");
    expect(formatMoney(5, "USD", "en-US")).toBe("$0.05");
    expect(formatMoney(0, "USD", "en-US")).toBe("$0.00");
  });
  it("never emits non-breaking spaces", () => {
    expect(formatMoney(25000, "IDR")).not.toMatch(/[  ]/);
  });
  it("rejects non-integers and negatives", () => {
    expect(() => formatMoney(10.5, "IDR")).toThrow(RangeError);
    expect(() => formatMoney(-1, "IDR")).toThrow(RangeError);
    expect(() => formatMoney(Number.NaN, "IDR")).toThrow(RangeError);
  });
});

describe("applyBps", () => {
  it("half-up and half-even at exact halves", () => {
    expect(applyBps(5, 1000)).toBe(1); // 0.5 -> 1
    expect(applyBps(5, 1000, "half-even")).toBe(0); // 0.5 -> 0
    expect(applyBps(15, 1000, "half-even")).toBe(2); // 1.5 -> 2
    expect(applyBps(25, 1000, "half-even")).toBe(2); // 2.5 -> 2
  });
  it("non-halves round to nearest", () => {
    expect(applyBps(33333, 1000)).toBe(3333); // 3333.3
    expect(applyBps(33336, 1000)).toBe(3334); // 3333.6
  });
  it("is exact for huge amounts", () => {
    expect(applyBps(9_007_199_254_740_991, 10000)).toBe(9_007_199_254_740_991);
  });
  it("validates bps", () => {
    expect(() => applyBps(100, 10001)).toThrow(RangeError);
    expect(() => applyBps(100, -1)).toThrow(RangeError);
    expect(() => applyBps(100, 5.5)).toThrow(RangeError);
  });
});

describe("calculateBill", () => {
  const cases: Array<[string, number, number, number, boolean | undefined, number, number, number]> = [
    // name, subtotal, svcBps, taxBps, taxOnSvc, svc, tax, total
    ["zero subtotal", 0, 500, 1000, undefined, 0, 0, 0],
    ["zero rates", 100000, 0, 0, undefined, 0, 0, 100000],
    ["PB1 10% only", 100000, 0, 1000, undefined, 0, 10000, 110000],
    ["service 5% only", 100000, 500, 0, undefined, 5000, 0, 105000],
    ["10% PB1 + 5% service, tax on service", 100000, 500, 1000, undefined, 5000, 10500, 115500],
    ["10% PB1 + 5% service, tax NOT on service", 100000, 500, 1000, false, 5000, 10000, 115000],
    ["rounding edge 33333 x 10%", 33333, 0, 1000, undefined, 0, 3333, 36666],
    ["rounding: svc half-up 10 x 5% = 0.5", 10, 500, 0, undefined, 1, 0, 11],
    ["service rounds then tax on rounded base", 33333, 500, 1000, undefined, 1667, 3500, 38500],
    ["tax-not-on-service same input", 33333, 500, 1000, false, 1667, 3333, 38333],
    ["USD cents", 2550, 1000, 800, undefined, 255, 224, 3029],
    ["100% service", 1000, 10000, 0, undefined, 1000, 0, 2000],
    ["tiny amount", 1, 500, 1000, undefined, 0, 0, 1],
  ];
  it.each(cases)("%s", (_n, subtotal, serviceChargeBps, taxRateBps, taxOnServiceCharge, svc, tax, total) => {
    const r = calculateBill({ subtotal, serviceChargeBps, taxRateBps, taxOnServiceCharge });
    expect(r).toEqual({ subtotal, serviceCharge: svc, tax, total });
    expect(r.total).toBe(r.subtotal + r.serviceCharge + r.tax);
  });
  it("supports half-even", () => {
    expect(calculateBill({ subtotal: 10, serviceChargeBps: 500, taxRateBps: 0, rounding: "half-even" }).serviceCharge).toBe(0);
  });
  it("rejects bad input", () => {
    expect(() => calculateBill({ subtotal: 10.5, serviceChargeBps: 0, taxRateBps: 0 })).toThrow(RangeError);
    expect(() => calculateBill({ subtotal: 10, serviceChargeBps: 0.5, taxRateBps: 0 })).toThrow(RangeError);
    expect(() => calculateBill({ subtotal: 10, serviceChargeBps: 0, taxRateBps: 20000 })).toThrow(RangeError);
    expect(() => calculateBill({ subtotal: Number.MAX_SAFE_INTEGER, serviceChargeBps: 500, taxRateBps: 1000 })).toThrow(RangeError);
  });
});

describe("allocate", () => {
  it("splits evenly", () => expect(allocate(30000, 3)).toEqual([10000, 10000, 10000]));
  it("spreads remainder from the first part", () => {
    expect(allocate(10001, 3)).toEqual([3334, 3334, 3333]);
    expect(allocate(100, 7)).toEqual([15, 15, 14, 14, 14, 14, 14]);
  });
  it("handles zero and more parts than units", () => {
    expect(allocate(0, 3)).toEqual([0, 0, 0]);
    expect(allocate(2, 5)).toEqual([1, 1, 0, 0, 0]);
  });
  it("always sums back", () => {
    for (let amount = 0; amount < 200; amount++) {
      for (let parts = 1; parts < 12; parts++) {
        const out = allocate(amount, parts);
        expect(out).toHaveLength(parts);
        expect(out.reduce((a, b) => a + b, 0)).toBe(amount);
        expect(Math.max(...out) - Math.min(...out)).toBeLessThanOrEqual(1);
      }
    }
  });
  it("rejects bad input", () => {
    expect(() => allocate(10.5, 2)).toThrow(RangeError);
    expect(() => allocate(10, 0)).toThrow(RangeError);
    expect(() => allocate(10, 1.5)).toThrow(RangeError);
  });
});

describe("parseMoneyInput", () => {
  const ok = (text: string, currency: string, value: number, opts?: { allowNegative?: boolean }) =>
    expect(parseMoneyInput(text, currency, opts)).toEqual({ ok: true, value });
  const bad = (text: string, currency = "IDR", opts?: { allowNegative?: boolean }) => {
    const r = parseMoneyInput(text, currency, opts);
    expect(r.ok).toBe(false);
    return r.ok ? "" : r.message;
  };

  it("IDR: \"0.500\" is 500 (the dot is the id-ID thousands separator, not a decimal point); documented on purpose", () => {
    ok("0.500", "IDR", 500);
    ok("0,500", "IDR", 500);
  });
  it("IDR: plain, grouped and prefixed input", () => {
    ok("35000", "IDR", 35000);
    ok("35.000", "IDR", 35000);
    ok("1.250.000", "IDR", 1250000);
    ok("1,250,000", "IDR", 1250000);
    ok("Rp 35.000", "IDR", 35000);
    ok("Rp35.000", "IDR", 35000);
    ok("rp. 35.000", "IDR", 35000);
    ok("  35 000  ", "IDR", 35000);
    ok("Rp\u00a035.000", "IDR", 35000);
    ok("Rp\u202f35.000", "IDR", 35000);
    ok("0", "IDR", 0);
    ok("007", "IDR", 7);
  });
  it("IDR: rejects decimals and malformed grouping", () => {
    expect(bad("35.50")).toMatch(/decimals/i);
    expect(bad("35,5")).toMatch(/decimals/i);
    bad("1.2.3");
    bad("1.2345");
    bad("35.00.000");
    bad(".5");
    bad("35.");
  });
  it("rejects empty, non-numeric and odd input", () => {
    expect(bad("")).toMatch(/enter/i);
    expect(bad("   ")).toMatch(/enter/i);
    expect(bad("Rp")).toMatch(/enter/i);
    bad("abc");
    bad("12abc");
    bad("1e5");
    bad("0x10");
    bad("+5");
    bad("--5", "IDR", { allowNegative: true });
  });
  it("negative only with allowNegative", () => {
    expect(bad("-5.000")).toMatch(/negative/i);
    expect(bad("Rp -5.000")).toMatch(/negative/i);
    ok("-5.000", "IDR", -5000, { allowNegative: true });
    ok("Rp -5.000", "IDR", -5000, { allowNegative: true });
    ok("-Rp 5.000", "IDR", -5000, { allowNegative: true });
    ok("-0", "IDR", 0, { allowNegative: true });
  });
  it("USD: one decimal separator with at most two digits", () => {
    ok("25", "USD", 2500);
    ok("25.5", "USD", 2550);
    ok("25.50", "USD", 2550);
    ok("25,50", "USD", 2550);
    ok("$25.05", "USD", 2505);
    ok("$ 1,234.56", "USD", 123456);
    ok("1.234,56", "USD", 123456);
    ok("1,234,567", "USD", 123456700);
    ok("0.99", "USD", 99);
    ok("-3.25", "USD", -325, { allowNegative: true });
  });
  it("USD: rejects too many decimals and bad shapes", () => {
    expect(bad("1.2345", "USD")).toMatch(/decimal/i);
    expect(bad("25.999", "USD")).toMatch(/decimal/i);
    expect(bad("1,234", "USD")).toMatch(/decimal/i);
    bad("1.2.3", "USD");
    bad("1,2,3", "USD");
    bad("1.234.56", "USD");
    bad("12,34.5,6", "USD");
    bad("25.", "USD");
    bad(",50", "USD");
    expect(bad("-1.00", "USD")).toMatch(/negative/i);
  });
  it("enforces the 1_000_000_000_000 bound without float drift", () => {
    ok("1.000.000.000.000", "IDR", 1_000_000_000_000);
    expect(bad("1.000.000.000.001")).toMatch(/large/i);
    expect(bad("9".repeat(30))).toMatch(/large/i);
    expect(bad("-1.000.000.000.001", "IDR", { allowNegative: true })).toMatch(/large/i);
    ok("10000000000.00", "USD", 1_000_000_000_000);
    expect(bad("10000000000.01", "USD")).toMatch(/large/i);
  });
  it("unsupported currency returns a message instead of throwing", () => {
    expect(parseMoneyInput("5", "XXX")).toMatchObject({ ok: false });
  });
});
