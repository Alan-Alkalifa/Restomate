import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cartReducer, emptyCart, estimatedTotal, loadCart, sanitizeCart, saveCart } from "./cart";
import { CartPanel } from "./CartPanel";
import { ItemSheet } from "./ItemSheet";
import { OfflineBanner } from "./OfflineBanner";
import { PosScreen } from "./PosScreen";
import { buildCatalog, needsSheet, unitPrice, validateSelection, type PosCatalog, type PosItem } from "./pos-model";

vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

const mk = (o: Partial<PosItem> = {}): PosItem => ({ id: "i1", categoryId: "c1", name: "Nasi", description: null, price: 35000, soldOut: false, variants: [], groups: [], ...o });
const complex = mk({
  id: "i2", name: "Soto",
  variants: [{ id: "v1", name: "Regular", priceDelta: 0 }, { id: "v2", name: "Large", priceDelta: 8000 }],
  groups: [
    { id: "g1", name: "Spice", minSelect: 1, maxSelect: 1, modifiers: [{ id: "m1", name: "Mild", priceDelta: 0 }, { id: "m2", name: "Hot", priceDelta: 0 }] },
    { id: "g2", name: "Extras", minSelect: 0, maxSelect: 2, modifiers: [{ id: "m3", name: "Egg", priceDelta: 5000 }, { id: "m4", name: "Krupuk", priceDelta: 3000 }, { id: "m5", name: "Chicken", priceDelta: 12000 }] },
  ],
});
const catalog: PosCatalog = { currency: "IDR", categories: [{ id: "c1", name: "Mains" }], items: [mk(), complex, mk({ id: "i3", name: "Sate", soldOut: true })] };

describe("buildCatalog", () => {
  const menu = {
    currency: "IDR",
    categories: [
      { id: "c1", name: "Mains", description: null, sortOrder: 1, isActive: true, itemCount: 2 },
      { id: "c2", name: "Empty", description: null, sortOrder: 2, isActive: true, itemCount: 0 },
    ],
    items: [
      { id: "a", categoryId: "c1", name: "A", description: null, basePrice: 10, imagePath: null, dietaryTags: [], isPublished: true, isActive: true, sortOrder: 1, variants: [], modifierGroupIds: ["g"] },
      { id: "b", categoryId: "c1", name: "B", description: null, basePrice: 10, imagePath: null, dietaryTags: [], isPublished: true, isActive: true, sortOrder: 2, variants: [], modifierGroupIds: [] },
      { id: "c", categoryId: "c1", name: "C", description: null, basePrice: 10, imagePath: null, dietaryTags: [], isPublished: false, isActive: true, sortOrder: 3, variants: [], modifierGroupIds: [] },
    ],
    modifierGroups: [{ id: "g", name: "G", minSelect: 2, maxSelect: 2, sortOrder: 1, isActive: true, modifiers: [{ id: "m", name: "M", priceDelta: 0, sortOrder: 1, isActive: true }] }],
  };
  const row = (itemId: string, o = {}) => ({ itemId, categoryId: "c1", name: itemId, isPublished: true, isActive: true, basePrice: 10, priceOverride: 99, effectivePrice: 99, isAvailable: true, soldOutUntil: null, kitchenStationId: null, ...o });
  it("keeps only available items, uses the location price, flags sold out, drops empty categories and unsatisfiable groups", () => {
    const now = new Date("2026-11-10T00:00:00Z");
    const c = buildCatalog(menu, { rows: [row("a", { soldOutUntil: "2026-11-11T00:00:00Z" }), row("b", { isAvailable: false }), row("c")] }, now);
    expect(c.items.map((i) => i.id)).toEqual(["a"]); // b unavailable here, c unpublished
    expect(c.items[0]).toMatchObject({ price: 99, soldOut: true, groups: [] });
    expect(c.categories.map((x) => x.id)).toEqual(["c1"]);
    const past = buildCatalog(menu, { rows: [row("a", { soldOutUntil: "2026-11-09T00:00:00Z" })] }, now);
    expect(past.items[0].soldOut).toBe(false);
  });
});

