import { describe, expect, it } from "vitest";
import { mapMenuError } from "./errors";
import {
  createItemSchema, createModifierGroupSchema, MAX_LIST_JSON, MAX_MONEY, parseForm, saveGroupModifiersSchema,
  saveItemVariantsSchema, setLocationOverrideSchema, setItemActiveSchema, toggleSoldOutSchema,
} from "./schemas";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const form = (pairs: [string, string][]) => { const fd = new FormData(); for (const [k, v] of pairs) fd.append(k, v); return fd; };
const item = (extra: [string, string][] = [], price = "35000") =>
  parseForm(createItemSchema, form([["categoryId", U1], ["name", "Nasi Goreng"], ["basePrice", price], ...extra]), ["dietaryTags"]);

describe("createItemSchema", () => {
  it("parses a valid item; absent isPublished is false; empty description is null", () => {
    const r = item([["dietaryTags", "halal"], ["dietaryTags", "halal"], ["dietaryTags", "spicy"], ["description", "  "]]);
    expect(r.success && r.data).toMatchObject({ basePrice: 35000, isPublished: false, description: null, dietaryTags: ["halal", "spicy"] });
    expect(item([["isPublished", "true"]]).success && (item([["isPublished", "true"]]) as { data: { isPublished: boolean } }).data.isPublished).toBe(true);
  });
  it("money must be an integer within bounds", () => {
    for (const price of ["", "abc", "35.5", "-1", "1e3", "35.000", " ", "1000000000001", "9".repeat(20)]) expect(item([], price).success, price).toBe(false);
    expect(item([], "0").success).toBe(true);
    expect(item([], String(MAX_MONEY)).success).toBe(true);
    const r = item([], "35.5");
    expect(!r.success && r.error.issues[0]?.path[0]).toBe("basePrice");
  });
  it("rejects unknown tags, long names/descriptions and bad ids", () => {
    expect(item([["dietaryTags", "keto"]]).success).toBe(false);
    expect(item([["description", "x".repeat(501)]]).success).toBe(false);
    expect(item([["description", "x".repeat(500)]]).success).toBe(true);
    expect(parseForm(createItemSchema, form([["categoryId", "1 or 1=1"], ["name", "A"], ["basePrice", "1"]])).success).toBe(false);
    expect(parseForm(createItemSchema, form([["categoryId", U1], ["name", "x".repeat(81)], ["basePrice", "1"]])).success).toBe(false);
  });
  it("ignores an organization_id sent by the client", () => {
    const r = item([["organization_id", U2]]);
    expect(r.success && "organization_id" in r.data).toBe(false);
  });
});

describe("flags", () => {
  it("explicit flags must be sent and valid", () => {
    expect(parseForm(setItemActiveSchema, form([["itemId", U1]])).success).toBe(false);
    expect(parseForm(setItemActiveSchema, form([["itemId", U1], ["active", "yes"]])).success).toBe(false);
    const r = parseForm(setItemActiveSchema, form([["itemId", U1], ["active", "false"]]));
    expect(r.success && r.data.active).toBe(false);
    expect(parseForm(toggleSoldOutSchema, form([["itemId", U1], ["soldOut", "true"]])).success).toBe(true);
  });
});

describe("modifier groups", () => {
  const g = (min: string, max: string) => parseForm(createModifierGroupSchema, form([["name", "Level"], ["minSelect", min], ["maxSelect", max]]));
  it("min/max rules", () => {
    expect(g("0", "1").success).toBe(true);
    expect(g("2", "3").success).toBe(true);
    const bad = g("3", "2");
    expect(!bad.success && bad.error.issues[0]?.path[0]).toBe("maxSelect");
    expect(g("0", "0").success).toBe(false);
    expect(g("-1", "1").success).toBe(false);
    expect(g("0", "1.5").success).toBe(false);
    expect(g("", "1").success).toBe(false);
  });
});

