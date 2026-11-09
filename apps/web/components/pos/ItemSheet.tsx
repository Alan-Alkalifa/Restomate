"use client";

import { useEffect, useRef, useState } from "react";
import { formatMoney } from "@/lib/money";
import { MAX_NOTE } from "./cart";
import { unitPrice, validateSelection, type PosItem, type Selection } from "./pos-model";
import { Stepper } from "./Stepper";

const signed = (n: number, currency: string) => (n === 0 ? "" : n > 0 ? `+${formatMoney(n, currency)}` : `−${formatMoney(-n, currency)}`);

/** Bottom sheet (native <dialog>: Esc closes it, focus is trapped). Mount it with key={item.id} so state is fresh. */
export function ItemSheet({ item, currency, onClose, onAdd }: {
  item: PosItem; currency: string; onClose: () => void; onAdd: (sel: Selection, note: string, qty: number) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [modifierIds, setModifierIds] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [qty, setQty] = useState(1);
  const [tried, setTried] = useState(false);
  useEffect(() => { ref.current?.showModal(); }, []);

  const sel: Selection = { variantId, modifierIds };
  const errors = validateSelection(item, sel);
  const toggle = (groupId: string, id: string, max: number) => {
    const group = item.groups.find((g) => g.id === groupId)!;
    const inGroup = group.modifiers.map((m) => m.id);
    setModifierIds((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (max === 1) return [...cur.filter((x) => !inGroup.includes(x)), id]; // single choice replaces
      return cur.filter((x) => inGroup.includes(x)).length >= max ? cur : [...cur, id]; // at max: ignore
    });
  };

  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="sheet-title"
      className="fixed inset-x-0 bottom-0 top-auto m-0 mx-auto max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl p-5 backdrop:bg-black/50">
      <form method="dialog" onSubmit={(e) => { e.preventDefault(); setTried(true); if (errors.length === 0) onAdd(sel, note, qty); }} className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <h2 id="sheet-title" className="text-xl font-semibold break-words">{item.name}</h2>
          <button type="button" onClick={() => ref.current?.close()} className="min-h-12 shrink-0 rounded-lg px-3 ring-1 ring-neutral-400">Close</button>
        </div>

        {item.variants.length > 0 ? (
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 font-medium">Variant <span className="text-sm font-normal text-neutral-600 dark:text-neutral-400">(required)</span></legend>
            {item.variants.map((v) => (
              <label key={v.id} className="flex min-h-12 items-center gap-3">
                <input type="radio" name="variant" className="size-6" checked={variantId === v.id} onChange={() => setVariantId(v.id)} />
                <span className="flex-1">{v.name}</span>
                <span className="text-sm">{signed(v.priceDelta, currency)}</span>
              </label>
            ))}
          </fieldset>
        ) : null}

        {item.groups.map((g) => {
          const n = g.modifiers.filter((m) => modifierIds.includes(m.id)).length;
          const rule = g.minSelect === g.maxSelect ? `Choose ${g.minSelect}` : g.minSelect > 0 ? `Choose ${g.minSelect}–${g.maxSelect}` : `Up to ${g.maxSelect}`;
          return (
            <fieldset key={g.id} className="flex flex-col gap-1">
              <legend className="mb-1 font-medium">{g.name} <span className="text-sm font-normal text-neutral-600 dark:text-neutral-400">({rule}{g.minSelect > 0 ? ", required" : ""})</span></legend>
              {g.modifiers.map((m) => {
                const on = modifierIds.includes(m.id);
                const blocked = !on && g.maxSelect > 1 && n >= g.maxSelect;
                return (
                  <label key={m.id} className={`flex min-h-12 items-center gap-3 ${blocked ? "opacity-50" : ""}`}>
                    <input type={g.maxSelect === 1 ? "radio" : "checkbox"} name={`g-${g.id}`} className="size-6" checked={on} disabled={blocked}
                      onChange={() => toggle(g.id, m.id, g.maxSelect)} />
                    <span className="flex-1">{m.name}</span>
                    <span className="text-sm">{signed(m.priceDelta, currency)}</span>
                  </label>
                );
              })}
            </fieldset>
          );
        })}

        <label className="flex flex-col gap-1 text-sm font-medium">Note
          <input value={note} maxLength={MAX_NOTE} onChange={(e) => setNote(e.target.value)} placeholder="e.g. no onions"
            className="min-h-12 rounded-lg border border-neutral-400 bg-transparent px-3 text-base font-normal" />
        </label>

        {tried && errors.length > 0 ? (
          <ul role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
            {errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Stepper qty={qty} onChange={setQty} label={item.name} />
          <button type="submit" disabled={errors.length > 0} aria-disabled={errors.length > 0}
            className="min-h-14 flex-1 rounded-lg bg-teal-700 px-5 text-lg font-semibold text-white hover:bg-teal-800 disabled:opacity-50">
            Add · {formatMoney(unitPrice(item, sel) * qty, currency)}
          </button>
        </div>
      </form>
    </dialog>
  );
}
