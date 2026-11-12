import { describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { id } from "@/i18n/id";
import { cartReducer, itemCount, itemsSubtotal, loadStored, lineKey, parseStored, revalidate, saveStored, storageKey, type StoredLine } from "./cart";
import { dayRange, localParts, openStatus, rangesLabel, statusText, weekSummary } from "./hours";
import { storefrontBase, storefrontHref } from "./links";
import { cleanNote, clampQty, findItem, needsOptions, unitPrice, validateSelection, type PublicItem, type PublicMenu } from "./menu-model";
import { orderingState } from "./ordering-state";

const item = (o: Partial<PublicItem> = {}): PublicItem => ({ id: "i1", name: "Nasi", description: null, imageUrl: null, dietaryTags: [], price: 35000, soldOut: false, variants: [], modifierGroups: [], ...o });
const soto = item({
  id: "i2", name: "Soto", price: 30000,
  variants: [{ id: "v1", name: "Regular", priceDelta: 0 }, { id: "v2", name: "Large", priceDelta: 8000 }],
  modifierGroups: [
    { id: "g1", name: "Spice", minSelect: 1, maxSelect: 1, modifiers: [{ id: "m1", name: "Mild", priceDelta: 0 }, { id: "m2", name: "Hot", priceDelta: 0 }] },
    { id: "g2", name: "Extras", minSelect: 0, maxSelect: 2, modifiers: [{ id: "m3", name: "Egg", priceDelta: 5000 }, { id: "m4", name: "Krupuk", priceDelta: 3000 }, { id: "m5", name: "Chicken", priceDelta: 12000 }] },
  ],
});
const menu = (items: PublicItem[]): PublicMenu => ({ currency: "IDR", categories: [{ id: "c1", name: "Mains", description: null, items }] });
const none = { variantId: null, modifierIds: [] };

describe("modifier and variant rules", () => {
  it("an item with no options needs none", () => {
    expect(needsOptions(item())).toBe(false);
    expect(needsOptions(soto)).toBe(true);
    expect(validateSelection(item(), none)).toEqual([]);
  });
  it("requires a variant when the item has variants, and rejects unknown ones", () => {
    expect(validateSelection(soto, { variantId: null, modifierIds: ["m1"] })).toContainEqual({ kind: "variant_required" });
    expect(validateSelection(soto, { variantId: "nope", modifierIds: ["m1"] })).toContainEqual({ kind: "variant_unknown" });
    expect(validateSelection(item(), { variantId: "v1", modifierIds: [] })).toContainEqual({ kind: "variant_unknown" });
  });
  it("enforces each group's min and max", () => {
    expect(validateSelection(soto, { variantId: "v1", modifierIds: [] })).toContainEqual({ kind: "group_min", groupId: "g1", min: 1 });
    expect(validateSelection(soto, { variantId: "v1", modifierIds: ["m1", "m2"] })).toContainEqual({ kind: "group_max", groupId: "g1", max: 1 });
    expect(validateSelection(soto, { variantId: "v1", modifierIds: ["m1", "m3", "m4", "m5"] })).toContainEqual({ kind: "group_max", groupId: "g2", max: 2 });
    expect(validateSelection(soto, { variantId: "v2", modifierIds: ["m2", "m3", "m4"] })).toEqual([]);
  });
  it("rejects unknown and repeated modifiers", () => {
    expect(validateSelection(soto, { variantId: "v1", modifierIds: ["m1", "zzz"] })).toContainEqual({ kind: "modifier_unknown" });
    expect(validateSelection(soto, { variantId: "v1", modifierIds: ["m1", "m1"] })).toContainEqual({ kind: "modifier_duplicate" });
  });
  it("prices one unit from item + variant + modifiers, never below 0", () => {
    expect(unitPrice(soto, { variantId: "v2", modifierIds: ["m2", "m3"] })).toBe(30000 + 8000 + 5000);
    expect(unitPrice(item({ price: 1000, variants: [{ id: "v", name: "Deal", priceDelta: -5000 }] }), { variantId: "v", modifierIds: [] })).toBe(0);
    expect(unitPrice(soto, { variantId: "ghost", modifierIds: ["ghost"] })).toBe(30000); // ids not on the item add nothing
  });
  it("clamps quantity and cleans notes", () => {
    expect(clampQty(0)).toBe(1);
    expect(clampQty(500)).toBe(20);
    expect(clampQty(NaN)).toBe(1);
    expect(clampQty(3.9)).toBe(3);
    expect(cleanNote("  no\u0000 chili\n\n please  ")).toBe("no chili please");
    expect(cleanNote("x".repeat(500))).toHaveLength(200);
  });
  it("finds an item anywhere in the menu", () => {
    expect(findItem(menu([item(), soto]), "i2")?.name).toBe("Soto");
    expect(findItem(menu([item()]), "nope")).toBeUndefined();
  });
});

describe("cart reducer", () => {
  const sel = { variantId: "v2", modifierIds: ["m3", "m2"] };
  it("merges identical lines (modifier order does not matter) and keeps different ones apart", () => {
    let s = cartReducer([], { type: "add", item: soto, selection: sel, note: "", qty: 1 });
    s = cartReducer(s, { type: "add", item: soto, selection: { ...sel, modifierIds: ["m2", "m3"] }, note: "", qty: 2 });
    expect(s).toHaveLength(1);
    expect(s[0].qty).toBe(3);
    s = cartReducer(s, { type: "add", item: soto, selection: sel, note: "extra hot", qty: 1 });
    expect(s).toHaveLength(2);
  });
  it("never adds a sold-out item or an invalid selection", () => {
    expect(cartReducer([], { type: "add", item: item({ soldOut: true }), selection: none, note: "", qty: 1 })).toEqual([]);
    expect(cartReducer([], { type: "add", item: soto, selection: none, note: "", qty: 1 })).toEqual([]);
  });
  it("changes quantity (0 removes, capped), removes and clears", () => {
    const s = cartReducer([], { type: "add", item: item(), selection: none, note: "", qty: 2 });
    const key = lineKey(s[0]);
    expect(cartReducer(s, { type: "setQty", key, qty: 99 })[0].qty).toBe(20);
    expect(cartReducer(s, { type: "setQty", key, qty: 0 })).toEqual([]);
    expect(cartReducer(s, { type: "remove", key })).toEqual([]);
    expect(cartReducer(s, { type: "clear" })).toEqual([]);
  });
});

describe("cart re-validation against the current menu", () => {
  const stored = (o: Partial<StoredLine> = {}): StoredLine => ({ itemId: "i1", variantId: null, modifierIds: [], note: "", qty: 1, ...o });
  it("prices every line from the CURRENT menu, never from storage", () => {
    const r = revalidate([stored({ qty: 2 })], menu([item({ price: 40000 })]));
    expect(r.lines[0].unitPrice).toBe(40000);
    expect(itemsSubtotal(r.lines)).toBe(80000);
    expect(r.dropped).toEqual([]);
  });
  it("drops removed, sold-out and no-longer-valid items and says why", () => {
    const r = revalidate(
      [stored({ itemId: "gone" }), stored({ itemId: "sold" }), stored({ itemId: "i2", variantId: "v1", modifierIds: ["m1"] }), stored()],
      menu([item(), item({ id: "sold", name: "Sate", soldOut: true }), { ...soto, modifierGroups: [{ ...soto.modifierGroups[0], minSelect: 2, modifiers: [...soto.modifierGroups[0].modifiers, { id: "m9", name: "Extra", priceDelta: 0 }] }] }]),
    );
    expect(r.lines.map((l) => l.itemId)).toEqual(["i1"]);
    expect(r.dropped).toEqual([
      { itemId: "gone", name: null, reason: "unavailable" },
      { itemId: "sold", name: "Sate", reason: "sold_out" },
      { itemId: "i2", name: "Soto", reason: "options_changed" },
    ]);
  });
  it("merges lines that became identical, and totals items", () => {
    const r = revalidate([stored({ qty: 2 }), stored({ qty: 3 })], menu([item()]));
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].qty).toBe(5);
    expect(itemCount(r.lines)).toBe(5);
  });
});

