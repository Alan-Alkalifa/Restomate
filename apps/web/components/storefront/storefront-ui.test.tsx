import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import { id } from "@/i18n/id";
import type { StorefrontDictionary } from "@/i18n/types";
import { CartSheet } from "./CartSheet";
import { HoursBlock } from "./HoursBlock";
import { ItemSheet } from "./ItemSheet";
import { LocationPicker } from "./LocationPicker";
import { MenuView } from "./MenuView";
import { StorefrontShell } from "./StorefrontShell";
import { revalidate, type CartLine } from "./cart";
import type { LocationInfo, PublicItem, PublicMenu } from "./menu-model";
import { onColor, storefrontCssVars } from "./theme";

vi.mock("./analytics", () => ({ STOREFRONT_EVENTS: { menuViewed: "storefront_menu_viewed", itemAdded: "storefront_item_added", checkoutStarted: "storefront_checkout_started" }, track: () => {} }));

const item = (o: Partial<PublicItem> = {}): PublicItem => ({ id: "i1", name: "Sate Ayam", description: "10 tusuk", imageUrl: null, dietaryTags: [], price: 32000, soldOut: false, variants: [], modifierGroups: [], ...o });
const nasi = item({
  id: "i2", name: "Nasi Goreng", price: 35000,
  variants: [{ id: "v1", name: "Biasa", priceDelta: 0 }, { id: "v2", name: "Besar", priceDelta: 8000 }],
  modifierGroups: [
    { id: "g1", name: "Pedas", minSelect: 1, maxSelect: 1, modifiers: [{ id: "m1", name: "Sedang", priceDelta: 0 }, { id: "m2", name: "Pedas", priceDelta: 0 }] },
    { id: "g2", name: "Tambahan", minSelect: 0, maxSelect: 2, modifiers: [{ id: "m3", name: "Telur", priceDelta: 5000 }, { id: "m4", name: "Kerupuk", priceDelta: 3000 }] },
  ],
});
const menu = (items: PublicItem[] = [item(), nasi, item({ id: "i3", name: "Soto", soldOut: true })]): PublicMenu => ({
  currency: "IDR", categories: [{ id: "c1", name: "Makanan", description: "Segar", items }, { id: "c2", name: "Minuman", description: null, items: [item({ id: "i4", name: "Es Teh", price: 8000 })] }],
});
const info = (o: Partial<LocationInfo> = {}): LocationInfo => ({
  name: "Kemang", currency: "IDR", timezone: "Asia/Jakarta", address: "Jl. A", city: "Jakarta", phone: "021", taxRateBps: 1000, serviceChargeBps: 500, taxOnServiceCharge: true,
  hours: [...[1, 2, 3, 4, 5].map((day) => ({ day, opens: 600, closes: 1320 })), { day: 6, opens: 600, closes: 1440 }, { day: 0, opens: 720, closes: 1200 }],
  openNow: true, ordering: { qr: true, online: false, accepting: true }, minOrderAmount: 0, ...o,
});
const view = (o: { t?: StorefrontDictionary; menu?: PublicMenu; info?: LocationInfo } = {}) =>
  renderToStaticMarkup(<MenuView t={o.t ?? id.storefront} tenant="demo" location={{ id: "l1", name: "Kemang" }} menu={o.menu ?? menu()} info={o.info ?? info()} />);

describe("branding is CSS variables only", () => {
  it("picks readable text on any brand colour", () => {
    expect(onColor("#0f766e")).toBe("#ffffff");
    expect(onColor("#ffffff")).toBe("#000000");
    expect(onColor("#ffe082")).toBe("#000000");
    expect(onColor("#111111")).toBe("#ffffff");
    expect(onColor("red")).toBe("#ffffff");
    expect(onColor("#12345")).toBe("#ffffff");
  });
  it("only sanitised colours and allow-listed fonts reach the style, plus the contrast colour", () => {
    const v = storefrontCssVars({ primaryColor: "#ffe082", secondaryColor: "javascript:alert(1)", font: "Comic Sans" });
    expect(v["--brand-primary"]).toBe("#ffe082");
    expect(v["--brand-on-primary"]).toBe("#000000");
    expect(v["--brand-secondary"]).toBe("#134e4a"); // invalid -> default
    expect(v["--brand-font"]).not.toContain("Comic");
  });
  it("the shell applies them on one wrapper, with the tenant's name and logo and NO Restomate admin chrome", () => {
    const html = renderToStaticMarkup(<StorefrontShell name="Warung <b>Maju</b>" logoUrl="https://cdn.example.com/l.png" cssVars={storefrontCssVars({ primaryColor: "#112233", secondaryColor: null, font: null })} locale="id" t={id.storefront} languageHref="/en">x</StorefrontShell>);
    expect(html).toContain("--brand-primary:#112233");
    expect(html).toContain("https://cdn.example.com/l.png");
    expect(html).toContain("Warung &lt;b&gt;Maju&lt;/b&gt;"); // escaped, never HTML
    expect(html).not.toMatch(/login|sign in|dashboard|admin/i);
  });
  it("links to the other language (a real navigation, with lang/hreflang) and offers a skip link", () => {
    const idHtml = renderToStaticMarkup(<StorefrontShell name="W" logoUrl={null} cssVars={{}} locale="id" t={id.storefront} languageHref="/s/demo/en">x</StorefrontShell>);
    expect(idHtml).toContain('href="/s/demo/en"');
    expect(idHtml).toContain('hrefLang="en"');
    expect(idHtml).toContain("English");
    expect(idHtml).toContain("Lewati ke menu");
    const enHtml = renderToStaticMarkup(<StorefrontShell name="W" logoUrl={null} cssVars={{}} locale="en" t={en.storefront} languageHref="/">x</StorefrontShell>);
    expect(enHtml).toContain("Bahasa Indonesia");
    expect(enHtml).toContain("Skip to the menu");
  });
});

