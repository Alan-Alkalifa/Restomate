"use client";

import Link from "next/link";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { formatMoney } from "@/lib/money";
import { fmt } from "@/i18n/config";
import type { PosDictionary } from "@/i18n/types";
import { cartReducer, emptyCart, loadCart, saveCart } from "./cart";
import { CartPanel } from "./CartPanel";
import { ItemSheet } from "./ItemSheet";
import { OfflineBanner } from "./OfflineBanner";
import { needsSheet, type PosCatalog, type PosItem } from "./pos-model";
import { SoldOutSheet, type ToggleSoldOutAction } from "./SoldOutSheet";
import { usePosFeed } from "./use-pos-feed";

type Props = {
  catalog: PosCatalog; orgSlug: string; locationId: string; locationName: string;
  /** Strings for the sold-out feature (the rest of the POS is English until it is translated). */
  t: PosDictionary; locale: "id" | "en";
  /** Bound on the server (orgSlug, locationId): the client sends only the item id and the new state. */
  toggleSoldOut: ToggleSoldOutAction;
};

export function PosScreen({ catalog, orgSlug, locationId, locationName, t, locale, toggleSoldOut }: Props) {
  const [cart, dispatch] = useReducer(cartReducer, emptyCart);
  // 0 = not restored yet, 1 = restore dispatched (the same commit still holds the empty cart), 2 = safe to persist.
  const phase = useRef<0 | 1 | 2>(0);
  const [categoryId, setCategoryId] = useState(catalog.categories[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [sheetItem, setSheetItem] = useState<PosItem | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const feed = usePosFeed(locationId);
  const online = feed.online;
  const reconnecting = online && feed.connection !== "connected";
  const [soldOutItem, setSoldOutItem] = useState<PosItem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Restore the cart after mount (localStorage is not available during server rendering).
  useEffect(() => {
    dispatch({ type: "replace", state: loadCart(locationId, catalog) });
    phase.current = 1;
  }, [locationId, catalog]);
  useEffect(() => {
    if (phase.current === 0) return;
    if (phase.current === 1) { phase.current = 2; return; } // skip the render that still has the empty cart, so it can't overwrite storage
    saveCart(locationId, cart);
  }, [locationId, cart]);

  // "/" focuses the item search (unless the user is already typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); search.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () => catalog.items.filter((i) => (q ? i.name.toLowerCase().includes(q) : i.categoryId === categoryId)),
    [catalog.items, q, categoryId],
  );

  // The confirmation fades after a few seconds (the status region stays mounted so it is announced).
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(id);
  }, [notice]);

  // The sheet holds a copy of the item from when it was opened. If a refresh says it is sold out meanwhile (another POS,
  // or this one), close the sheet: a sold-out item can never be added.
  const sheetNow = sheetItem ? catalog.items.find((i) => i.id === sheetItem.id) : undefined;
  if (sheetItem && (!sheetNow || sheetNow.soldOut)) setSheetItem(null);
  // Keep the open "sold out" dialog's item in step with the latest catalog (its label flips when the refresh arrives).
  const soldOutNow = soldOutItem ? catalog.items.find((i) => i.id === soldOutItem.id) : undefined;

  const tap = (item: PosItem) => {
    if (item.soldOut) return;
    if (needsSheet(item)) setSheetItem(item);
    else dispatch({ type: "add", item, selection: { variantId: null, modifierIds: [] }, note: "", qty: 1 });
  };

  return (
    // Full-screen, touch-first: this route group has no dashboard sidebar.
    <div className="fixed inset-0 flex flex-col bg-white text-neutral-950 dark:bg-neutral-950 dark:text-neutral-50">
      <header className="flex flex-wrap items-center gap-3 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
        <Link href={`/${orgSlug}`} className="flex min-h-12 items-center rounded-lg px-3 ring-1 ring-neutral-400">← Dashboard</Link>
        <p className="min-w-0 flex-1 truncate font-semibold">{locationName}</p>
        <label className="sr-only" htmlFor="pos-search">Search items</label>
        <input id="pos-search" ref={search} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search items  ( / )"
          className="min-h-12 w-48 rounded-lg border border-neutral-400 bg-transparent px-3 sm:w-64" />
        {/* Connection-status slot: Realtime/sync status joins here later. */}
        <span data-slot="connection" className="flex min-h-12 items-center gap-1 text-sm" aria-label={!online ? t.chip.offline : reconnecting ? t.chip.reconnecting : t.chip.online}>
          <span aria-hidden>{online && !reconnecting ? "●" : "○"}</span>{!online ? t.chip.offline : reconnecting ? t.chip.reconnecting : t.chip.online}
        </span>
        {/* A real navigation (not a client transition) so the translated strings follow the URL. */}
        <a href={`?lang=${locale === "id" ? "en" : "id"}`} lang={locale === "id" ? "en" : "id"} className="flex min-h-12 items-center rounded-lg px-3 text-sm underline" aria-label={t.language}>
          {locale === "id" ? t.switchTo.en : t.switchTo.id}
        </a>
      </header>
      <OfflineBanner online={online} />
      <div role="status" aria-live="polite" lang={locale}>
        {reconnecting ? <p className="bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-950"><span aria-hidden>⚠ </span>{t.reconnecting}</p> : null}
        {notice ? <p className="bg-green-100 px-4 py-2 text-center text-base font-semibold text-green-950">{notice}</p> : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="flex min-h-0 flex-1 flex-col">
          {q ? null : (
            <div role="tablist" aria-label="Categories" className="flex gap-2 overflow-x-auto border-b border-neutral-200 p-2 dark:border-neutral-800">
              {catalog.categories.map((c) => (
                <button key={c.id} role="tab" type="button" aria-selected={c.id === categoryId} onClick={() => setCategoryId(c.id)}
                  className={`min-h-12 shrink-0 rounded-lg px-4 font-medium ${c.id === categoryId ? "bg-teal-700 text-white" : "ring-1 ring-neutral-400"}`}>{c.name}</button>
              ))}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {catalog.items.length === 0 ? (
              <p role="status" className="rounded-lg border border-dashed border-neutral-400 p-8 text-center">No items are available at this location yet.</p>
            ) : visible.length === 0 ? (
              <p role="status" className="p-8 text-center">No items match &ldquo;{query}&rdquo;.</p>
            ) : (
              <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
                {visible.map((i) => (
                  <li key={i.id} className="relative" data-item-id={i.id} data-sold-out={i.soldOut || undefined}>
                    <button type="button" disabled={i.soldOut} aria-disabled={i.soldOut} onClick={() => tap(i)}
                      className={`flex min-h-24 w-full flex-col items-start justify-between gap-1 rounded-xl p-3 text-left ring-1 ring-neutral-300 hover:bg-neutral-50 disabled:opacity-60 dark:ring-neutral-700 dark:hover:bg-neutral-900 ${i.soldOut ? "bg-neutral-100 grayscale dark:bg-neutral-900" : ""}`}>
                      <span className="font-medium break-words pr-12">{i.name}</span>
                      <span className="flex w-full items-center justify-between gap-2 text-sm">
                        <span className="tabular-nums">{formatMoney(i.price, catalog.currency)}</span>
                        {i.soldOut ? <span lang={locale} className="rounded bg-neutral-800 px-2 py-0.5 text-xs font-bold uppercase text-white dark:bg-neutral-200 dark:text-neutral-900">{t.soldOutBadge}</span>
                          : needsSheet(i) ? <span aria-hidden className="text-xs">Options ›</span> : null}
                      </span>
                    </button>
                    {/* A sibling of the tile (never nested buttons): 48px target, opens "Sold out today" / "Available again". */}
                    <button type="button" onClick={() => setSoldOutItem(i)} lang={locale} aria-label={fmt(t.soldOut.more, { name: i.name })} aria-haspopup="dialog"
                      className="absolute right-1 top-1 flex size-12 items-center justify-center rounded-full text-2xl leading-none text-neutral-700 hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-teal-700 dark:text-neutral-200 dark:hover:bg-neutral-700">
                      <span aria-hidden>⋯</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <aside className="flex max-h-[50vh] min-h-0 flex-col border-t border-neutral-200 md:max-h-none md:w-96 md:border-l md:border-t-0 dark:border-neutral-800">
          <CartPanel cart={cart} currency={catalog.currency} dispatch={dispatch} />
        </aside>
      </div>

      {sheetItem && sheetNow && !sheetNow.soldOut ? (
        <ItemSheet key={sheetItem.id} item={sheetNow} currency={catalog.currency} onClose={() => setSheetItem(null)}
          onAdd={(selection, note, qty) => { dispatch({ type: "add", item: sheetNow, selection, note, qty }); setSheetItem(null); }} />
      ) : null}
      {soldOutItem && soldOutNow ? (
        <SoldOutSheet key={soldOutItem.id + String(soldOutNow.soldOut)} item={soldOutNow} t={t} locale={locale} online={online} action={toggleSoldOut}
          onClose={() => setSoldOutItem(null)}
          onDone={(message) => { setSoldOutItem(null); setNotice(message); feed.refresh(); }} />
      ) : null}
    </div>
  );
}
