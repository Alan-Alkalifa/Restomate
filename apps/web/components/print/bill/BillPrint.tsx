"use client";

import Link from "next/link";
import { useState } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";
import type { BillAction } from "@/components/bills/bills-model";
import type { BillsDictionary } from "@/i18n/types";
import { BillReceipt } from "./BillReceipt";
import { buildReceipt, type BillPrintData, type PrintSize } from "./bill-print-model";

type Props = {
  data: BillPrintData;
  t: BillsDictionary;
  locale: "id" | "en";
  size: PrintSize;
  logoUrl: string | null;
  /** Bound on the server (orgSlug, locationId); posts only the bill id. */
  recordPrint: BillAction<{ printCount: number; duplicate: boolean }>;
  sizeLinks: { size: PrintSize; href: string; label: string }[];
  languageLinks: { id: string; label: string; href: string; current: boolean }[];
};

/**
 * Preview + Print. Printing is an explicit tap (never a side effect of loading the page, so a refresh or a link
 * prefetch cannot inflate the print count): the print is recorded on the server FIRST, the DUPLICATE mark comes from
 * its result, and only then does the browser print.
 */
export function BillPrint({ data, t, locale, size, logoUrl, recordPrint, sizeLinks, languageLinks }: Props) {
  const router = useRouter();
  const [duplicate, setDuplicate] = useState(data.duplicate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const receipt = buildReceipt(data, t.receipt, { locale, duplicate });
  const btn = "flex min-h-12 items-center rounded-lg px-4 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700";

  async function onPrint() {
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("billId", data.bill.id);
    const r = await recordPrint(null, fd);
    if (!r.ok) {
      setBusy(false);
      setError(r.formError ?? t.print.failed);
      return;
    }
    flushSync(() => setDuplicate(r.data.duplicate)); // the mark must be in the DOM before the print dialog opens
    window.print();
    setBusy(false);
    router.refresh(); // the next preview starts from the new print count
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 p-4">
      <div className="no-print flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => router.back()} className={`${btn} underline`}>{t.print.back}</button>
          <nav aria-label={t.print.paper} className="flex gap-1">
            {sizeLinks.map((l) => (l.size === size
              ? <span key={l.size} aria-current="true" className={`${btn} bg-neutral-200 dark:bg-neutral-800`}>{l.label}</span>
              : <Link key={l.size} href={l.href} replace className={`${btn} ring-1 ring-neutral-400`}>{l.label}</Link>))}
          </nav>
          <nav aria-label={t.print.language} className="flex gap-1">
            {languageLinks.map((l) => (l.current
              ? <span key={l.id} lang={l.id} aria-current="true" className={`${btn} font-bold`}>{l.label}</span>
              : <a key={l.id} lang={l.id} hrefLang={l.id} href={l.href} className={`${btn} underline`}>{l.label}</a>))}
          </nav>
          <button type="button" onClick={onPrint} disabled={busy} className={`${btn} ml-auto bg-teal-700 text-white hover:bg-teal-800 disabled:opacity-60`}>
            {busy ? t.print.printing : data.paymentStatus === null ? t.prebill.print : t.print.print}
          </button>
        </div>
        {duplicate ? <p role="status" className="rounded bg-amber-100 px-3 py-2 text-sm font-medium text-amber-950">{t.print.duplicateNote}</p> : null}
        {error ? <p role="alert" className="rounded bg-red-100 px-3 py-2 text-sm font-medium text-red-950">{error}</p> : null}
      </div>
      <div className="overflow-x-auto rounded-lg border border-neutral-300 bg-white p-4 print:border-0 print:p-0">
        <BillReceipt receipt={receipt} size={size} logoUrl={logoUrl} />
      </div>
    </div>
  );
}
