"use client";

import { useEffect, useRef, useState } from "react";
import { fmt } from "@/i18n/config";
import type { StorefrontDictionary } from "@/i18n/types";
import { formatMoney } from "@/lib/money";
import { MAX_QTY, NOTE_MAX, clampQty, unitPrice, validateSelection, type PublicItem, type PublicModifierGroup, type Selection, type SelectionError } from "./menu-model";

const sign = (n: number, currency: string) => (n === 0 ? "" : ` ${n > 0 ? "+" : "−"}${formatMoney(Math.abs(n), currency)}`);

function groupHint(g: PublicModifierGroup, t: StorefrontDictionary["item"]): string {
  const rule = g.minSelect === g.maxSelect ? fmt(t.chooseExactly, { n: g.maxSelect }) : g.minSelect === 0 ? fmt(t.chooseUpTo, { max: g.maxSelect }) : fmt(t.chooseBetween, { min: g.minSelect, max: g.maxSelect });
  return `${g.minSelect > 0 ? t.required : t.optional} · ${rule}`;
}

/** Human message for the FIRST problem in a group, shown only once the guest has interacted (never as a wall of red on open). */
function groupError(errors: SelectionError[], g: PublicModifierGroup, t: StorefrontDictionary["item"]): string | null {
  for (const e of errors) {
    if (e.kind === "group_min" && e.groupId === g.id) return fmt(t.errors.min, { min: e.min, group: g.name });
    if (e.kind === "group_max" && e.groupId === g.id) return fmt(t.errors.max, { max: e.max, group: g.name });
  }
  return null;
}

/**
 * Item detail: variants (pick one), modifier groups with their min/max, a note and a quantity. "Add to cart" is disabled
 * until the selection satisfies every rule (the same `validateSelection` the cart reducer and the server enforce), so an
 * invalid line cannot be added. Prices shown are item prices; the server prices the order again.
 */
export function ItemSheet({ item, currency, t, canAdd, onAdd, onClose }: {
  item: PublicItem; currency: string; t: StorefrontDictionary; canAdd: boolean;
  onAdd: (selection: Selection, note: string, qty: number) => void; onClose: () => void;
}) {
  const s = t.item;
  const [variantId, setVariantId] = useState<string | null>(item.variants.length === 1 ? item.variants[0].id : null);
  const [modifierIds, setModifierIds] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [qty, setQty] = useState(1);
  const [touched, setTouched] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const selection: Selection = { variantId, modifierIds };
  const errors = validateSelection(item, selection);
  const valid = errors.length === 0;
  const total = unitPrice(item, selection) * qty;

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // the page behind must not scroll under the sheet
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const toggle = (g: PublicModifierGroup, id: string) => {
    setTouched(true);
    setModifierIds((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      // A single-choice group swaps the previous choice instead of piling up.
      const base = g.maxSelect === 1 ? cur.filter((x) => !g.modifiers.some((m) => m.id === x)) : cur;
      return [...base, id];
    });
  };
  const row = "flex min-h-12 w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 ring-1 ring-neutral-300 has-[:checked]:ring-2 has-[:checked]:ring-[var(--brand-primary)]";

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="item-title" className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4">
      <div className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white text-neutral-900 shadow-xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-neutral-200 p-4">
          <div className="min-w-0">
            <h2 id="item-title" className="text-xl font-bold break-words">{item.name}</h2>
            <p className="tabular-nums">{formatMoney(item.price, currency)}</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={s.close} className="flex size-12 shrink-0 items-center justify-center rounded-full text-2xl hover:bg-neutral-100"><span aria-hidden>×</span></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {item.description ? <p className="mb-4 text-neutral-700">{item.description}</p> : null}

          {item.variants.length > 0 ? (
            <fieldset className="mb-5 flex flex-col gap-2">
              <legend className="mb-1 font-semibold">{s.variant} <span className="text-sm font-normal text-neutral-600">· {s.required}</span></legend>
              {item.variants.map((v) => (
                <label key={v.id} className={row}>
                  <span className="flex items-center gap-3"><input type="radio" name="variant" checked={variantId === v.id} onChange={() => { setTouched(true); setVariantId(v.id); }} className="size-5 accent-[var(--brand-primary)]" />{v.name}</span>
                  <span className="text-sm tabular-nums">{sign(v.priceDelta, currency)}</span>
                </label>
              ))}
              {touched && errors.some((e) => e.kind === "variant_required") ? <p role="alert" className="text-sm font-medium text-red-700">{s.errors.variant}</p> : null}
            </fieldset>
          ) : null}

          {item.modifierGroups.map((g) => (
            <fieldset key={g.id} className="mb-5 flex flex-col gap-2">
              <legend className="mb-1 font-semibold">{g.name} <span className="text-sm font-normal text-neutral-600">· {groupHint(g, s)}</span></legend>
              {g.modifiers.map((m) => (
                <label key={m.id} className={row}>
                  <span className="flex items-center gap-3">
                    <input type={g.maxSelect === 1 ? "radio" : "checkbox"} name={`g-${g.id}`} checked={modifierIds.includes(m.id)} onChange={() => toggle(g, m.id)} className="size-5 accent-[var(--brand-primary)]" />
                    {m.name}
                  </span>
                  <span className="text-sm tabular-nums">{sign(m.priceDelta, currency)}</span>
                </label>
              ))}
              {touched && groupError(errors, g, s) ? <p role="alert" className="text-sm font-medium text-red-700">{groupError(errors, g, s)}</p> : null}
            </fieldset>
          ))}

          <label className="mb-1 block font-semibold" htmlFor="item-note">{s.note}</label>
          <textarea id="item-note" rows={2} maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} placeholder={s.notePlaceholder}
            className="w-full rounded-lg border border-neutral-400 bg-white p-3 text-base" />
        </div>

        <div className="flex items-center gap-3 border-t border-neutral-200 p-4">
          <div role="group" aria-label={s.quantity} className="flex items-center gap-1">
            <button type="button" onClick={() => setQty((q) => clampQty(q - 1))} disabled={qty <= 1} aria-label={s.decrease} className="flex size-12 items-center justify-center rounded-full text-2xl ring-1 ring-neutral-400 disabled:opacity-40"><span aria-hidden>−</span></button>
            <span className="w-10 text-center text-lg font-bold tabular-nums" aria-live="polite">{qty}</span>
            <button type="button" onClick={() => setQty((q) => clampQty(q + 1))} disabled={qty >= MAX_QTY} aria-label={s.increase} className="flex size-12 items-center justify-center rounded-full text-2xl ring-1 ring-neutral-400 disabled:opacity-40"><span aria-hidden>+</span></button>
          </div>
          {/* aria-disabled (not disabled) while the selection is incomplete: tapping it shows what is missing. */}
          <button type="button" disabled={!canAdd} aria-disabled={!canAdd || !valid} onClick={() => { setTouched(true); if (valid && canAdd) onAdd(selection, note, qty); }}
            className={`min-h-12 flex-1 rounded-lg bg-[var(--brand-primary)] px-4 text-lg font-bold text-[var(--brand-on-primary)] disabled:opacity-50 ${valid ? "" : "opacity-60"}`}>
            {s.addToCart} · {formatMoney(total, currency)}
          </button>
        </div>
      </div>
    </div>
  );
}
