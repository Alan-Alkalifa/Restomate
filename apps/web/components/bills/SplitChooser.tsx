"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/money";
import type { BillsDictionary } from "@/i18n/types";
import { fmt } from "@/i18n/config";
import { SPLIT_MAX, SPLIT_MIN, assignLine, emptyAssignments, unassignedLines, validateSplit, type BillAction, type BillableOrder, type SplitError, type SplitKind, createAttemptTracker } from "./bills-model";
import { useBillAction } from "./use-bill-action";
import { btnGhost, btnPrimary, card, errorCls, inputCls } from "./ui";

const ERROR_KEY: Record<SplitError, keyof BillsDictionary["create"]["errors"]> = {
  count: "count", assignments_count: "assignmentsCount", assignments_incomplete: "assignmentsIncomplete",
  assignments_empty_bill: "assignmentsEmptyBill", assignments_duplicate: "assignmentsDuplicate",
};

/** Create a bill: no split, equal (2-20 shares) or by item (tap lines onto bills). Never offers an invalid request. */
export function SplitChooser({ order, t, createBills, onCreated }: {
  order: BillableOrder; t: BillsDictionary; createBills: BillAction<{ billSetId: string; replayed: boolean }>; onCreated: () => void;
}) {
  const [kind, setKind] = useState<SplitKind>("none");
  const [count, setCount] = useState("2");
  const [bills, setBills] = useState(2);
  const [assignments, setAssignments] = useState<string[][]>(() => emptyAssignments(2));
  const [active, setActive] = useState(0);
  const [tracker] = useState(() => createAttemptTracker());
  const [state, formAction, pending] = useBillAction(createBills, { tracker, onOk: onCreated });
  const lineIds = order.lines.map((l) => l.id);
  const n = Number(count);
  const error = validateSplit(kind, kind === "equal" ? (Number.isInteger(n) ? n : null) : null, kind === "by_item" ? assignments : null, lineIds);
  const money = (v: number) => formatMoney(v, order.currency);
  const left = unassignedLines(lineIds, assignments);
  const where = (id: string) => assignments.findIndex((g) => g.includes(id));
  const setBillCount = (next: number) => {
    const c = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, next));
    setBills(c);
    // Keep what is already assigned; lines on a removed bill go back to "not on a bill yet".
    setAssignments((cur) => Array.from({ length: c }, (_, i) => cur[i] ?? []));
    setActive((a) => Math.min(a, c - 1));
  };
  const radio = (k: SplitKind, label: string) => (
    <label className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-lg px-3 ring-1 ${kind === k ? "bg-teal-50 ring-2 ring-teal-700 dark:bg-teal-950" : "ring-neutral-400"}`}>
      <input type="radio" name="splitKindUi" checked={kind === k} onChange={() => setKind(k)} className="size-5" />
      <span className="text-lg font-semibold">{label}</span>
    </label>
  );

  return (
    <form action={formAction} className={`${card} flex flex-col gap-4`}>
      <h2 className="text-xl font-bold">{t.create.heading}</h2>
      <input type="hidden" name="orderId" value={order.orderId} />
      <input type="hidden" name="splitKind" value={kind} />
      {kind === "equal" ? <input type="hidden" name="splitCount" value={count} /> : null}
      {kind === "by_item" ? <input type="hidden" name="assignments" value={JSON.stringify(assignments)} /> : null}
      <div role="radiogroup" className="grid gap-2 sm:grid-cols-3">
        {radio("none", t.create.none)}
        {radio("equal", t.create.equal)}
        {radio("by_item", t.create.byItem)}
      </div>

      {kind === "equal" ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="shares" className="text-base font-semibold">{t.create.shares} <span className="font-normal">({t.create.sharesHint})</span></label>
          <input id="shares" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ""))} className={`${inputCls} max-w-32`} />
          <p className="text-sm">{t.create.equalNote}</p>
        </div>
      ) : null}

      {kind === "by_item" ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm">{t.create.assignHint}</p>
          <div className="flex flex-wrap items-center gap-2" role="tablist">
            {assignments.map((g, i) => (
              <button key={i} type="button" role="tab" aria-selected={active === i} onClick={() => setActive(i)}
                className={`min-h-12 rounded-lg px-4 text-lg font-semibold ring-1 ${active === i ? "bg-teal-700 text-white ring-teal-800" : "ring-neutral-400"}`}>
                {fmt(t.create.billN, { n: i + 1 })} <span className="tabular-nums">({g.length})</span>
              </button>
            ))}
            <button type="button" className={btnGhost} onClick={() => setBillCount(bills - 1)} disabled={bills <= SPLIT_MIN} aria-label="−">−</button>
            <button type="button" className={btnGhost} onClick={() => setBillCount(bills + 1)} disabled={bills >= SPLIT_MAX} aria-label="+">+</button>
          </div>
          <ul className="flex flex-col gap-2">
            {order.lines.map((l) => {
              const w = where(l.id);
              return (
                <li key={l.id}>
                  <button type="button" aria-pressed={w === active} onClick={() => setAssignments((a) => assignLine(a, l.id, active))}
                    className={`flex min-h-14 w-full items-center justify-between gap-3 rounded-lg px-3 text-left ring-1 ${w === active ? "bg-teal-50 ring-2 ring-teal-700 dark:bg-teal-950" : "ring-neutral-400"}`}>
                    <span className="min-w-0"><span className="font-semibold">{l.quantity}× {l.name}{l.variantName ? ` (${l.variantName})` : ""}</span></span>
                    <span className="shrink-0 text-sm">{w < 0 ? t.create.unassigned : fmt(t.create.billN, { n: w + 1 })} · {money(l.lineTotal)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {left.length > 0 ? <p className="text-sm font-medium">{t.create.unassigned}: {left.length}</p> : null}
        </div>
      ) : null}

      {error && kind !== "none" ? <p role="alert" className={errorCls}>{t.create.errors[ERROR_KEY[error]]}</p> : null}
      {state && !state.ok ? <p role="alert" className={errorCls}>{state.formError ?? t.pay.errors.failed}</p> : null}
      <p className="text-sm">{t.create.lockNote}</p>
      <button type="submit" disabled={pending || error !== null} className={`${btnPrimary} self-start`}>{pending ? t.create.pending : t.create.submit}</button>
    </form>
  );
}