describe("variants / modifiers JSON", () => {
  const v = (value: unknown) => parseForm(saveItemVariantsSchema, form([["itemId", U1], ["variants", typeof value === "string" ? value : JSON.stringify(value)]]));
  const m = (value: unknown) => parseForm(saveGroupModifiersSchema, form([["groupId", U1], ["modifiers", JSON.stringify(value)]]));
  it("accepts rows with or without ids, negative variant deltas, numeric or string prices", () => {
    const r = v([{ name: "Large", priceDelta: 5000 }, { id: U2, name: "Small", priceDelta: "-2000" }]);
    expect(r.success && r.data.variants).toEqual([{ name: "Large", priceDelta: 5000 }, { id: U2, name: "Small", priceDelta: -2000 }]);
    expect(v([]).success).toBe(true);
  });
  it("rejects malformed JSON, non-arrays, extra keys, bad money and duplicates with readable messages", () => {
    expect(v("{nope").success).toBe(false);
    expect(v({ name: "x" }).success).toBe(false);
    expect(v([{ name: "A", priceDelta: 1, organization_id: U2 }]).success).toBe(false);
    const noName = v([{ name: "A", priceDelta: 1 }, { name: "  ", priceDelta: 1 }]);
    expect(!noName.success && noName.error.issues[0]).toMatchObject({ path: ["variants"], message: "Variant 2: enter a name." });
    expect(v([{ name: "A", priceDelta: 1.5 }]).success).toBe(false);
    expect(v([{ name: "A", priceDelta: MAX_MONEY + 1 }]).success).toBe(false);
    expect(v([{ name: "A", priceDelta: -MAX_MONEY - 1 }]).success).toBe(false);
    expect(v([{ name: "A", priceDelta: 1 }, { name: "a", priceDelta: 2 }]).success).toBe(false);
    expect(v([{ id: U2, name: "A", priceDelta: 1 }, { id: U2, name: "B", priceDelta: 1 }]).success).toBe(false);
    expect(v([{ id: "x", name: "A", priceDelta: 1 }]).success).toBe(false);
  });
  it("modifier prices cannot be negative", () => {
    expect(m([{ name: "Cheese", priceDelta: 6000 }]).success).toBe(true);
    expect(m([{ name: "Cheese", priceDelta: -1 }]).success).toBe(false);
  });
  it("row caps (20 variants / 30 modifiers) and the size cap are enforced before parsing", () => {
    expect(v(Array.from({ length: 21 }, (_, i) => ({ name: `V${i}`, priceDelta: 0 }))).success).toBe(false);
    expect(v(Array.from({ length: 20 }, (_, i) => ({ name: `V${i}`, priceDelta: 0 }))).success).toBe(true);
    expect(m(Array.from({ length: 31 }, (_, i) => ({ name: `M${i}`, priceDelta: 0 }))).success).toBe(false);
    expect(m(Array.from({ length: 30 }, (_, i) => ({ name: `M${i}`, priceDelta: 0 }))).success).toBe(true);
    const huge = v(" ".repeat(MAX_LIST_JSON + 1) + "[]");
    expect(!huge.success && huge.error.issues[0]?.message).toBe("Too much data.");
  });
});

describe("setLocationOverrideSchema", () => {
  const o = (pairs: [string, string][]) => parseForm(setLocationOverrideSchema, form([["itemId", U1], ...pairs]));
  it("absent isAvailable is false; empty price/station mean clear", () => {
    const r = o([["priceOverride", ""], ["kitchenStationId", ""]]);
    expect(r.success && r.data).toMatchObject({ priceOverride: null, isAvailable: false, kitchenStationId: null });
    const r2 = o([["priceOverride", "26000"], ["isAvailable", "true"], ["kitchenStationId", U2]]);
    expect(r2.success && r2.data).toMatchObject({ priceOverride: 26000, isAvailable: true, kitchenStationId: U2 });
  });
  it("rejects non-integer, negative and out-of-range prices and bad station ids", () => {
    for (const p of ["26.5", "-5", "abc", "1000000000001"]) expect(o([["priceOverride", p]]).success, p).toBe(false);
    expect(o([["kitchenStationId", "nope"]]).success).toBe(false);
  });
});

describe("mapMenuError", () => {
  it("maps database errors without echoing raw text", () => {
    expect(mapMenuError({ code: "23505", message: "duplicate key ..." })).toMatchObject({ code: "DUPLICATE_NAME", fieldErrors: { name: [expect.any(String)] } });
    expect(mapMenuError({ code: "42501", message: "FORBIDDEN" })).toMatchObject({ code: "FORBIDDEN" });
    expect(mapMenuError({ message: "new row violates row-level security policy" })).toMatchObject({ code: "FORBIDDEN" });
    expect(JSON.stringify(mapMenuError({ message: "relation secret does not exist" }))).not.toContain("secret");
  });
});
