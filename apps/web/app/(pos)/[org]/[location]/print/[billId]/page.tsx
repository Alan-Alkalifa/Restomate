import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BillPrint } from "@/components/print/bill/BillPrint";
import { parsePrintSize, type PrintSize } from "@/components/print/bill/bill-print-model";
import { isLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { requireOrgContext, requirePermission } from "@/lib/auth/dal";
import { getStorefront } from "@/lib/storefront/get-storefront";
import { can, getBillPrintData } from "../../bills/_data";
import * as bills from "../../bills/_actions";

export const metadata: Metadata = { title: "Print bill · Restomate", robots: { index: false } };

type Props = PageProps<"/[org]/[location]/print/[billId]">;

async function Print({ params, searchParams }: { params: Props["params"]; searchParams: Props["searchParams"] }) {
  const [{ org, location, billId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireOrgContext(org); // notFound() for non-members and other organizations
  if (!can(ctx, "payments.view") && !can(ctx, "bills.print")) await requirePermission(ctx.org.id, "payments.view"); // forbidden()
  const loc = ctx.locations.find((l) => l.id === location);
  if (!loc) notFound();
  const data = await getBillPrintData(ctx.org.slug, loc.id, billId);
  if (!data) notFound(); // a bill of another location or organization is a plain 404

  // The receipt is customer-facing: Bahasa Indonesia by default, `?lang=en` for English. `?size=58` for 58 mm paper.
  const locale = isLocale(sp.lang) ? sp.lang : "id";
  const size = parsePrintSize(sp.size);
  const t = await getDictionary(locale).then((d) => d.bills);
  // Public branding only (an https logo, or none). A failure here must never block printing.
  const store = await getStorefront(ctx.org.slug).catch(() => null);
  const logoUrl = store && store.status === "active" ? store.branding.logoUrl : null;

  const base = `/${ctx.org.slug}/${loc.id}/print/${data.bill.id}`;
  const href = (s: PrintSize, l: "id" | "en") => `${base}?size=${s}${l === "en" ? "&lang=en" : ""}`;
  return (
    <div lang={locale}>
      <BillPrint
        data={data} t={t} locale={locale} size={size} logoUrl={logoUrl}
        recordPrint={bills.recordBillPrint.bind(null, ctx.org.slug, loc.id)}
        sizeLinks={[{ size: "80", href: href("80", locale), label: t.print.size80 }, { size: "58", href: href("58", locale), label: t.print.size58 }]}
        languageLinks={(["id", "en"] as const).map((l) => ({ id: l, label: l === "id" ? "Bahasa Indonesia" : "English", href: href(size, l), current: l === locale }))}
      />
    </div>
  );
}

export default function PrintPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<div role="status" aria-label="Loading bill" className="mx-auto mt-10 h-96 max-w-xl animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-800" />}>
      <Print params={params} searchParams={searchParams} />
    </Suspense>
  );
}
