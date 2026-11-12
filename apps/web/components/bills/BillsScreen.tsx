"use client";

import Link from "next/link";
import { useState } from "react";
import { formatMoney } from "@/lib/money";
import { fmt } from "@/i18n/config";
import type { BillsDictionary } from "@/i18n/types";
import { useBillsFeed } from "./bills-feed";
import {
  canCreateBill, canPay, type BillAction, type BillSetDetail, type BillableOrder, type BillRow, type CashSession, type PaymentOutcome, type PaymentStatus,
} from "./bills-model";
import { CashSessionPanel } from "./CashSessionPanel";
import { PaymentPanel } from "./PaymentPanel";
import { RefundPanel, VoidPanel } from "./RefundVoid";
import { SplitChooser } from "./SplitChooser";
import { btnGhost, card } from "./ui";

export type BillsPerms = { take: boolean; refund: boolean; viewPayments: boolean; print: boolean };
export type BillsActions = {
  createBills: BillAction<{ billSetId: string; replayed: boolean }>;
  recordPayment: BillAction<PaymentOutcome>;
  recordRefund: BillAction<{ refundId: string }>;
  voidBillSet: BillAction;
  openCashSession: BillAction;
  closeCashSession: BillAction<{ expected: number; variance: number }>;
};
type Props = {
  t: BillsDictionary; locale: "id" | "en"; locationId: string; order: BillableOrder; set: BillSetDetail | null;
  cash: { session: CashSession; expectedSoFar: number } | null; perms: BillsPerms; actions: BillsActions; printHref: (billId: string) => string;
};

const CHIP: Record<PaymentStatus, string> = {
  unpaid: "bg-neutral-200 text-neutral-900", partially_paid: "bg-amber-200 text-amber-950", paid: "bg-green-200 text-green-950",
  partially_refunded: "bg-orange-200 text-orange-950", refunded: "bg-red-200 text-red-950",
};