describe("location picker", () => {
  const locs = [
    { id: "a0000000-0000-4000-8000-000000000001", name: "Kemang", address: "Jl. A", city: "Jakarta Selatan", phone: "021-1", timezone: "Asia/Jakarta" },
    { id: "a0000000-0000-4000-8000-000000000002", name: "Dago", address: null, city: "Bandung", phone: null, timezone: "Asia/Jakarta" },
  ];
  it("lists every active location with a link to its menu, for the way the guest arrived", () => {
    const tenantHost = renderToStaticMarkup(<LocationPicker locations={locs} base="" locale="id" t={id.storefront} />);
    expect(tenantHost).toContain('href="/?location=a0000000-0000-4000-8000-000000000001"');
    expect(tenantHost).toContain("Jakarta Selatan");
    expect(tenantHost).toContain("Bandung");
    expect(tenantHost).toContain("Pilih lokasi");
    const byPath = renderToStaticMarkup(<LocationPicker locations={locs} base="/s/demo" locale="en" t={en.storefront} />);
    expect(byPath).toContain('href="/s/demo/en?location=a0000000-0000-4000-8000-000000000002"');
    expect(byPath).toContain("Choose a location");
  });
  it("has an empty state", () => {
    expect(renderToStaticMarkup(<LocationPicker locations={[]} base="" locale="en" t={en.storefront} />)).toContain("No locations are listed yet.");
  });
});

describe("hours and open now (location timezone)", () => {
  const THU_1030 = new Date("2026-11-12T03:30:00Z"); // 10:30 Thursday in Jakarta
  it("open: until when, in both languages, and the weekly summary", () => {
    const e = renderToStaticMarkup(<HoursBlock info={info()} now={THU_1030} t={en.storefront} />);
    expect(e).toContain("Open now · until 22:00");
    expect(e).toContain("Mon–Fri");
    expect(e).toContain("10:00–22:00");
    const b = renderToStaticMarkup(<HoursBlock info={info()} now={THU_1030} t={id.storefront} />);
    expect(b).toContain("Buka sekarang · sampai 22:00");
    expect(b).toContain("Sen–Jum");
  });
  it("closed: when it opens (the server's openNow decides, the clock only chooses the words)", () => {
    const html = renderToStaticMarkup(<HoursBlock info={info({ openNow: false })} now={new Date("2026-11-12T00:00:00Z")} t={en.storefront} />);
    expect(html).toContain("Closed · opens at 10:00");
    expect(html).toContain('data-open="false"');
  });
  it("no hours listed: no status chip, says so", () => {
    expect(renderToStaticMarkup(<HoursBlock info={info({ hours: [] })} now={THU_1030} t={en.storefront} />)).toContain("Opening hours are not listed.");
  });
});

describe("the menu page", () => {
  it("shows categories, item prices as Rp, and a sold-out item disabled with its badge", () => {
    const html = view();
    for (const s of ["Makanan", "Minuman", "Rp 32.000", "Rp 35.000", "Rp 8.000", "Sate Ayam", "Es Teh"]) expect(html).toContain(s);
    expect(html).toContain('href="#cat-c1"');
    const soldOut = html.slice(html.indexOf('data-item-id="i3"'));
    expect(soldOut.slice(0, soldOut.indexOf("</li>"))).toMatch(/disabled=""/);
    expect(soldOut).toContain("Habis");
    expect(view({ t: en.storefront })).toContain("Sold out");
  });
  it("states that service charge and tax are added, with the location's rates", () => {
    expect(view()).toContain("Biaya layanan dan pajak ditambahkan saat checkout");
    expect(view()).toContain("Biaya layanan 5% · Pajak 10%");
    expect(view({ t: en.storefront })).toContain("Service charge 5% · Tax 10%");
  });
  it("items with options show it; simple items get a quick-add button", () => {
    const html = view();
    expect(html).toContain("Pilihan ›");
    expect(html).toContain('aria-label="Tambah Sate Ayam"');
  });
  it("paused / off: still browsable, with a notice, and no quick-add", () => {
    for (const [state, ordering] of [["paused", { qr: true, online: true, accepting: false }], ["off", { qr: false, online: false, accepting: true }]] as const) {
      const html = view({ info: info({ ordering }) });
      expect(html).toContain(`data-ordering="${state}"`);
      expect(html).toContain("Sate Ayam"); // the menu is still there
      expect(html).not.toContain('aria-label="Tambah Sate Ayam"');
    }
    expect(view({ t: en.storefront, info: info({ ordering: { qr: true, online: true, accepting: false } }) })).toContain("Ordering is paused right now.");
    expect(view({ t: en.storefront, info: info({ ordering: { qr: false, online: false, accepting: true } }) })).toContain("Ordering is not available here right now.");
  });
  it("an empty menu says so", () => {
    expect(view({ t: en.storefront, menu: { currency: "IDR", categories: [] } })).toContain("The menu is not available right now.");
  });
  it("starts with no cart bar (the cart is restored after mount) and has no staff or sign-in links", () => {
    const html = view();
    expect(html).not.toContain("Lihat keranjang");
    expect(html).not.toMatch(/\/login|\/signup|\/admin|dashboard/i);
  });
});

