import { describe, expect, it } from "vitest";
import { normalizeTaxId } from "@/lib/settings/tax-id";
import { displayTaxId, localizeTaxIdError, previewTaxId } from "./tax-id-form";

const SAVED = "123456789012345";

describe("what Save would do", () => {
  it("15 and 16 digits, with or without separators, are accepted and shown formatted", () => {
    for (const typed of ["123456789012345", "12.345.678.9-012.345", " 12 345 678 9 012 345 ", "12-345-678-9-012-345"]) {
      expect(previewTaxId(typed, null)).toEqual({ kind: "set", digits: "123456789012345", formatted: "12.345.678.9-012.345" });
    }
    expect(previewTaxId("1234 5678 9012 3456", null)).toEqual({ kind: "set", digits: "1234567890123456", formatted: "1234 5678 9012 3456" });
  });
  it("empty clears a saved value, and is a no-op when nothing is saved", () => {
    expect(previewTaxId("", SAVED)).toEqual({ kind: "clear" });
    expect(previewTaxId("   ", SAVED)).toEqual({ kind: "clear" });
    expect(previewTaxId("", null)).toEqual({ kind: "unchanged" });
  });
  it("typing the value that is already saved (in any layout) changes nothing", () => {
    expect(previewTaxId("12.345.678.9-012.345", SAVED)).toEqual({ kind: "unchanged" });
    expect(previewTaxId(SAVED, SAVED)).toEqual({ kind: "unchanged" });
  });
  it("rejects letters and other characters, and the wrong number of digits", () => {
    for (const typed of ["12345678901234a", "NPWP 123456789012345", "12/345/678", "١٢٣"]) expect(previewTaxId(typed, null)).toEqual({ kind: "invalid", reason: "chars" });
    for (const typed of ["12345", "12345678901234", "12345678901234567", "1.2.3"]) expect(previewTaxId(typed, null)).toEqual({ kind: "invalid", reason: "length" });
  });
  it("agrees with the server's normalizer on what is acceptable (so the form never blocks a valid value or posts an invalid one)", () => {
    const samples = ["", "123456789012345", "1234567890123456", "12.345.678.9-012.345", "1234", "abc", "12345678901234567", " 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 ", "12,345", "-"];
    for (const s of samples) {
      const client = previewTaxId(s, null);
      const server = normalizeTaxId(s);
      expect(client.kind !== "invalid", JSON.stringify(s)).toBe(server.ok);
    }
  });
  it("displays a saved value formatted, and nothing for none", () => {
    expect(displayTaxId(SAVED)).toBe("12.345.678.9-012.345");
    expect(displayTaxId("1234567890123456")).toBe("1234 5678 9012 3456");
    expect(displayTaxId(null)).toBe("");
  });
});

describe("server field errors", () => {
  const t = { chars: "Hanya angka", length: "NPWP terdiri dari 15 atau 16 digit.", tooLong: "Terlalu panjang." };
  it("known server messages are shown in the page language; unknown ones verbatim", () => {
    expect(localizeTaxIdError("An NPWP has 15 or 16 digits.", t)).toBe(t.length);
    expect(localizeTaxIdError("Use digits only (dots, dashes and spaces are fine).", t)).toBe(t.chars);
    expect(localizeTaxIdError("That is too long.", t)).toBe(t.tooLong);
    expect(localizeTaxIdError("Something new from the server", t)).toBe("Something new from the server");
  });
});