describe("cart persistence is safe", () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }; };
  it("is keyed per tenant AND location", () => {
    expect(storageKey("demo", "l1")).not.toBe(storageKey("demo", "l2"));
    expect(storageKey("demo", "l1")).not.toBe(storageKey("other", "l1"));
    const s = mem();
    saveStored("demo", "l1", [{ itemId: "i1", variantId: null, modifierIds: [], note: "", qty: 2 }], s);
    expect(loadStored("demo", "l1", s)).toHaveLength(1);
    expect(loadStored("demo", "l2", s)).toEqual([]);
    expect(loadStored("other", "l1", s)).toEqual([]);
  });
  it("stores ids only: no name and no price in what is written", () => {
    const s = mem();
    saveStored("demo", "l1", [{ itemId: "i1", variantId: null, modifierIds: [], note: "no chili", qty: 1 }], s);
    const raw = s.m.get(storageKey("demo", "l1"))!;
    expect(raw).not.toMatch(/price|name|Rp|35000/i);
  });
  it("an empty cart removes the key", () => {
    const s = mem();
    saveStored("demo", "l1", [{ itemId: "i1", variantId: null, modifierIds: [], note: "", qty: 1 }], s);
    saveStored("demo", "l1", [], s);
    expect(s.m.size).toBe(0);
  });
  it("never throws when storage throws (private window, blocked, quota)", () => {
    const bad = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("quota"); }, removeItem: () => { throw new Error("denied"); } };
    expect(loadStored("demo", "l1", bad)).toEqual([]);
    expect(() => saveStored("demo", "l1", [{ itemId: "i1", variantId: null, modifierIds: [], note: "", qty: 1 }], bad)).not.toThrow();
    expect(loadStored("demo", "l1", null)).toEqual([]);
  });
  it("a corrupt or hand-edited value yields a clean cart, not a crash", () => {
    for (const raw of [null, "", "not json", "{}", "[1,2]", '[{"itemId":5}]', '[{"itemId":"a","variantId":null,"modifierIds":"x","note":"","qty":1}]']) expect(parseStored(raw)).toEqual([]);
    const ok = parseStored(JSON.stringify([{ itemId: "a", variantId: null, modifierIds: ["z", "b"], note: " hi\u0000 ", qty: 999 }, { itemId: "bad" }]));
    expect(ok).toEqual([{ itemId: "a", variantId: null, modifierIds: ["b", "z"], note: "hi", qty: 20 }]);
  });
});

