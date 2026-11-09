import { describe, expect, it } from "vitest";
import { bpsToPercent, percentToBps } from "./bps";

describe("percentToBps", () => {
  it.each([
    ["10", 1000],
    ["5.5", 550],
    ["12.5", 1250],
    ["0.1", 10],
    ["0", 0],
    ["", 0],
    ["  ", 0],
    ["10,5", 1050],
    ["100", 10000],
    ["0.07", 7],
  ])("%j -> %i", (input, bps) => {
    expect(percentToBps(input)).toEqual({ ok: true, bps });
  });
  it.each(["abc", "-1", "10.123", "100.01", "1e2", "101", "."])("rejects %j", (input) => {
    expect(percentToBps(input).ok).toBe(false);
  });
  it("round-trips for display", () => {
    expect(bpsToPercent(1000)).toBe("10");
    expect(bpsToPercent(550)).toBe("5.5");
    expect(bpsToPercent(7)).toBe("0.07");
  });
});

describe("percentToBps with a cap", () => {
  it("accepts up to the cap and rejects above it", () => {
    expect(percentToBps("25", 2500)).toEqual({ ok: true, bps: 2500 });
    expect(percentToBps("25.01", 2500)).toEqual({ ok: false, error: "Must be between 0 and 25." });
  });
});