describe("modifier validation", () => {
  it("requires a variant and enforces min/max", () => {
    expect(validateSelection(complex, { variantId: null, modifierIds: ["m1"] })).toContain("Choose a variant.");
    expect(validateSelection(complex, { variantId: "v1", modifierIds: [] })).toEqual(["Choose 1 option for Spice."]);
    expect(validateSelection(complex, { variantId: "v1", modifierIds: ["m1", "m3", "m4", "m5"] })).toEqual(["Choose at most 2 for Extras."]);
    expect(validateSelection(complex, { variantId: "v1", modifierIds: ["m1", "m2"] })).toEqual(["Choose at most 1 for Spice."]);
    expect(validateSelection(complex, { variantId: "v2", modifierIds: ["m2", "m3"] })).toEqual([]);
  });
  it("rejects unknown or duplicate options and variants on a plain item", () => {
    expect(validateSelection(complex, { variantId: "v1", modifierIds: ["m1", "zzz"] })).toContain("An option is not available.");
    expect(validateSelection(complex, { variantId: "v1", modifierIds: ["m1", "m1"] })).toContain("An option is not available.");
    expect(validateSelection(mk(), { variantId: "v1", modifierIds: [] })).toContain("This item has no variants.");
    expect(validateSelection(mk(), { variantId: null, modifierIds: [] })).toEqual([]);
  });
  it("prices a line without going negative", () => {
    expect(unitPrice(complex, { variantId: "v2", modifierIds: ["m2", "m3"] })).toBe(35000 + 8000 + 5000);
    expect(unitPrice(mk({ price: 1000, variants: [{ id: "v", name: "Deal", priceDelta: -5000 }] }), { variantId: "v", modifierIds: [] })).toBe(0);
    expect(needsSheet(mk())).toBe(false);
    expect(needsSheet(complex)).toBe(true);
  });
});

describe("cart reducer", () => {
  const sel = { variantId: "v2", modifierIds: ["m2", "m3"] };
  it("adds, merges identical lines and keeps different ones apart", () => {
    let s = cartReducer(emptyCart, { type: "add", item: complex, selection: sel, note: "", qty: 1 });
    s = cartReducer(s, { type: "add", item: complex, selection: { ...sel, modifierIds: ["m3", "m2"] }, note: "", qty: 2 });
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0].qty).toBe(3);
    s = cartReducer(s, { type: "add", item: complex, selection: sel, note: "no chili", qty: 1 });
    expect(s.lines).toHaveLength(2);
    expect(estimatedTotal(s)).toBe(48000 * 4);
  });
  it("never adds an invalid or sold-out line", () => {
    expect(cartReducer(emptyCart, { type: "add", item: complex, selection: { variantId: null, modifierIds: [] }, note: "", qty: 1 })).toBe(emptyCart);
    expect(cartReducer(emptyCart, { type: "add", item: mk({ soldOut: true }), selection: { variantId: null, modifierIds: [] }, note: "", qty: 1 })).toBe(emptyCart);
  });
  it("sets qty (0 removes, clamped), notes (re-merging), remove, clear and order type", () => {
    const plain = { variantId: null, modifierIds: [] };
    let s = cartReducer(emptyCart, { type: "add", item: mk(), selection: plain, note: "", qty: 1 });
    const key = s.lines[0].key;
    s = cartReducer(s, { type: "setQty", key, qty: 500 });
    expect(s.lines[0].qty).toBe(99);
    s = cartReducer(s, { type: "add", item: mk(), selection: plain, note: "x", qty: 1 });
    s = cartReducer(s, { type: "setNote", key: s.lines[1].key, note: "" }); // becomes identical to line 1
    expect(s.lines).toHaveLength(1);
    s = cartReducer(s, { type: "setOrderType", orderType: "takeaway" });
    expect(s.orderType).toBe("takeaway");
    expect(cartReducer(s, { type: "setQty", key, qty: 0 }).lines).toHaveLength(0);
    expect(cartReducer(s, { type: "remove", key }).lines).toHaveLength(0);
    expect(cartReducer(s, { type: "clear" }).lines).toHaveLength(0);
  });
});

