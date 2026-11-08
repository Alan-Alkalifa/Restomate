import { describe, expect, it } from "vitest";
import { isValidSlug, suggestSlug } from "./slug";

describe("suggestSlug", () => {
  it.each([
    ["Warung Makan Sédap", "warung-makan-sedap"],
    ["  Café & Bar  ", "cafe-and-bar"],
    ["Bakso   Pak--Joko!!", "bakso-pak-joko"],
    ["---", ""],
  ])("%j -> %j", (input, out) => expect(suggestSlug(input)).toBe(out));
  it("trims to 40 chars without a trailing hyphen", () => {
    const s = suggestSlug("a".repeat(39) + " b" + " c");
    expect(s.length).toBeLessThanOrEqual(40);
    expect(s.endsWith("-")).toBe(false);
  });
  it("produces valid slugs for normal names", () => expect(isValidSlug(suggestSlug("Demo Restaurant"))).toBe(true));
});

describe("isValidSlug", () => {
  it.each(["ab", "-ab", "ab-", "A-bc", "a_b", "a".repeat(41), ""])("rejects %j", (s) => expect(isValidSlug(s)).toBe(false));
  it.each(["abc", "a-b", "a1-b2", "a".repeat(40)])("accepts %j", (s) => expect(isValidSlug(s)).toBe(true));
});
