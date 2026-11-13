import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import { id } from "@/i18n/id";
import type { PosDictionary } from "@/i18n/types";
import { cartReducer, emptyCart } from "./cart";
import { PosScreen } from "./PosScreen";
import { SoldOutSheetView, sheetView } from "./SoldOutSheet";
import type { PosCatalog, PosItem } from "./pos-model";

vi.mock("./use-pos-feed", () => ({ usePosFeed: () => ({ online: true, connection: "connected", refreshing: false, refresh: () => {} }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

const item = (o: Partial<PosItem> = {}): PosItem => ({ id: "11111111-1111-4111-8111-111111111111", categoryId: "c1", name: "Nasi Goreng", description: null, price: 35000, soldOut: false, variants: [], groups: [], ...o });
const catalog = (items: PosItem[]): PosCatalog => ({ currency: "IDR", categories: [{ id: "c1", name: "Mains" }], items });
const screen = (items: PosItem[], t: PosDictionary = en.pos, locale: "id" | "en" = "en") =>
  renderToStaticMarkup(<PosScreen catalog={catalog(items)} orgSlug="demo" locationId="loc-1" locationName="Main" t={t} locale={locale} toggleSoldOut={async () => ({ ok: true })} />);
const view = (o: { item?: PosItem; confirming?: boolean; online?: boolean; pending?: boolean; error?: string | null; t?: PosDictionary; locale?: "id" | "en" } = {}) =>
  renderToStaticMarkup(
    <SoldOutSheetView item={o.item ?? item()} t={o.t ?? en.pos} locale={o.locale ?? "en"} online={o.online ?? true} confirming={o.confirming ?? false} pending={o.pending ?? false}
      error={o.error ?? null} formAction={() => {}} onConfirm={() => {}} onBack={() => {}} onClose={() => {}} />,
  );

describe("the item grid", () => {
  it("each tile has a 48px overflow button next to it (never a button inside a button)", () => {
    const html = screen([item()]);
    expect(html).toContain('aria-label="More actions for Nasi Goreng"');
    expect(html).toContain("size-12");
    expect(html).not.toMatch(/<button(?:(?!<\/button>)[\s\S])*<button/); // no nested buttons
  });
  it("a sold-out tile is greyed, disabled, and shows the badge in English and Bahasa", () => {
    const sold = item({ soldOut: true });
    const e = screen([sold]);
    expect(e).toContain("Sold out");
    expect(e).toContain("data-sold-out");
    expect(e).toMatch(/<button[^>]*disabled=""[^>]*aria-disabled="true"|<button[^>]*aria-disabled="true"[^>]*disabled=""/);
    expect(e).toContain("grayscale");
    const i = screen([sold], id.pos, "id");
    expect(i).toContain("Habis");
    expect(i).toContain('aria-label="Tindakan lain untuk Nasi Goreng"');
  });
  it("an available tile has no badge", () => {
    expect(screen([item()])).not.toContain("Sold out");
  });
  it("offers a link to switch the language of the sold-out strings", () => {
    expect(screen([item()])).toContain('href="?lang=id"');
    expect(screen([item()], id.pos, "id")).toContain('href="?lang=en"');
  });
});

describe("the sold-out sheet", () => {
  it("picks the right view", () => {
    expect(sheetView(false, false)).toBe("choose");
    expect(sheetView(false, true)).toBe("confirm");
    expect(sheetView(true, false)).toBe("restore");
    expect(sheetView(true, true)).toBe("restore"); // an item already sold out can only be restored
  });
  it("step 1 offers 'Sold out today' and posts nothing yet", () => {
    const html = view();
    expect(html).toContain("Sold out today");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("name=\"itemId\"");
  });
  it("step 2 asks to confirm before marking sold out, and posts exactly itemId + soldOut=true", () => {
    const html = view({ confirming: true });
    expect(html).toContain("Mark Nasi Goreng as sold out?");
    expect(html).toContain("Mark sold out");
    expect(html).toContain('name="itemId" value="11111111-1111-4111-8111-111111111111"');
    expect(html).toContain('name="soldOut" value="true"');
    expect([...html.matchAll(/<input[^>]*name="([^"]+)"/g)].map((m) => m[1]).sort()).toEqual(["itemId", "soldOut"]); // no org or location id
  });
  it("marking available again is one tap: soldOut=false, no confirm step", () => {
    const html = view({ item: item({ soldOut: true }) });
    expect(html).toContain("Available again");
    expect(html).toContain('name="soldOut" value="false"');
    expect(html).not.toContain("as sold out?");
  });
  it("is fully translated", () => {
    const html = view({ confirming: true, t: id.pos, locale: "id" });
    for (const s of ["Tandai Nasi Goreng habis?", "Tandai habis", "Kembali"]) expect(html).toContain(s);
    expect(view({ item: item({ soldOut: true }), t: id.pos, locale: "id" })).toContain("Tersedia lagi");
    expect(view({ t: id.pos, locale: "id" })).toContain("Habis hari ini");
  });
  it("offline: the actions are disabled and it says why", () => {
    const html = view({ confirming: true, online: false });
    expect(html).toContain("You are offline");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled/);
  });
  it("shows a server error without closing", () => {
    expect(view({ confirming: true, error: "Could not update. Please try again." })).toContain('role="alert"');
  });
  it("every control is at least 48px tall", () => {
    for (const html of [view(), view({ confirming: true }), view({ item: item({ soldOut: true }) })]) {
      for (const b of html.match(/<button[^>]*>/g) ?? []) expect(b).toContain("min-h-12");
    }
  });
});

describe("a sold-out item can never be added", () => {
  it("the cart refuses it even if a stale item object is passed", () => {
    expect(cartReducer(emptyCart, { type: "add", item: item({ soldOut: true }), selection: { variantId: null, modifierIds: [] }, note: "", qty: 1 })).toBe(emptyCart);
  });
});
