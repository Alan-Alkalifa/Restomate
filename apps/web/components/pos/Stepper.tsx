"use client";

import { MAX_QTY } from "./cart";

const btn = "flex size-12 items-center justify-center rounded-lg text-xl ring-1 ring-neutral-400 hover:bg-neutral-100 disabled:opacity-40 dark:hover:bg-neutral-800";

export function Stepper({ qty, onChange, label, min = 1 }: { qty: number; onChange: (q: number) => void; label: string; min?: number }) {
  return (
    <div className="flex items-center gap-2" role="group" aria-label={`Quantity of ${label}`}>
      <button type="button" className={btn} aria-label={`Decrease ${label}`} disabled={qty <= min} onClick={() => onChange(qty - 1)}>−</button>
      <span className="w-8 text-center text-lg font-semibold tabular-nums" aria-live="polite">{qty}</span>
      <button type="button" className={btn} aria-label={`Increase ${label}`} disabled={qty >= MAX_QTY} onClick={() => onChange(qty + 1)}>+</button>
    </div>
  );
}
