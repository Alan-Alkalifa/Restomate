"use client";

import { useEffect, useMemo, useReducer, useState } from "react";
import { fmt } from "@/i18n/config";
import type { StorefrontDictionary } from "@/i18n/types";
import { formatMoney } from "@/lib/money";
import { STOREFRONT_EVENTS, track } from "./analytics";
import { cartReducer, itemCount, itemsSubtotal, loadStored, revalidate, saveStored, type CartAction, type Dropped, type StoredLine } from "./cart";
import { CartSheet } from "./CartSheet";
import { ItemSheet } from "./ItemSheet";
import { needsOptions, type LocationInfo, type PublicItem, type PublicMenu, type Selection } from "./menu-model";
import { orderingState } from "./ordering-state";

type State = { lines: StoredLine[]; dropped: Dropped[]; ready: boolean };
type Action = CartAction | { type: "restored"; lines: StoredLine[]; dropped: Dropped[] } | { type: "dismissDropped" };

function reducer(s: State, a: Action): State {
  if (a.type === "restored") return { lines: a.lines, dropped: a.dropped, ready: true };
  if (a.type === "dismissDropped") return { ...s, dropped: [] };
  return { ...s, lines: cartReducer(s.lines, a) };
}

type Props = {
  t: StorefrontDictionary; tenant: string; location: { id: string; name: string }; menu: PublicMenu; info: LocationInfo;
};

