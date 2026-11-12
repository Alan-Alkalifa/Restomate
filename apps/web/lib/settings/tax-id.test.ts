import { describe, expect, it } from "vitest";
import { formatTaxId, normalizeTaxId } from "./tax-id";

describe("normalizeTaxId", () => {
  it("empty or blank -> null", () => {
    for (const v of ["", "   ", null, undefined]) expect(normalizeTaxId(v)).toEqual({ ok: true, value: null });
  });
  it("15 and 16 digits are accepted as typed", () => {
    expect(normalizeTaxId("123456789012345")).toEqual({ ok: true, value: "123456789012345" });
    expect(normalizeTaxId("1234567890123456")).toEqual({ ok: true, value: "1234567890123456" });
  });
  it("dots, dashes and spaces are stripped", () => {
    expect(normalizeTaxId("12.345.678.9-012.345")).toEqual({ ok: true, value: "123456789012345" });
    expect(normalizeTaxId(" 1234 5678 9012 3456 ")).toEqual({ ok: true, value: "1234567890123456" });
  });
  it.each(["12345678901234", "12345678901234567", "12345678901234A", "NPWP 123456789012345", "12/345", "１２３４５６７８９０１２３４５"])(
    "rejects %j", (v) => expect(normalizeTaxId(v)).toMatchObject({ ok: false, message: expect.any(String) }));
});

describe("formatTaxId", () => {
  it("15 digits -> 12.345.678.9-012.345", () => expect(formatTaxId("123456789012345")).toBe("12.345.678.9-012.345"));
  it("16 digits -> groups of four", () => expect(formatTaxId("1234567890123456")).toBe("1234 5678 9012 3456"));
  it("null / empty / unexpected stay as they are", () => {
    expect(formatTaxId(null)).toBe("");
    expect(formatTaxId("")).toBe("");
    expect(formatTaxId("123")).toBe("123");
  });
  it("normalize then format round-trips", () => {
    const r = normalizeTaxId("12.345.678.9-012.345");
    expect(r.ok && formatTaxId(r.value)).toBe("12.345.678.9-012.345");
  });
});
