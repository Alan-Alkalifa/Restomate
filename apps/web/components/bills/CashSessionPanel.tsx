"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/money";
import { fmt } from "@/i18n/config";
import type { BillsDictionary } from "@/i18n/types";
import { cashVariance, closeNoteOk, closeNeedsNote, parseMoneyInputOrNull, type BillAction, type CashSession } from "./bills-model";
import { useBillAction } from "./use-bill-action";
import { btnGhost, btnPrimary, card, errorCls, inputCls } from "./ui";

/** Open with an opening float; close with the counted cash. Expected cash is shown from the server (never typed). */
export function CashSessionPanel({ session, expectedSoFar, currency, t, locale, openCashSession, closeCashSession, onChanged }: {
  session: CashSession | null; expectedSoFar: number; currency: string; t: BillsDictionary; locale: "id" | "en";
  openCashSession: BillAction; closeCashSession: BillAction<{ expected: number; variance: number }>; onChanged: () => void;
}) {
  const money = (v: number) => formatMoney(v, currency);
  const [float, setFloat] = useState("");
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [closing, setClosing] = useState(false);
  const [openState, openAction, opening] = useBillAction(openCashSession, { onOk: onChanged });
  const [closeState, closeAction, closePending] = useBillAction(closeCashSession, { onOk: () => { setClosing(false); onChanged(); } });
  const floatValue = parseMoneyInputOrNull(float, currency);
  const countedValue = parseMoneyInputOrNull(counted, currency);
  const variance = countedValue === null ? null : cashVariance(countedValue, expectedSoFar);
  const noteOk = variance === null ? false : closeNoteOk(variance, note);
  const time = session ? new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", { timeStyle: "short" }).format(new Date(session.openedAt)) : "";

  return (
    <section className={`${card} flex flex-col gap-3`} aria-label={t.session.heading}>
      <h2 className="text-xl font-bold">{t.session.heading}</h2>
      {!session ? (
        <form action={openAction} className="flex flex-col gap-2">
          <p className="text-base">{t.session.none} {t.session.openPrompt}</p>
          <label htmlFor="float" className="text-base font-semibold">{t.session.float}</label>
          <input type="hidden" name="openingFloat" value={floatValue ?? ""} />
          <div className="flex gap-2">
            <input id="float" inputMode="numeric" autoComplete="off" value={float} onChange={(e) => setFloat(e.target.value)} className={inputCls} />
            <button type="submit" disabled={opening || floatValue === null} className={`${btnPrimary} shrink-0`}>{opening ? t.session.opening : t.session.open}</button>
          </div>
          {openState && !openState.ok ? <p role="alert" className={errorCls}>{openState.formError ?? t.pay.errors.failed}</p> : null}
        </form>
      ) : (
        <>
          <p className="text-base">{fmt(t.session.since, { time })} · {fmt(t.session.openingFloat, { amount: money(session.openingFloat) })}</p>
          {!closing ? (
            <button type="button" className={`${btnGhost} self-start`} onClick={() => setClosing(true)}>{t.session.showClose}</button>
          ) : (
            <form action={closeAction} className="flex flex-col gap-3">
              <h3 className="text-lg font-bold">{t.session.closeHeading}</h3>
              <input type="hidden" name="sessionId" value={session.id} />
              <input type="hidden" name="countedCash" value={countedValue ?? ""} />
              <p className="text-base"><span className="font-semibold">{t.session.expected}:</span> {money(expectedSoFar)}</p>
              <label htmlFor="counted" className="text-base font-semibold">{t.session.counted}</label>
              <input id="counted" inputMode="numeric" autoComplete="off" value={counted} onChange={(e) => setCounted(e.target.value)} className={inputCls} />
              {variance !== null ? (
                <p role="status" className={`text-lg font-bold ${variance === 0 ? "" : "text-red-700 dark:text-red-400"}`}>
                  {t.session.variance}: {variance === 0 ? t.session.matches : variance < 0 ? fmt(t.session.short, { amount: money(-variance) }) : fmt(t.session.over, { amount: money(variance) })}
                </p>
              ) : null}
              {variance !== null && closeNeedsNote(variance) ? (
                <>
                  <label htmlFor="close-note" className="text-base font-semibold">{t.session.note}</label>
                  <textarea id="close-note" name="note" rows={2} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} className={`${inputCls} py-2`} aria-describedby="close-note-hint" />
                  <p id="close-note-hint" className="text-sm">{t.session.noteRequired}</p>
                </>
              ) : null}
              {closeState && !closeState.ok ? <p role="alert" className={errorCls}>{closeState.formError ?? t.pay.errors.failed}</p> : null}
              <div className="flex gap-2">
                <button type="submit" disabled={closePending || variance === null || !noteOk} className={btnPrimary}>{closePending ? t.session.closing : t.session.close}</button>
                <button type="button" className={btnGhost} onClick={() => setClosing(false)}>{t.session.cancel}</button>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  );
}