describe("persistence", () => {
  afterEach(() => vi.unstubAllGlobals());
  const store = () => { const m = new Map<string, string>(); return { m, ls: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } }; };
  it("saves per location and restores against the catalog, re-reading prices", () => {
    const { m, ls } = store();
    vi.stubGlobal("window", { localStorage: ls });
    const s = cartReducer(emptyCart, { type: "add", item: complex, selection: { variantId: "v1", modifierIds: ["m1"] }, note: "hi", qty: 2 });
    saveCart("loc-1", s);
    expect([...m.keys()]).toEqual(["restomate:pos-cart:loc-1"]);
    const stored = JSON.parse(m.get("restomate:pos-cart:loc-1")!);
    stored.lines[0].unitPrice = 1; // a tampered or stale price
    m.set("restomate:pos-cart:loc-1", JSON.stringify(stored));
    const back = loadCart("loc-1", catalog);
    expect(back.lines[0]).toMatchObject({ qty: 2, note: "hi", unitPrice: 35000 });
    expect(loadCart("loc-2", catalog)).toEqual(emptyCart);
    saveCart("loc-1", emptyCart);
    expect(m.size).toBe(0);
  });
  it("is safe when storage throws or holds junk", () => {
    const boom = () => { throw new Error("blocked"); };
    vi.stubGlobal("window", { localStorage: { getItem: boom, setItem: boom, removeItem: boom } });
    expect(loadCart("l", catalog)).toEqual(emptyCart);
    expect(() => saveCart("l", cartReducer(emptyCart, { type: "add", item: mk(), selection: { variantId: null, modifierIds: [] }, note: "", qty: 1 }))).not.toThrow();
    const { ls } = store();
    ls.setItem("restomate:pos-cart:l", "{not json");
    vi.stubGlobal("window", { localStorage: ls });
    expect(loadCart("l", catalog)).toEqual(emptyCart);
  });
  it("drops gone, sold-out and invalid lines", () => {
    const raw = { orderType: "takeaway", lines: [
      { itemId: "nope", qty: 1 }, { itemId: "i3", qty: 1 }, { itemId: "i2", variantId: null, modifiers: [], qty: 1 }, { itemId: "i1", qty: 2 }, 5, null,
    ] };
    const s = sanitizeCart(raw, catalog);
    expect(s.orderType).toBe("takeaway");
    expect(s.lines.map((l) => l.itemId)).toEqual(["i1"]);
  });
});

describe("render", () => {
  const screen = renderToStaticMarkup(<PosScreen catalog={catalog} orgSlug="demo" locationId="loc-1" locationName="Main" />);
  it("shows the catalog, sold-out items disabled, no sidebar", () => {
    expect(screen).toContain("Mains");
    expect(screen).toContain("Rp 35.000");
    expect(screen).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*?Sold out/);
    expect(screen).toContain("Options");
    expect(screen).toContain('href="/demo"');
    expect(screen).not.toContain("Sidebar");
  });
  it("labels totals as estimated and keeps Send to kitchen disabled", () => {
    expect(screen).toContain("Estimated total");
    expect(screen).toMatch(/<button[^>]*disabled[^>]*>\s*Send to kitchen · Coming next/);
    expect(screen).toContain("The cart is empty");
    expect(screen).toContain("Dine-in");
    expect(screen).toContain("Takeaway");
  });
  it("cart panel lists lines with a note and stepper", () => {
    const s = cartReducer(emptyCart, { type: "add", item: complex, selection: { variantId: "v2", modifierIds: ["m2", "m3"] }, note: "", qty: 2 });
    const html = renderToStaticMarkup(<CartPanel cart={s} currency="IDR" dispatch={() => {}} />);
    expect(html).toContain("Soto · Large");
    expect(html).toContain("Hot, Egg");
    expect(html).toContain("Rp 96.000");
    expect(html).toContain("Cart <span");
  });
  it("sheet shows required markers and a disabled Add until valid", () => {
    const html = renderToStaticMarkup(<ItemSheet item={complex} currency="IDR" onClose={() => {}} onAdd={() => {}} />);
    expect(html).toContain("(required)");
    expect(html).toContain("Choose 1, required");
    expect(html).toContain("Up to 2");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled/);
  });
  it("offline banner appears only when offline", () => {
    expect(renderToStaticMarkup(<OfflineBanner online />)).not.toContain("Reconnecting");
    expect(renderToStaticMarkup(<OfflineBanner online={false} />)).toContain("Reconnecting");
  });
  it("names and notes render as text", () => {
    const evil = { ...catalog, items: [mk({ name: "<img src=x onerror=alert(1)>" })] };
    const html = renderToStaticMarkup(<PosScreen catalog={evil} orgSlug="d" locationId="l" locationName="<b>x</b>" />);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>x");
  });
});
