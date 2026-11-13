"use client";

import { useActionState, useEffect, useRef, useState, type Ref } from "react";
import type { ActionResult } from "@/lib/auth/schemas";
import { fmt } from "@/i18n/config";
import type { PosDictionary } from "@/i18n/types";
import type { PosItem } from "./pos-model";

/** A bound Server Action: orgSlug and locationId are applied on the server. The only fields the client sends are the item and the new state. */
export type ToggleSoldOutAction = (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;

const btn = "min-h-12 rounded-lg px-5 text-lg font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-50";

/** Which of the three views is showing: pick an action, confirm marking sold out, or restore an item that is sold out. */
export const sheetView = (soldOut: boolean, confirming: boolean): "choose" | "confirm" | "restore" => (soldOut ? "restore" : confirming ? "confirm" : "choose");

/** Pure presentation of the sheet (no hooks), so every step is testable. */
export function SoldOutSheetView({ item, t, locale, online, confirming, pending, error, formAction, firstRef, onConfirm, onBack, onClose }: {
  item: PosItem; t: PosDictionary; locale: "id" | "en"; online: boolean; confirming: boolean; pending: boolean; error: string | null;
  formAction: (formData: FormData) => void; firstRef?: Ref<HTMLButtonElement>; onConfirm: () => void; onBack: () => void; onClose: () => void;
}) {
  const s = t.soldOut;
  const view = sheetView(item.soldOut, confirming);
  return (
    <div role="dialog" aria-modal="true" aria-label={item.name} lang={locale} data-view={view} className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="w-full max-w-md rounded-t-2xl bg-white p-5 text-neutral-950 shadow-xl sm:rounded-2xl dark:bg-neutral-900 dark:text-neutral-50">
        <p className="text-xl font-bold break-words">{item.name}</p>
        {!online ? <p role="status" className="mt-2 rounded bg-amber-100 px-3 py-2 text-base font-medium text-amber-950">{s.offline}</p> : null}
        {error ? <p role="alert" className="mt-2 text-base font-medium text-red-700 dark:text-red-400">{error}</p> : null}

        {view === "choose" ? (
          <div className="mt-4 flex flex-col gap-3">
            <button ref={firstRef} type="button" onClick={onConfirm} disabled={!online} className={`${btn} bg-teal-700 text-white hover:bg-teal-800`}>{s.markSoldOut}</button>
            <button type="button" onClick={onClose} className={`${btn} ring-1 ring-neutral-400`}>{s.cancel}</button>
          </div>
        ) : (
          <form action={formAction} className="mt-4 flex flex-col gap-3">
            {/* The only fields: which item, and the new state. Never an organization or location id. */}
            <input type="hidden" name="itemId" value={item.id} />
            <input type="hidden" name="soldOut" value={view === "restore" ? "false" : "true"} />
            {view === "confirm" ? (
              <>
                <p className="text-lg font-semibold">{fmt(s.confirmTitle, { name: item.name })}</p>
                <p className="text-base">{s.confirmBody}</p>
              </>
            ) : null}
            <button ref={firstRef} type="submit" disabled={pending || !online} className={`${btn} bg-teal-700 text-white hover:bg-teal-800`}>
              {pending ? s.pending : view === "restore" ? s.markAvailable : s.confirm}
            </button>
            <button type="button" onClick={view === "restore" ? onClose : onBack} disabled={pending} className={`${btn} ring-1 ring-neutral-400`}>
              {view === "restore" ? s.cancel : s.back}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

/**
 * "Sold out today" / "Available again" for one item. Marking sold out takes a confirm step (a mis-tap during service
 * would pull a dish off every screen); marking available again is one tap. Wraps the existing menu action: it allows
 * menu.manage or orders.create (cashier, waiter), and the RPC re-checks permission, location access and item ownership.
 */
export function SoldOutSheet({ item, t, locale, online, action, onClose, onDone }: {
  item: PosItem; t: PosDictionary; locale: "id" | "en"; online: boolean; action: ToggleSoldOutAction; onClose: () => void; onDone: (message: string) => void;
}) {
  const s = t.soldOut;
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(async (prev, fd) => {
    try {
      const result = await action(prev, fd);
      if (result.ok) onDone(fmt(fd.get("soldOut") === "true" ? s.doneSoldOut : s.doneAvailable, { name: item.name }));
      return result;
    } catch {
      return { ok: false, formError: s.failed }; // offline / dropped request: stay open so it can be retried
    }
  }, null);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, confirming]);

  return (
    <SoldOutSheetView
      item={item} t={t} locale={locale} online={online} confirming={confirming} pending={pending}
      error={state && !state.ok ? (state.formError ?? s.failed) : null}
      formAction={formAction} firstRef={first} onConfirm={() => setConfirming(true)} onBack={() => setConfirming(false)} onClose={onClose}
    />
  );
}
