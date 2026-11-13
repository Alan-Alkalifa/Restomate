"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/lib/auth/schemas";
import { fmt } from "@/i18n/config";
import type { KitchenDictionary } from "@/i18n/types";
import { ageMinutes, nextAction, ticketAgeMs, timerLevel, type KdsItem, type KdsTicket, type TimerLevel } from "./kitchen-model";

/** A bound Server Action: orgSlug and locationId are already applied on the server, FormData carries ids only. */
export type KitchenAction = (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
export type KitchenActions = { updateKotStatus: KitchenAction; bumpKot: KitchenAction; setKotItemStatus: KitchenAction };

const LEVEL_STYLE: Record<TimerLevel, string> = {
  ok: "border-neutral-400 bg-white text-neutral-900 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-50",
  amber: "border-amber-600 bg-amber-100 text-amber-950",
  red: "border-red-700 bg-red-100 text-red-950",
};
const CHIP_STYLE: Record<TimerLevel, string> = {
  ok: "bg-neutral-200 text-neutral-900 dark:bg-neutral-700 dark:text-neutral-50",
  amber: "bg-amber-600 text-white",
  red: "bg-red-700 text-white",
};

/** Runs a bound action and asks the board to refetch when it succeeded. */
function useKitchenAction(action: KitchenAction, onChanged: () => void) {
  return useActionState<ActionResult | null, FormData>(async (prev, formData) => {
    const result = await action(prev, formData);
    if (result.ok) onChanged();
    return result;
  }, null);
}

function ItemRow({ item, canUpdate, action, onChanged, t }: {
  item: KdsItem; canUpdate: boolean; action: KitchenAction; onChanged: () => void; t: KitchenDictionary;
}) {
  const [state, formAction, pending] = useKitchenAction(action, onChanged);
  const isVoid = item.status === "void";
  const done = item.status === "ready";
  const body = (
    <>
      <span className="w-12 shrink-0 text-right text-3xl font-bold tabular-nums">{item.quantity}×</span>
      <span className="min-w-0 flex-1">
        <span className={`block text-2xl font-semibold leading-tight ${isVoid ? "line-through opacity-70" : ""} ${done ? "opacity-60" : ""}`}>
          {item.name}
          {item.variantName ? <span className="font-normal"> · {item.variantName}</span> : null}
        </span>
        {item.modifiersText ? <span className={`block text-lg leading-snug ${isVoid ? "line-through opacity-70" : ""}`}>{item.modifiersText}</span> : null}
        {item.note ? <span className="mt-0.5 block text-lg font-semibold italic">“{item.note}”</span> : null}
      </span>
      {isVoid ? <span className="shrink-0 rounded bg-neutral-800 px-2 py-1 text-sm font-bold uppercase text-white">{t.item.void}</span> : null}
      {done ? <span aria-hidden className="shrink-0 text-3xl">✓</span> : null}
    </>
  );
  if (isVoid || !canUpdate) {
    return <li className="flex items-start gap-3 px-4 py-3" data-item-status={item.status}>{body}</li>;
  }
  return (
    <li data-item-status={item.status} className="border-t border-black/10 first:border-t-0 dark:border-white/10">
      <form action={formAction}>
        <input type="hidden" name="ticketItemId" value={item.id} />
        <input type="hidden" name="status" value={done ? "pending" : "ready"} />
        <button
          type="submit"
          disabled={pending}
          aria-pressed={done}
          aria-label={`${item.quantity}× ${item.name}: ${done ? t.item.ready : t.item.pending}`}
          className="flex min-h-16 w-full items-start gap-3 px-4 py-3 text-left focus-visible:outline-4 focus-visible:outline-offset-[-4px] focus-visible:outline-teal-700 disabled:opacity-60"
        >
          {body}
        </button>
      </form>
      {state && !state.ok ? <p role="alert" className="px-4 pb-2 text-base font-semibold">{state.formError ?? t.updateFailed}</p> : null}
    </li>
  );
}

function StatusButton({ ticket, canUpdate, actions, onChanged, t }: {
  ticket: KdsTicket; canUpdate: boolean; actions: KitchenActions; onChanged: () => void; t: KitchenDictionary;
}) {
  const next = nextAction(ticket.status);
  const [state, formAction, pending] = useKitchenAction(next?.kind === "bump" ? actions.bumpKot : actions.updateKotStatus, onChanged);
  // The server refuses without kitchen.update; hiding the button is only the UI half.
  if (!canUpdate || !next) return null;
  return (
    <div>
      <form action={formAction}>
        <input type="hidden" name="ticketId" value={ticket.id} />
        {next.kind === "bump" ? null : <input type="hidden" name="status" value={next.to} />}
        <button
          type="submit"
          disabled={pending}
          className="min-h-16 w-full rounded-lg bg-teal-700 px-4 text-2xl font-bold text-white hover:bg-teal-800 focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-teal-900 disabled:opacity-60"
        >
          {t.actions[next.kind]}
        </button>
      </form>
      {state && !state.ok ? <p role="alert" className="mt-2 text-base font-semibold">{state.formError ?? t.updateFailed}</p> : null}
    </div>
  );
}

export function TicketCard({ ticket, stationName, nowMs, canUpdate, actions, onChanged, t }: {
  ticket: KdsTicket; stationName: string | null; nowMs: number; canUpdate: boolean; actions: KitchenActions; onChanged: () => void; t: KitchenDictionary;
}) {
  const age = ticketAgeMs(ticket.createdAt, nowMs, 0); // nowMs is already the server-corrected clock
  const level = timerLevel(age);
  const minutes = ageMinutes(age);
  return (
    <li data-ticket-id={ticket.id} data-status={ticket.status} data-level={level} className={`flex flex-col overflow-hidden rounded-xl border-4 ${LEVEL_STYLE[level]}`}>
      <header className="flex items-start justify-between gap-3 border-b-2 border-black/15 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-3xl font-extrabold leading-none">{fmt(t.ticket, { number: ticket.ticketNumber })}</h2>
          <p className="mt-1 text-xl font-semibold">
            {fmt(t.order, { number: ticket.orderNumber })} · {ticket.tableLabel ? fmt(t.table, { label: ticket.tableLabel }) : t.takeaway}
          </p>
          {stationName ? <p className="text-base">{stationName}</p> : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={`rounded-lg px-3 py-1 text-3xl font-extrabold tabular-nums ${CHIP_STYLE[level]}`}>
            <span className="sr-only">{t.timer[level]}: </span>
            {fmt(t.timer.minutes, { minutes })}
          </span>
          <span className="text-base font-bold uppercase">{t.status[ticket.status]}</span>
        </div>
      </header>
      <ul className="flex-1">
        {ticket.items.map((item) => (
          <ItemRow key={item.id} item={item} canUpdate={canUpdate} action={actions.setKotItemStatus} onChanged={onChanged} t={t} />
        ))}
      </ul>
      <div className="p-3 empty:hidden">
        <StatusButton ticket={ticket} canUpdate={canUpdate} actions={actions} onChanged={onChanged} t={t} />
      </div>
    </li>
  );
}
