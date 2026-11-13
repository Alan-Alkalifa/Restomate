"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/money";
import { fmt } from "@/i18n/config";
import type { BillsDictionary } from "@/i18n/types";
import { checkPayment, createAttemptTracker, type BillAction, type BillRow, type PaymentMethod, type PaymentOutcome } from "./bills-model";
import { useBillAction } from "./use-bill-action";
import { btnGhost, btnPrimary, card, errorCls, inputCls } from "./ui";

const METHODS: PaymentMethod[] = ["cash", "edc_card", "other"];

/**
 * Take a payment on one bill: cash (amount + tendered, shows change; needs an open cash session), EDC card (optional
 * approval code, NO card data field), other (label). Partial payments are normal. The payment is posted with ONE
 * clientRef per attempt, reused if the same request is retried, so a flaky connection can never double-charge.
 */
export function PaymentPanel({ bill, currency, t, hasOpenSession, online, recordPayment, onPaid }: {
  bill: BillRow; currency: string; t: BillsDictionary; hasOpenSession: boolean; online: boolean;
  recordPayment: BillAction<PaymentOutcome>; onPaid: (o: PaymentOutcome) => void;
}) {
  const money = (v: number) => formatMoney(v, currency);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [amount, setAmount] = useState(String(bill.outstanding));
  const [tendered, setTendered] = useState("");
  const [methodLabel, setMethodLabel] = useState("");
  const [approvalCode, setApprovalCode] = useState("");
  const [tracker] = useState(() => createAttemptTracker());
  const [state, formAction, pending] = useBillAction(recordPayment, { tracker, onOk: onPaid });
  const check = checkPayment({ method, amount, tendered, methodLabel, approvalCode }, currency, bill.outstanding);
  const needsSession = method === "cash" && !hasOpenSession;
  const digits = (v: string) => v.replace(/[^\d.,\sRrPp]/g, "");
  const reason = !check.ok ? check : null;
  const serverError = state && !state.ok ? (state.formError ?? t.pay.errors.failed) : null;

  const fieldError = (field: string): string | null => {
    if (!reason || reason.field !== field || (field === "amount" && amount === "") || (field === "tendered" && tendered === "")) return null;
    if (reason.reason === "exceeds") return fmt(t.pay.errors.exceeds, { outstanding: money(bill.outstanding) });
    if (reason.reason === "tendered_low") return t.pay.errors.tenderedLow;
    if (reason.reason === "required") return t.pay.errors.label;
    if (reason.reason === "format") return t.pay.errors.approval;
    return reason.message ?? null;
  };

  return (
    <form action={formAction} className={`${card} flex flex-col gap-4`} aria-label={t.pay.heading}>
      <h3 className="text-xl font-bold">{t.pay.heading}</h3>
      <input type="hidden" name="billId" value={bill.id} />
      <input type="hidden" name="method" value={method} />
      {/* The server gets whole-Rupiah integers parsed by lib/money, never the typed text. */}
      <input type="hidden" name="amount" value={check.ok ? check.amount : ""} />
      {method === "cash" && check.ok && check.tendered !== null ? <input type="hidden" name="tendered" value={check.tendered} /> : null}
      {method === "other" ? <input type="hidden" name="methodLabel" value={methodLabel.trim()} /> : null}
      {method === "edc_card" && approvalCode.trim() ? <input type="hidden" name="approvalCode" value={approvalCode.trim()} /> : null}

      <div role="radiogroup" aria-label={t.pay.heading} className="grid grid-cols-3 gap-2">
        {METHODS.map((m) => (
          <label key={m} className={`flex min-h-14 cursor-pointer items-center justify-center rounded-lg px-2 text-center text-lg font-semibold ring-1 ${method === m ? "bg-teal-700 text-white ring-teal-800" : "ring-neutral-400"}`}>
            <input type="radio" name="methodUi" className="sr-only" checked={method === m} onChange={() => setMethod(m)} />
            {t.pay.method[m]}
          </label>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="pay-amount" className="text-base font-semibold">{t.pay.amount}</label>
        <div className="flex gap-2">
          <input id="pay-amount" inputMode="numeric" autoComplete="off" value={amount} onChange={(e) => setAmount(digits(e.target.value))} aria-invalid={!!fieldError("amount")} className={inputCls} />
          <button type="button" className={`${btnGhost} shrink-0`} onClick={() => setAmount(String(bill.outstanding))}>{t.pay.payRest}</button>
        </div>
        {fieldError("amount") ? <p role="alert" className={errorCls}>{fieldError("amount")}</p> : null}
      </div>

      {method === "cash" ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="pay-tendered" className="text-base font-semibold">{t.pay.tendered}</label>
          <input id="pay-tendered" inputMode="numeric" autoComplete="off" value={tendered} onChange={(e) => setTendered(digits(e.target.value))} aria-invalid={!!fieldError("tendered")} className={inputCls} />
          {fieldError("tendered") ? <p role="alert" className={errorCls}>{fieldError("tendered")}</p> : null}
          {check.ok && check.change !== null ? <p role="status" className="text-xl font-bold">{t.pay.change}: {money(check.change)}</p> : null}
        </div>
      ) : null}

      {method === "other" ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="pay-label" className="text-base font-semibold">{t.pay.methodLabel}</label>
          <input id="pay-label" maxLength={40} value={methodLabel} onChange={(e) => setMethodLabel(e.target.value)} className={inputCls} aria-describedby="pay-label-hint" />
          <p id="pay-label-hint" className="text-sm">{t.pay.methodLabelHint}</p>
        </div>
      ) : null}

      {method === "edc_card" ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="pay-approval" className="text-base font-semibold">{t.pay.approval}</label>
          {/* The terminal's approval code only. There is deliberately no card number / expiry / CVV field. */}
          <input id="pay-approval" maxLength={12} autoComplete="off" value={approvalCode} onChange={(e) => setApprovalCode(e.target.value)} className={inputCls} aria-describedby="pay-approval-hint" aria-invalid={!!fieldError("approvalCode")} />
          <p id="pay-approval-hint" className="text-sm">{t.pay.approvalHint}</p>
          {fieldError("approvalCode") ? <p role="alert" className={errorCls}>{fieldError("approvalCode")}</p> : null}
        </div>
      ) : null}

      {needsSession ? <p role="status" className="rounded bg-amber-100 px-3 py-2 text-base font-medium text-amber-950">{t.session.openPrompt}</p> : null}
      {serverError ? <p role="alert" className={errorCls}>{serverError}</p> : null}
      <button type="submit" disabled={pending || !check.ok || needsSession || !online} className={`${btnPrimary} self-start`}>{pending ? t.pay.pending : t.pay.submit}</button>
    </form>
  );
}