describe("opening hours in the location's timezone", () => {
  const THU_1030_JKT = new Date("2026-11-12T03:30:00Z"); // 10:30 Thursday in Asia/Jakarta (UTC+7), 03:30 UTC
  const rows = [
    ...[1, 2, 3, 4, 5].map((day) => ({ day, opens: 10 * 60, closes: 22 * 60 })),
    { day: 6, opens: 10 * 60, closes: 24 * 60 },
    { day: 0, opens: 12 * 60, closes: 20 * 60 },
  ];
  it("reads weekday and minutes in the zone, not the server's", () => {
    expect(localParts(THU_1030_JKT, "Asia/Jakarta")).toEqual({ day: 4, minutes: 10 * 60 + 30 });
    expect(localParts(THU_1030_JKT, "UTC")).toEqual({ day: 4, minutes: 3 * 60 + 30 });
    expect(localParts(new Date("2026-11-12T20:00:00Z"), "Asia/Jakarta")).toEqual({ day: 5, minutes: 3 * 60 }); // already Friday there
  });
  it("an invalid timezone falls back to UTC and never throws", () => {
    expect(() => localParts(THU_1030_JKT, "Not/AZone")).not.toThrow();
    expect(localParts(THU_1030_JKT, "Not/AZone")).toEqual({ day: 4, minutes: 3 * 60 + 30 });
  });
  it("open now: says until when", () => {
    expect(openStatus(rows, true, THU_1030_JKT, "Asia/Jakarta")).toEqual({ kind: "open", until: "22:00" });
  });
  it("closed before opening: opens today; after closing: next opening", () => {
    const early = new Date("2026-11-12T00:00:00Z"); // 07:00 Jakarta
    expect(openStatus(rows, false, early, "Asia/Jakarta")).toEqual({ kind: "closed", opensAt: "10:00", opensToday: true });
    const late = new Date("2026-11-12T16:00:00Z"); // 23:00 Thursday Jakarta
    expect(openStatus(rows, false, late, "Asia/Jakarta")).toEqual({ kind: "closed", opensAt: "10:00", opensToday: false });
  });
  it("the server's openNow is authoritative; no hours means not limited by hours", () => {
    expect(openStatus([], true, THU_1030_JKT, "Asia/Jakarta")).toEqual({ kind: "no_hours" });
    expect(openStatus([], false, THU_1030_JKT, "Asia/Jakarta")).toEqual({ kind: "no_hours" });
    expect(openStatus(rows, false, THU_1030_JKT, "Asia/Jakarta").kind).toBe("closed"); // server says closed even though hours say open
  });
  it("splits and after-midnight hours are separate rows", () => {
    expect(rangesLabel([{ day: 5, opens: 600, closes: 840 }, { day: 5, opens: 1020, closes: 1320 }])).toBe("10:00–14:00, 17:00–22:00");
    expect(rangesLabel([])).toBeNull();
    expect(openStatus([{ day: 4, opens: 1080, closes: 1440 }, { day: 5, opens: 0, closes: 120 }], true, new Date("2026-11-12T12:00:00Z"), "Asia/Jakarta"))
      .toEqual({ kind: "open", until: "24:00" === "24:00" ? "00:00" : "" }); // 19:00 Thu, row closes at 24:00 -> shown as 00:00
  });
  it("summarises the week, merging identical consecutive days, in both languages", () => {
    const week = weekSummary(rows, en.storefront.hours);
    expect(week).toEqual([
      { days: [1, 2, 3, 4, 5], label: "10:00–22:00" },
      { days: [6], label: "10:00–00:00" },
      { days: [0], label: "12:00–20:00" },
    ]);
    expect(dayRange([1, 2, 3, 4, 5], en.storefront.hours)).toBe("Mon–Fri");
    expect(dayRange([1, 2, 3, 4, 5], id.storefront.hours)).toBe("Sen–Jum");
    expect(weekSummary([], en.storefront.hours)).toEqual([{ days: [1, 2, 3, 4, 5, 6, 0], label: "Closed" }]);
  });
  it("words the status in id and en", () => {
    expect(statusText({ kind: "open", until: "22:00" }, en.storefront.hours)).toBe("Open now · until 22:00");
    expect(statusText({ kind: "open", until: "22:00" }, id.storefront.hours)).toBe("Buka sekarang · sampai 22:00");
    expect(statusText({ kind: "closed", opensAt: "10:00", opensToday: true }, id.storefront.hours)).toBe("Tutup · buka pukul 10:00");
    expect(statusText({ kind: "no_hours" }, en.storefront.hours)).toBeNull();
  });
});

