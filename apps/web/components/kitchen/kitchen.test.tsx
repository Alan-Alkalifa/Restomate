import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { en } from "@/i18n/en";
import { id } from "@/i18n/id";
import type { KitchenDictionary } from "@/i18n/types";
import { KitchenBoard } from "./KitchenBoard";
import type { KdsPayload, KdsTicket } from "./kitchen-model";
import { TicketCard, type KitchenActions } from "./TicketCard";

vi.mock("./use-kitchen-feed", () => ({ useKitchenFeed: () => ({ connection: "connected", online: true, refreshing: false, refresh: () => {} }) }));

const noop = async () => ({ ok: true as const });
const actions: KitchenActions = { updateKotStatus: noop, bumpKot: noop, setKotItemStatus: noop };
const NOW = Date.parse("2026-11-12T10:30:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const ticket = (o: Partial<KdsTicket> = {}): KdsTicket => ({
  id: "t1", ticketNumber: 12, orderNumber: 40, tableLabel: "T3", stationId: "s1", status: "new", createdAt: ago(2),
  items: [
    { id: "i1", name: "Nasi Goreng", variantName: "Large", quantity: 2, modifiersText: "Extra spicy", note: "No peanuts", status: "pending" },
    { id: "i2", name: "Jus Alpukat", variantName: null, quantity: 1, modifiersText: "", note: null, status: "void" },
  ],
  ...o,
});
const card = (t: KdsTicket, canUpdate = true, dict: KitchenDictionary = en.kitchen) =>
  renderToStaticMarkup(<ul><TicketCard ticket={t} stationName="Kitchen" nowMs={NOW} canUpdate={canUpdate} actions={actions} onChanged={() => {}} t={dict} /></ul>);

describe("TicketCard", () => {
  it("shows ticket, order, table, items, variant, modifiers and note, with no prices", () => {
    const html = card(ticket());
    for (const s of ["Ticket 12", "Order 40", "Table T3", "Nasi Goreng", "Large", "Extra spicy", "No peanuts", "2×"]) expect(html).toContain(s);
    // React appends a small form-replay <script> (it contains "$$"): look at the markup only.
    expect(html.replace(/<script>[\s\S]*?<\/script>/g, "")).not.toMatch(/Rp|IDR|\$\d|price|harga|total/i);
  });
  it("labels a ticket with no table as takeaway, in both languages", () => {
    expect(card(ticket({ tableLabel: null }))).toContain("Takeaway");
    expect(card(ticket({ tableLabel: null }), true, id.kitchen)).toContain("Bawa pulang");
  });
  it("strikes void items through and does not make them tappable", () => {
    const html = card(ticket());
    expect(html).toContain("line-through");
    expect(html).toContain('data-item-status="void"');
    expect(html.match(/name="ticketItemId"/g)).toHaveLength(1); // only the pending item has a toggle
  });
  it("offers exactly the next KOT step for each status", () => {
    expect(card(ticket({ status: "new" }))).toContain("Start");
    expect(card(ticket({ status: "in_progress" }))).toContain("Mark ready");
    const ready = card(ticket({ status: "ready" }));
    expect(ready).toContain("Bump");
    expect(ready).not.toContain("Mark ready");
    expect(card(ticket({ status: "new" }))).not.toContain("Bump");
  });
  it("has no buttons at all without kitchen.update (the server refuses anyway)", () => {
    const html = card(ticket(), false);
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<form");
  });
  it("timer: amber from 10 min, red from 20 min, with a text label as well as colour", () => {
    expect(card(ticket({ createdAt: ago(9) }))).toContain('data-level="ok"');
    const amber = card(ticket({ createdAt: ago(10) }));
    expect(amber).toContain('data-level="amber"');
    expect(amber).toContain("10 min");
    expect(amber).toContain("Getting late");
    const red = card(ticket({ createdAt: ago(20) }));
    expect(red).toContain('data-level="red"');
    expect(red).toContain("20 min");
    expect(red).toContain("Late");
  });
  it("touch targets are at least 64px (min-h-16) on every control", () => {
    const html = card(ticket({ status: "ready" }));
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) expect(b).toContain("min-h-16");
  });
});

const payload = (tickets: KdsTicket[]): KdsPayload => ({ now: new Date(NOW).toISOString(), tickets });
const stations = [{ id: "s1", name: "Kitchen" }, { id: "s2", name: "Bar" }];
const langs = [{ id: "en", label: "English", href: "/x", current: true }, { id: "id", label: "Bahasa Indonesia", href: "/x?lang=id", current: false }];
const board = (tickets: KdsTicket[], o: { canUpdate?: boolean; dict?: KitchenDictionary } = {}) =>
  renderToStaticMarkup(
    <KitchenBoard payload={payload(tickets)} stations={stations} locationId="11111111-1111-4111-8111-111111111111" locationName="Kemang"
      canUpdate={o.canUpdate ?? true} actions={actions} t={o.dict ?? en.kitchen} languages={langs} />,
  );

describe("KitchenBoard", () => {
  it("empty state, in both languages", () => {
    expect(board([])).toContain("No tickets");
    expect(board([], { dict: id.kitchen })).toContain("Tidak ada pesanan");
  });
  it("lists tickets oldest first and counts per station", () => {
    const html = board([
      ticket({ id: "new", ticketNumber: 20, createdAt: ago(1), stationId: "s2" }),
      ticket({ id: "old", ticketNumber: 5, createdAt: ago(15), stationId: "s1" }),
    ]);
    expect(html.indexOf('data-ticket-id="old"')).toBeLessThan(html.indexOf('data-ticket-id="new"'));
    expect(html).toContain("All stations");
    expect(html).toContain("Kitchen");
    expect(html).toContain("Bar");
  });
  it("does not show bumped tickets", () => {
    const html = board([ticket({ id: "gone", status: "bumped" })]);
    expect(html).not.toContain('data-ticket-id="gone"');
    expect(html).toContain("No tickets");
  });
  it("marks a read-only screen for people without kitchen.update", () => {
    expect(board([ticket()], { canUpdate: false })).toContain("View only");
    expect(board([ticket()], { canUpdate: true })).not.toContain("View only");
  });
  it("has a status region that is always mounted, and no connection banner while live", () => {
    const html = board([ticket()]);
    expect(html).toContain('role="status"');
    expect(html).toContain('data-connection="live"');
  });
});
