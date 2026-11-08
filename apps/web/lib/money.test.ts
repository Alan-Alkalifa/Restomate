import { describe, expect, it } from "vitest";
import { allocate, applyBps, calculateBill, currencyExponent, formatMoney } from "./money";

describe("currencyExponent", () => {
  it.each([["IDR", 0], ["USD", 2], ["JPY", 0]])("%s -> %i", (c, e) => expect(currencyExponent(c)).toBe(e));
  it("rejects unknown currency", () => expect(() => currencyExponent("XXX")).toThrow(RangeError));
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