export function MenuView({ t, tenant, location, menu, info }: Props) {
  const [state, dispatch] = useReducer(reducer, { lines: [], dropped: [], ready: false });
  const [sheetItem, setSheetItem] = useState<PublicItem | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const ordering = orderingState(info);
  const canAdd = ordering === "available";
  const { currency } = menu;

  // Restore the cart after mount (localStorage does not exist while rendering on the server), re-validated against the
  // CURRENT menu: removed / sold-out / changed items are dropped and reported, prices always come from the menu.
  useEffect(() => {
    const r = revalidate(loadStored(tenant, location.id), menu);
    dispatch({ type: "restored", lines: r.lines.map(({ itemId, variantId, modifierIds, note, qty }) => ({ itemId, variantId, modifierIds, note, qty })), dropped: r.dropped });
  }, [tenant, location.id, menu]);
  useEffect(() => {
    if (state.ready) saveStored(tenant, location.id, state.lines);
  }, [state.ready, state.lines, tenant, location.id]);
  useEffect(() => {
    track(STOREFRONT_EVENTS.menuViewed, { tenant, locationId: location.id, categories: menu.categories.length });
  }, [tenant, location.id, menu.categories.length]);

  const priced = useMemo(() => revalidate(state.lines, menu).lines, [state.lines, menu]);
  const count = itemCount(priced);

  const open = (item: PublicItem) => {
    if (item.soldOut) return;
    // Items with nothing to choose go straight to the cart; the rest open the detail sheet.
    if (needsOptions(item) || !canAdd) setSheetItem(item);
    else add(item, { variantId: null, modifierIds: [] }, "", 1);
  };
  const add = (item: PublicItem, selection: Selection, note: string, qty: number) => {
    dispatch({ type: "add", item, selection, note, qty });
    track(STOREFRONT_EVENTS.itemAdded, { tenant, locationId: location.id, itemId: item.id, quantity: qty, hasVariant: selection.variantId !== null, modifiers: selection.modifierIds.length });
    setSheetItem(null);
  };

  return (
    <>
      {ordering !== "available" ? (
        <p role="status" className="mb-4 rounded-lg bg-amber-100 p-3 text-amber-950" data-ordering={ordering}>{t.ordering[ordering]}</p>
      ) : null}
      {state.dropped.length > 0 ? (
        <div role="status" className="mb-4 rounded-lg bg-amber-100 p-3 text-amber-950">
          <ul className="list-disc pl-5">
            {state.dropped.map((d, i) => <li key={`${d.itemId}-${i}`}>{fmt(t.cart.dropped[d.reason], { name: d.name ?? "" })}</li>)}
          </ul>
          <button type="button" onClick={() => dispatch({ type: "dismissDropped" })} className="mt-1 min-h-12 underline">{t.item.close}</button>
        </div>
      ) : null}

      <nav aria-label={t.menu.categories} className="sticky top-0 z-10 -mx-4 mb-4 overflow-x-auto border-b border-neutral-200 bg-white px-4">
        <ul className="flex gap-2 py-2">
          {menu.categories.map((c) => (
            <li key={c.id}><a href={`#cat-${c.id}`} className="flex min-h-12 items-center whitespace-nowrap rounded-full px-4 font-medium ring-1 ring-neutral-300 hover:bg-neutral-50">{c.name}</a></li>
          ))}
        </ul>
      </nav>

      {menu.categories.length === 0 ? <p role="status" className="rounded-lg border border-dashed border-neutral-400 p-6 text-center">{t.menu.empty}</p> : null}
      {menu.categories.map((c) => (
        <section key={c.id} id={`cat-${c.id}`} aria-labelledby={`h-${c.id}`} className="mb-8 scroll-mt-20">
          <h2 id={`h-${c.id}`} className="text-xl font-bold">{c.name}</h2>
          {c.description ? <p className="mb-2 text-sm text-neutral-700">{c.description}</p> : null}
          <ul className="mt-2 flex flex-col gap-3">
            {c.items.map((i) => (
              <li key={i.id} data-item-id={i.id} data-sold-out={i.soldOut || undefined}>
                <button type="button" onClick={() => open(i)} disabled={i.soldOut} aria-disabled={i.soldOut}
                  className={`flex min-h-20 w-full items-center justify-between gap-3 rounded-xl p-3 text-left ring-1 ring-neutral-300 hover:bg-neutral-50 disabled:cursor-not-allowed ${i.soldOut ? "bg-neutral-100 opacity-70 grayscale" : ""}`}>
                  <span className="min-w-0">
                    <span className="block font-semibold break-words">{i.name}</span>
                    {i.description ? <span className="mt-0.5 block line-clamp-2 text-sm text-neutral-700">{i.description}</span> : null}
                    <span className="mt-1 block tabular-nums">{formatMoney(i.price, currency)}</span>
                  </span>
                  <span className="shrink-0 text-sm">
                    {i.soldOut
                      ? <span className="rounded bg-neutral-800 px-2 py-1 text-xs font-bold uppercase text-white">{t.menu.soldOut}</span>
                      : needsOptions(i) ? <span aria-hidden>{t.menu.options} ›</span> : canAdd ? <span className="flex size-12 items-center justify-center rounded-full bg-[var(--brand-primary)] text-2xl text-[var(--brand-on-primary)]" aria-label={`${t.menu.add} ${i.name}`}><span aria-hidden>+</span></span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <p className="mb-24 text-sm text-neutral-700">
        {t.menu.priceNote}
        {info.serviceChargeBps > 0 || info.taxRateBps > 0 ? <> {fmt(t.menu.rates, { service: `${info.serviceChargeBps / 100}%`, tax: `${info.taxRateBps / 100}%` })}</> : null}
      </p>

      {count > 0 || cartOpen ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-neutral-200 bg-white p-3 shadow-[0_-4px_12px_rgba(0,0,0,0.08)]">
          <button type="button" onClick={() => setCartOpen(true)} className="mx-auto flex min-h-14 w-full max-w-2xl items-center justify-between gap-3 rounded-xl bg-[var(--brand-primary)] px-4 text-lg font-bold text-[var(--brand-on-primary)]">
            <span>{fmt(t.cart.open, { count })}</span>
            <span className="tabular-nums">{formatMoney(itemsSubtotal(priced), currency)}</span>
          </button>
        </div>
      ) : null}

      {sheetItem ? <ItemSheet key={sheetItem.id} item={sheetItem} currency={currency} t={t} canAdd={canAdd} onAdd={(sel, note, qty) => add(sheetItem, sel, note, qty)} onClose={() => setSheetItem(null)} /> : null}
      {cartOpen ? (
        <CartSheet lines={priced} currency={currency} t={t} minOrderAmount={info.minOrderAmount} onClose={() => setCartOpen(false)}
          onQty={(key, qty) => dispatch({ type: "setQty", key, qty })} onRemove={(key) => dispatch({ type: "remove", key })} onClear={() => dispatch({ type: "clear" })}
          onCheckoutIntent={() => track(STOREFRONT_EVENTS.checkoutStarted, { tenant, locationId: location.id, items: count })} />
      ) : null}
    </>
  );
}