describe("ordering unavailable states", () => {
  const o = (qr: boolean, online: boolean, accepting: boolean) => ({ ordering: { qr, online, accepting } });
  it("available / paused / off", () => {
    expect(orderingState(o(true, false, true))).toBe("available");
    expect(orderingState(o(false, true, true))).toBe("available");
    expect(orderingState(o(true, true, false))).toBe("paused");
    expect(orderingState(o(false, false, true))).toBe("off");
    expect(orderingState(o(false, false, false))).toBe("off"); // off wins over paused: there is nothing to resume
  });
});

describe("links for both ways in", () => {
  const env = { rootDomain: "restomate.app", allowLocalhost: true };
  it("tenant host: no base; path access: /s/{slug}", () => {
    expect(storefrontBase("demo.restomate.app", "demo", env)).toBe("");
    expect(storefrontBase("demo.localhost:3000", "demo", env)).toBe("");
    expect(storefrontBase("localhost:3000", "demo", env)).toBe("/s/demo");
    expect(storefrontBase("restomate.app", "demo", env)).toBe("/s/demo");
    expect(storefrontBase("other.restomate.app", "demo", env)).toBe("/s/demo"); // a host for a different tenant never shortens our links
    expect(storefrontBase(null, "demo", env)).toBe("/s/demo");
  });
  it("builds hrefs: no prefix for Bahasa, /en for English, query encoded", () => {
    expect(storefrontHref("", "id")).toBe("/");
    expect(storefrontHref("", "en")).toBe("/en");
    expect(storefrontHref("/s/demo", "id")).toBe("/s/demo");
    expect(storefrontHref("/s/demo", "en", { location: "abc" })).toBe("/s/demo/en?location=abc");
    expect(storefrontHref("", "id", { location: "a b&c", x: undefined })).toBe("/?location=a%20b%26c");
  });
});
