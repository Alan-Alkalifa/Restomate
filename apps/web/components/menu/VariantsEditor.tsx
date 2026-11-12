"use client";

import { useState } from "react";
import { MenuDialog } from "./MenuDialog";
import { parseMoneyInput } from "@/lib/money";
import { formatMoneyInput } from "./money-input";
import type { BoundMenuAction, MenuItem } from "./types";

export type Row = { key: string; id?: string; name: string; delta: string };
export const MAX_VARIANTS = 20;
export const MAX_MODIFIERS = 30;

export const toRows = (list: { id: string; name: string; priceDelta: number; isActive: boolean }[], currency: string): Row[] =>
  list.filter((v) => v.isActive).map((v) => ({ key: v.id, id: v.id, name: v.name, delta: formatMoneyInput(v.priceDelta, currency) }));

/**
 * Full list for saveItemVariants / saveGroupModifiers. Returns the JSON when every row is valid, else the per-row
 * problems (shown inline; the dialog's Save stays disabled until they are fixed).
 */
export function buildList(rows: Row[], currency: string, allowNegative: boolean, noun: string): { json: string; problems: (string | null)[] } {
  const problems = rows.map((r) => {
    if (!r.name.trim()) return `Enter a ${noun} name.`;
    if (r.name.trim().length > 60) return "Use 60 characters or fewer.";
    const p = parseMoneyInput(r.delta === "" ? "0" : r.delta, currency, { allowNegative });
    return p.ok ? null : p.message;
  });
  const list = rows.map((r) => {
    const p = parseMoneyInput(r.delta === "" ? "0" : r.delta, currency, { allowNegative });
    return { ...(r.id ? { id: r.id } : {}), name: r.name.trim(), priceDelta: p.ok ? p.value : 0 };
  });
  return { json: JSON.stringify(list), problems };
}

/** Rows editor shared by variants and modifiers: add / remove / rename / price delta. */
export function RowsEditor({
  rows,
  setRows,
  allowNegative,
  noun,
  max,
  problems,
}: {
  rows: Row[];
  setRows: (r: Row[]) => void;
  allowNegative: boolean;
  noun: string;
  max: number;
  problems: (string | null)[];
}) {
  const [touched, setTouched] = useState(false);
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="flex flex-col gap-3">
      {rows.length === 0 && <p className="text-sm text-neutral-600 dark:text-neutral-400">No {noun}s. Saving with an empty list removes them all.</p>}
      {rows.map((r, i) => (
        <div key={r.key} className="flex flex-col gap-2 rounded-lg border border-neutral-300 p-3 dark:border-neutral-700">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-medium">
              {noun[0].toUpperCase() + noun.slice(1)} {i + 1} name
              <input value={r.name} maxLength={60} onChange={(e) => set(i, { name: e.target.value })} onBlur={() => setTouched(true)} aria-invalid={touched && !!problems[i] ? true : undefined} className="min-h-12 rounded-lg border border-neutral-400 bg-transparent px-3 font-normal aria-[invalid=true]:border-red-600" />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Price change{allowNegative ? " (can be negative)" : ""}
              <input value={r.delta} inputMode="numeric" autoComplete="off" onChange={(e) => set(i, { delta: e.target.value })} onBlur={() => setTouched(true)} aria-invalid={touched && !!problems[i] ? true : undefined} className="min-h-12 rounded-lg border border-neutral-400 bg-transparent px-3 font-normal aria-[invalid=true]:border-red-600" />
            </label>
          </div>
          {touched && problems[i] && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{noun[0].toUpperCase() + noun.slice(1)} {i + 1}: {problems[i]}</p>}
          <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label={`Remove ${noun} ${i + 1}`} className="min-h-12 self-start rounded-lg px-3 text-sm ring-1 ring-neutral-400">Remove</button>
        </div>
      ))}
      <button type="button" disabled={rows.length >= max} onClick={() => { setTouched(false); setRows([...rows, { key: crypto.randomUUID(), name: "", delta: "0" }]); }} className="min-h-12 self-start rounded-lg px-4 text-sm font-medium ring-1 ring-neutral-400 disabled:opacity-60">
        Add {noun}
      </button>
      {rows.length >= max && <p className="text-xs text-neutral-600 dark:text-neutral-400">Up to {max} {noun}s.</p>}
    </div>
  );
}

export function VariantsEditor({ item, currency, action }: { item: MenuItem; currency: string; action: BoundMenuAction }) {
  const [rows, setRows] = useState<Row[]>(() => toRows(item.variants, currency));
  const { json, problems } = buildList(rows, currency, true, "variant");
  return (
    <MenuDialog
      triggerLabel="Variants"
      triggerAriaLabel={`Variants for ${item.name}`}
      title={`Variants for ${item.name}`}
      description="Sizes or options with a price change from the base price. Rows you remove are deactivated."
      submitLabel="Save variants"
      action={action}
      hidden={{ itemId: item.id }}
      wide
      canSubmit={problems.every((p) => !p)}
      onOpen={() => setRows(toRows(item.variants, currency))}
    >
      {() => (
        <>
          <input type="hidden" name="variants" value={json} />
          <RowsEditor rows={rows} setRows={setRows} allowNegative noun="variant" max={MAX_VARIANTS} problems={problems} />
        </>
      )}
    </MenuDialog>
  );
}
