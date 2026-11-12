"use client";

import { useEffect, useRef } from "react";
import { fmt } from "@/i18n/config";
import type { StorefrontDictionary } from "@/i18n/types";
import { formatMoney } from "@/lib/money";
import { itemsSubtotal, type CartLine } from "./cart";

/**
 * The cart as a bottom sheet. Prices are item prices re-derived from the current menu; service charge and tax are NOT
 * included (the server adds them at checkout), and the totals line says so. Checkout is not available yet: the button is
 * disabled and says so (the QR landing, checkout and guest status come in a later task).
 */
export function CartSheet({ lines, currency, t, minOrderAmount, onQty, onRemove, onClear, onClose, onCheckoutIntent }: {
  lines: CartLine[]; currency: string; t: StorefrontDictionary; minOrderAmount: number;
  onQty: (key: string, qty: number) => void; onRemove: (key: string) => void; onClear: () => void; onClose: () => void; onCheckoutIntent: () => void;
}) {
  const s = t.cart;
  const closeRef = useRef<HTMLButtonElement>(null);
  const subtotal = itemsSubtotal(lines);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="cart-title" className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4">
      <div className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white text-neutral-900 shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-neutral-200 p-4">
          <h2 id="cart-title" className="text-xl font-bold">{s.heading}</h2>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={s.close} className="flex size-12 items-center justify-center rounded-full text-2xl hover:bg-neutral-100"><span aria-hidden>×</span></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {lines.length === 0 ? (
            <p role="status" className="py-8 text-center text-neutral-700">{s.empty}</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {lines.map((l) => (
                <li key={l.key} className="flex flex-col gap-2 border-b border-neutral-200 pb-4 last:border-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold break-words">{l.name}{l.variantName ? ` · ${l.variantName}` : ""}</p>
                      {l.modifierNames.length > 0 ? <p className="text-sm text-neutral-700">{l.modifierNames.join(", ")}</p> : null}
                      {l.note ? <p className="text-sm italic text-neutral-700">“{l.note}”</p> : null}
                    </div>
                    <p className="shrink-0 font-semibold tabular-nums">{formatMoney(l.unitPrice * l.qty, currency)}</p>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => onQty(l.key, l.qty - 1)} aria-label={fmt(s.decrease, { name: l.name })} className="flex size-12 items-center justify-center rounded-full text-2xl ring-1 ring-neutral-400"><span aria-hidden>−</span></button>
                      <span className="w-10 text-center text-lg font-bold tabular-nums" aria-live="polite">{l.qty}</span>
                      <button type="button" onClick={() => onQty(l.key, l.qty + 1)} aria-label={fmt(s.increase, { name: l.name })} className="flex size-12 items-center justify-center rounded-full text-2xl ring-1 ring-neutral-400"><span aria-hidden>+</span></button>
                    </div>
                    <button type="button" onClick={() => onRemove(l.key)} aria-label={fmt(s.remove, { name: l.name })} className="min-h-12 rounded-lg px-3 text-sm underline">×</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-neutral-200 p-4">
          <p className="flex justify-between text-lg font-bold tabular-nums"><span>{s.subtotal}</span><span>{formatMoney(subtotal, currency)}</span></p>
          <p className="text-sm text-neutral-700">{s.estimate}</p>
          {minOrderAmount > 0 ? <p className="text-sm text-neutral-700">{fmt(s.minOrder, { amount: formatMoney(minOrderAmount, currency) })}</p> : null}
          <button type="button" aria-disabled="true" onClick={onCheckoutIntent} className="min-h-12 rounded-lg bg-neutral-300 px-4 text-lg font-bold text-neutral-700">{s.checkout}</button>
          <p role="status" className="text-center text-sm text-neutral-700">{s.comingNext}</p>
          {lines.length > 0 ? <button type="button" onClick={onClear} className="min-h-12 rounded-lg px-3 text-sm underline">{s.clear}</button> : null}
        </div>
      </div>
    </div>
  );
}
