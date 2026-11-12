"use client";

import Link from "next/link";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { formatMoney } from "@/lib/money";
import { cartReducer, emptyCart, loadCart, saveCart } from "./cart";
import { CartPanel } from "./CartPanel";
import { ItemSheet } from "./ItemSheet";
import { OfflineBanner } from "./OfflineBanner";
import { needsSheet, type PosCatalog, type PosItem } from "./pos-model";
import { useOnline } from "./use-online";

export function PosScreen({ catalog, orgSlug, locationId, locationName }: { catalog: PosCatalog; orgSlug: string; locationId: string; locationName: string }) {
  const [cart, dispatch] = useReducer(cartReducer, emptyCart);
  // 0 = not restored yet, 1 = restore dispatched (the same commit still holds the empty cart), 2 = safe to persist.
  const phase = useRef<0 | 1 | 2>(0);
  const [categoryId, setCategoryId] = useState(catalog.categories[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [sheetItem, setSheetItem] = useState<PosItem | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const online = useOnline();

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
        <span data-slot="connection" className="flex min-h-12 items-center gap-1 text-sm" aria-label={online ? "Online" : "Offline"}>
          <span aria-hidden>{online ? "●" : "○"}</span>{online ? "Online" : "Offline"}
        </span>
      </header>
      <OfflineBanner online={online} />

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
                  <li key={i.id}>
                    <button type="button" disabled={i.soldOut} aria-disabled={i.soldOut} onClick={() => tap(i)}
                      className="flex min-h-24 w-full flex-col items-start justify-between gap-1 rounded-xl p-3 text-left ring-1 ring-neutral-300 hover:bg-neutral-50 disabled:opacity-60 dark:ring-neutral-700 dark:hover:bg-neutral-900">
                      <span className="font-medium break-words">{i.name}</span>
                      <span className="flex w-full items-center justify-between gap-2 text-sm">
                        <span className="tabular-nums">{formatMoney(i.price, catalog.currency)}</span>
                        {i.soldOut ? <span className="rounded bg-neutral-200 px-2 py-0.5 text-xs font-semibold text-neutral-900 dark:bg-neutral-700 dark:text-neutral-100">Sold out</span>
                          : needsSheet(i) ? <span aria-hidden className="text-xs">Options ›</span> : null}
                      </span>
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

      {sheetItem ? (
        <ItemSheet key={sheetItem.id} item={sheetItem} currency={catalog.currency} onClose={() => setSheetItem(null)}
          onAdd={(selection, note, qty) => { dispatch({ type: "add", item: sheetItem, selection, note, qty }); setSheetItem(null); }} />
      ) : null}
    </div>
  );
}
