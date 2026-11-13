"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/money";
import { fmt } from "@/i18n/config";
import type { BillsDictionary } from "@/i18n/types";
import { createAttemptTracker, parsePositiveAmount, refundableLeft, type BillAction, type PaymentRow } from "./bills-model";
import { useBillAction } from "./use-bill-action";
import { btnGhost, btnPrimary, errorCls, inputCls } from "./ui";

/** Refund one payment (payments.refund only): amount + reason. Recorded manually; there is no gateway refund in M3. */
export function RefundPanel({ payment, currency, t, hasOpenSession, recordRefund, onDone }: {
  payment: PaymentRow; currency: string; t: BillsDictionary; hasOpenSession: boolean;
  recordRefund: BillAction<{ refundId: string }>; onDone: () => void;
}) {
  const money = (v: number) => formatMoney(v, currency);
  const left = refundableLeft(payment);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(left));
  const [reason, setReason] = useState("");
  const [tracker] = useState(() => createAttemptTracker());
  const [state, formAction, pending] = useBillAction(recordRefund, { tracker, onOk: () => { setOpen(false); onDone(); } });
  const parsed = parsePositiveAmount(amount, currency);
  const tooMuch = parsed.ok && parsed.value > left;
  const reasonOk = reason.trim().length >= 3 && reason.trim().length <= 200;
  const needsSession = payment.method === "cash" && !hasOpenSession;
  if (left === 0) return null;
  if (!open) return <button type="button" className={btnGhost} onClick={() => setOpen(true)}>{t.refund.show}</button>;
  return (
    <form action={formAction} className="mt-2 flex flex-col gap-2 rounded-lg bg-neutral-50 p-3 dark:bg-neutral-900" aria-label={t.refund.heading}>
      <input type="hidden" name="paymentId" value={payment.id} />
      <input type="hidden" name="amount" value={parsed.ok && !tooMuch ? parsed.value : ""} />
      <p className="text-sm">{fmt(t.refund.left, { amount: money(left) })}</p>
      <label htmlFor={`rf-amount-${payment.id}`} className="text-base font-semibold">{t.refund.amount}</label>
      <input id={`rf-amount-${payment.id}`} inputMode="numeric" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
      {tooMuch ? <p role="alert" className={errorCls}>{t.refund.errors.exceeds}</p> : null}
      <label htmlFor={`rf-reason-${payment.id}`} className="text-base font-semibold">{t.refund.reason} <span className="font-normal">({t.refund.reasonHint})</span></label>
      <input id={`rf-reason-${payment.id}`} name="reason" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} />
      <p className="text-sm">{t.refund.manualNote}</p>
      {needsSession ? <p role="status" className="text-base font-medium">{t.refund.cashNeedsSession}</p> : null}
      {state && !state.ok ? <p role="alert" className={errorCls}>{state.formError ?? t.pay.errors.failed}</p> : null}
      <div className="flex gap-2">
        <button type="submit" disabled={pending || !parsed.ok || tooMuch || !reasonOk || needsSession} className={btnPrimary}>{pending ? t.refund.pending : t.refund.submit}</button>
        <button type="button" className={btnGhost} onClick={() => setOpen(false)}>{t.session.cancel}</button>
      </div>
    </form>
  );
}

/** Void the whole bill set. A set that holds money cannot be voided: it says "refund first" instead of offering the form. */
export function VoidPanel({ billSetId, hasPayments, t, voidBillSet, onDone }: {
  billSetId: string; hasPayments: boolean; t: BillsDictionary; voidBillSet: BillAction; onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [state, formAction, pending] = useBillAction(voidBillSet, { onOk: onDone });
  if (hasPayments) return <p role="note" className="text-base font-medium">{t.void.refundFirst}</p>;
  if (!open) return <button type="button" className={btnGhost} onClick={() => setOpen(true)}>{t.void.show}</button>;
  return (
    <form action={formAction} className="flex flex-col gap-2 rounded-lg bg-neutral-50 p-3 dark:bg-neutral-900" aria-label={t.void.heading}>
      <input type="hidden" name="billSetId" value={billSetId} />
      <p className="text-base">{t.void.confirm}</p>
      <label htmlFor="void-reason" className="text-base font-semibold">{t.void.reason} <span className="font-normal">({t.refund.reasonHint})</span></label>
      <input id="void-reason" name="reason" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} />
      {state && !state.ok ? <p role="alert" className={errorCls}>{state.formError ?? t.pay.errors.failed}</p> : null}
      <div className="flex gap-2">
        <button type="submit" disabled={pending || reason.trim().length < 3} className={btnPrimary}>{pending ? t.void.pending : t.void.submit}</button>
        <button type="button" className={btnGhost} onClick={() => setOpen(false)}>{t.session.cancel}</button>
      </div>
    </form>
  );
}
