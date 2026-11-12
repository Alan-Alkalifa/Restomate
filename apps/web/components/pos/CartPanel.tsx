"use client";

import { formatMoney } from "@/lib/money";
import { estimatedTotal, itemCount, MAX_NOTE, type CartAction, type CartState } from "./cart";
import { Stepper } from "./Stepper";

const seg = "min-h-12 flex-1 rounded-lg px-3 text-sm font-medium";

export function CartPanel({ cart, currency, dispatch }: { cart: CartState; currency: string; dispatch: (a: CartAction) => void }) {
  return (
    <section aria-labelledby="cart-h" className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="cart-h" className="text-lg font-semibold">Cart <span className="text-sm font-normal">({itemCount(cart)})</span></h2>
        <button type="button" disabled={cart.lines.length === 0} onClick={() => dispatch({ type: "clear" })} className="min-h-12 rounded-lg px-3 text-sm ring-1 ring-neutral-400 disabled:opacity-40">Clear</button>
      </div>

      <div role="group" aria-label="Order type" className="flex gap-2">
        {([["dine_in", "Dine-in"], ["takeaway", "Takeaway"]] as const).map(([v, label]) => (
          <button key={v} type="button" aria-pressed={cart.orderType === v} onClick={() => dispatch({ type: "setOrderType", orderType: v })}
            className={`${seg} ${cart.orderType === v ? "bg-teal-700 text-white" : "ring-1 ring-neutral-400"}`}>{label}</button>
        ))}
      </div>

      <label className="flex flex-col gap-1 text-sm">Table
        <select disabled aria-describedby="table-hint" className="min-h-12 rounded-lg border border-neutral-300 bg-transparent px-3 opacity-60"><option>Choose a table</option></select>
        <span id="table-hint" className="text-xs text-neutral-600 dark:text-neutral-400">Table picking arrives with the tables wiring.</span>
      </label>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {cart.lines.length === 0 ? (
          <p role="status" className="rounded-lg border border-dashed border-neutral-400 p-4 text-center text-sm">The cart is empty. Tap an item to add it.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {cart.lines.map((l) => (
              <li key={l.key} className="flex flex-col gap-2 rounded-lg p-3 ring-1 ring-neutral-300 dark:ring-neutral-700">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium break-words">{l.name}{l.variantName ? ` · ${l.variantName}` : ""}</p>
                    {l.modifiers.length > 0 ? <p className="text-sm text-neutral-600 break-words dark:text-neutral-400">{l.modifiers.map((m) => m.name).join(", ")}</p> : null}
                  </div>
                  <p className="shrink-0 text-sm tabular-nums">{formatMoney(l.unitPrice * l.qty, currency)}</p>
                </div>
                <input aria-label={`Note for ${l.name}`} defaultValue={l.note} maxLength={MAX_NOTE} placeholder="Note"
                  onBlur={(e) => { if (e.target.value !== l.note) dispatch({ type: "setNote", key: l.key, note: e.target.value }); }}
                  className="min-h-12 rounded-lg border border-neutral-300 bg-transparent px-3 text-sm" />
                <div className="flex items-center justify-between gap-2">
                  <Stepper qty={l.qty} label={l.name} onChange={(q) => dispatch({ type: "setQty", key: l.key, qty: q })} />
                  <button type="button" onClick={() => dispatch({ type: "remove", key: l.key })} className="min-h-12 rounded-lg px-3 text-sm ring-1 ring-neutral-400">Remove</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
        <p className="flex items-baseline justify-between text-lg font-semibold">
          <span>Estimated total</span><span className="tabular-nums">{formatMoney(estimatedTotal(cart), currency)}</span>
        </p>
        <p className="text-xs text-neutral-600 dark:text-neutral-400">Estimated. Tax, service charge and final prices are calculated when the order is sent.</p>
        <button type="button" disabled aria-disabled className="min-h-14 rounded-lg bg-neutral-300 px-5 text-lg font-semibold text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300">
          Send to kitchen · Coming next
        </button>
      </div>
    </section>
  );
}