describe("item detail and modifier rules", () => {
  const sheet = (i: PublicItem, canAdd = true, t: StorefrontDictionary = en.storefront) =>
    renderToStaticMarkup(<ItemSheet item={i} currency="IDR" t={t} canAdd={canAdd} onAdd={() => {}} onClose={() => {}} />);
  it("shows variants as required and each group with its min/max rule", () => {
    const html = sheet(nasi);
    expect(html).toContain("Choose one");
    expect(html).toContain("Required · Choose 1"); // Pedas: min 1, max 1
    expect(html).toContain("Optional · Choose up to 2"); // Tambahan: min 0, max 2
    expect(html).toMatch(/type="radio"[^>]*name="g-g1"/); // single choice -> radios
    expect(html).toMatch(/type="checkbox"[^>]*name="g-g2"/); // up to 2 -> checkboxes
    expect(html).toContain("+Rp 8.000");
    expect(html).toContain("+Rp 5.000");
  });
  it("cannot add while the selection is incomplete (aria-disabled), and the total is the item price", () => {
    const html = sheet(nasi);
    expect(html).toMatch(/aria-disabled="true"[^>]*>Add to cart · Rp 35.000/);
  });
  it("an item with nothing to choose can be added straight away", () => {
    expect(sheet(item())).toMatch(/aria-disabled="false"[^>]*>Add to cart · Rp 32.000/);
  });
  it("ordering unavailable: the add button is truly disabled", () => {
    expect(sheet(item(), false)).toMatch(/<button[^>]*disabled=""[^>]*>Add to cart/);
  });
  it("is translated and keeps 48px targets", () => {
    const html = sheet(nasi, true, id.storefront);
    for (const s of ["Pilih satu", "Wajib · Pilih 1", "Opsional · Pilih maksimal 2", "Masukkan ke keranjang"]) expect(html).toContain(s);
    for (const b of html.match(/<button[^>]*>/g) ?? []) expect(b).toMatch(/size-12|min-h-12/);
  });
});

describe("the cart sheet", () => {
  const lines = (): CartLine[] => revalidate([{ itemId: "i2", variantId: "v2", modifierIds: ["m1", "m3"], note: "tanpa acar", qty: 2 }], menu()).lines;
  const cart = (l: CartLine[], t: StorefrontDictionary = en.storefront, minOrderAmount = 0) =>
    renderToStaticMarkup(<CartSheet lines={l} currency="IDR" t={t} minOrderAmount={minOrderAmount} onQty={() => {}} onRemove={() => {}} onClear={() => {}} onClose={() => {}} onCheckoutIntent={() => {}} />);
  it("lists lines with variant, modifiers and note, and the item subtotal re-derived from the menu", () => {
    const html = cart(lines());
    for (const s of ["Nasi Goreng · Besar", "Sedang, Telur", "tanpa acar", "Rp 96.000", "Items subtotal"]) expect(html).toContain(s);
  });
  it("says service charge and tax are added later, and that ordering is coming next (checkout disabled)", () => {
    const html = cart(lines());
    expect(html).toContain("Service charge and tax are added at checkout.");
    expect(html).toMatch(/aria-disabled="true"[^>]*>Send order/);
    expect(html).toContain("Ordering is coming next.");
    expect(cart(lines(), id.storefront)).toContain("Pemesanan segera hadir.");
  });
  it("empty state, no clear button; minimum order note when there is one", () => {
    const html = cart([]);
    expect(html).toContain("Your cart is empty.");
    expect(html).not.toContain("Clear cart");
    expect(cart(lines(), en.storefront, 50000)).toContain("Minimum order: Rp 50.000");
  });
  it("quantity and remove controls have names and 48px targets", () => {
    const html = cart(lines());
    for (const s of ['aria-label="More Nasi Goreng"', 'aria-label="Fewer Nasi Goreng"', 'aria-label="Remove Nasi Goreng"']) expect(html).toContain(s);
    for (const b of html.match(/<button[^>]*>/g) ?? []) expect(b).toMatch(/size-12|min-h-12/);
  });
});