export function BillsScreen({ t, locale, locationId, order, set, cash, perms, actions, printHref }: Props) {
  // Waiters (no payments.view) don't subscribe: the payment signals are behind payments.view.
  const feed = useBillsFeed(locationId, perms.viewPayments);
  const money = (v: number) => formatMoney(v, order.currency);
  const [picked, setPicked] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const bills = set?.bills ?? [];
  const selected: BillRow | undefined = bills.find((b) => b.id === picked) ?? bills.find((b) => canPay(b)) ?? bills[0];
  const down = !feed.online ? "offline" : perms.viewPayments && feed.connection !== "connected" ? "reconnecting" : null;
  const orderLabel = `${fmt(t.order, { number: order.orderNumber })} · ${order.tableLabel ? fmt(t.table, { label: order.tableLabel }) : t.takeaway}`;

  const onPaid = (o: PaymentOutcome) => {
    setNotice([t.pay.done, o.changeGiven ? fmt(t.pay.changeDue, { amount: money(o.changeGiven) }) : null, o.outstanding === 0 ? t.pay.paidInFull : null, o.orderCompleted ? t.pay.orderCompleted : null].filter(Boolean).join(" "));
    feed.refresh();
  };
  const refreshWith = (msg: string) => () => { setNotice(msg); feed.refresh(); };
  const linesOf = (b: BillRow) => (set?.lines ?? []).filter((l) => l.billId === null || l.billId === b.id);
  // Contract: a set that holds money cannot be voided (refund first); a set with payment history needs payments.refund.
  const history = (set?.payments.length ?? 0) > 0;
  const holdsMoney = (set?.payments ?? []).reduce((a, p) => a + p.amount - p.refunded, 0) > 0;
  const canShowVoid = perms.take && (!history || perms.refund);

  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-4 p-4">
      <div role="status" aria-live="polite" data-connection={down ?? "live"}>
        {down ? <p className="rounded-lg bg-amber-200 px-4 py-3 text-center text-lg font-bold text-amber-950"><span aria-hidden>⚠ </span>{down === "offline" ? t.offline : t.reconnecting}</p> : null}
      </div>
      <header>
        <h1 className="text-3xl font-extrabold">{set && !perms.viewPayments ? t.prebill.heading : t.title}</h1>
        <p className="text-lg">{orderLabel}</p>
      </header>
      <div role="status" aria-live="polite">{notice ? <p className="rounded-lg bg-green-100 px-4 py-3 text-lg font-semibold text-green-950">{notice}</p> : null}</div>

      {!set ? (
        canCreateBill(order.status) && (perms.take || perms.print)
          ? <SplitChooser order={order} t={t} createBills={actions.createBills} onCreated={feed.refresh} />
          : <p role="status" className={card}>{t.notBillable}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <ul className="flex flex-col gap-2" aria-label={t.title}>
            {bills.map((b) => (
              <li key={b.id}>
                <button type="button" aria-pressed={b.id === selected?.id} onClick={() => setPicked(b.id)}
                  className={`flex min-h-16 w-full flex-col items-start justify-center rounded-xl px-4 py-2 text-left ring-1 ${b.id === selected?.id ? "bg-teal-50 ring-2 ring-teal-700 dark:bg-teal-950" : "ring-neutral-400"}`}>
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className="text-lg font-bold">{fmt(t.set.billNumber, { number: b.billNumber })}{b.shareCount > 1 ? ` · ${fmt(t.set.share, { k: b.shareNo, n: b.shareCount })}` : ""}</span>
                    {b.paymentStatus ? <span className={`rounded px-2 py-0.5 text-sm font-bold ${CHIP[b.paymentStatus]}`}>{t.set.status[b.paymentStatus]}</span> : null}
                  </span>
                  <span className="text-base tabular-nums">{money(b.total)}{b.paymentStatus && b.outstanding > 0 ? ` · ${t.set.outstanding}: ${money(b.outstanding)}` : ""}</span>
                </button>
              </li>
            ))}
          </ul>

          {selected ? (
            <section className="flex flex-col gap-4" aria-label={fmt(t.set.billNumber, { number: selected.billNumber })}>
              <div className={card}>
                <h2 className="text-xl font-bold">{t.set.items}</h2>
                {set.splitKind === "equal" ? <p className="text-sm">{t.set.allItemsNote}</p> : null}
                <ul className="mt-2 flex flex-col gap-1">
                  {linesOf(selected).map((l) => (
                    <li key={l.id} className="flex justify-between gap-3 text-base"><span>{l.quantity}× {l.name}{l.variantName ? ` (${l.variantName})` : ""}</span><span className="tabular-nums">{money(l.lineTotal)}</span></li>
                  ))}
                </ul>
                <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 border-t border-neutral-300 pt-3 text-base tabular-nums dark:border-neutral-700">
                  <dt>{t.set.subtotal}</dt><dd>{money(selected.subtotal)}</dd>
                  {selected.discount > 0 ? <><dt>{t.set.discount}</dt><dd>-{money(selected.discount)}</dd></> : null}
                  {selected.serviceCharge > 0 ? <><dt>{t.set.serviceCharge}</dt><dd>{money(selected.serviceCharge)}</dd></> : null}
                  {selected.tax > 0 ? <><dt>{t.set.tax}</dt><dd>{money(selected.tax)}</dd></> : null}
                  <dt className="text-xl font-extrabold">{t.set.total}</dt><dd className="text-xl font-extrabold">{money(selected.total)}</dd>
                  {perms.viewPayments ? <><dt>{t.set.paid}</dt><dd>{money(selected.paidTotal)}</dd></> : null}
                  {perms.viewPayments && selected.refundedTotal > 0 ? <><dt>{t.set.refunded}</dt><dd>{money(selected.refundedTotal)}</dd></> : null}
                  {perms.viewPayments ? <><dt className="font-bold">{t.set.outstanding}</dt><dd className="font-bold">{money(selected.outstanding)}</dd></> : null}
                </dl>
                <div className="mt-3 flex flex-wrap gap-2">
                  {perms.print ? <Link href={printHref(selected.id)} className={`${btnGhost} flex items-center`}>{perms.viewPayments ? t.print.print : t.prebill.print}</Link> : null}
                </div>
                {!perms.viewPayments ? <p className="mt-2 text-sm">{t.prebill.note}</p> : null}
              </div>

              {perms.take && perms.viewPayments && canPay(selected) ? (
                <PaymentPanel key={`${selected.id}:${selected.paidTotal}`} bill={selected} currency={order.currency} t={t} hasOpenSession={!!cash} online={feed.online}
                  recordPayment={actions.recordPayment} onPaid={onPaid} />
              ) : null}

              {perms.viewPayments && set.payments.some((p) => p.billId === selected.id) ? (
                <div className={card}>
                  <h3 className="text-lg font-bold">{t.refund.payment}</h3>
                  <ul className="mt-2 flex flex-col gap-3">
                    {set.payments.filter((p) => p.billId === selected.id).map((p) => (
                      <li key={p.id} className="flex flex-col gap-1 border-t border-neutral-300 pt-2 first:border-t-0 first:pt-0 dark:border-neutral-700">
                        <span className="flex justify-between gap-3 text-base">
                          <span>{p.method === "other" && p.methodLabel ? p.methodLabel : (t.pay.method as Record<string, string>)[p.method] ?? p.method}</span>
                          <span className="tabular-nums">{money(p.amount)}{p.refunded > 0 ? ` (−${money(p.refunded)})` : ""}</span>
                        </span>
                        {perms.refund ? <RefundPanel payment={p} currency={order.currency} t={t} hasOpenSession={!!cash} recordRefund={actions.recordRefund} onDone={refreshWith(t.refund.done)} /> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {canShowVoid ? <VoidPanel billSetId={set.billSetId} hasPayments={holdsMoney} t={t} voidBillSet={actions.voidBillSet} onDone={refreshWith(t.void.done)} /> : null}
            </section>
          ) : null}
        </div>
      )}

      {perms.take && perms.viewPayments ? (
        <CashSessionPanel session={cash?.session ?? null} expectedSoFar={cash?.expectedSoFar ?? 0} currency={order.currency} t={t} locale={locale}
          openCashSession={actions.openCashSession} closeCashSession={actions.closeCashSession} onChanged={feed.refresh} />
      ) : null}
    </div>
  );
}
