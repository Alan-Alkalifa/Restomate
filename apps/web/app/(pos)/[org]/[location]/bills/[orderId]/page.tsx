import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BillsScreen, type BillsActions } from "@/components/bills/BillsScreen";
import { BillsSkeleton } from "@/components/bills/BillsSkeleton";
import { isLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { requireOrgContext, requirePermission } from "@/lib/auth/dal";
import * as bills from "../_actions";
import { getBillSet, getBillableOrder, getOpenCashSession, can } from "../_data";

export const metadata: Metadata = { title: "Bill · Restomate", robots: { index: false } };

type Props = PageProps<"/[org]/[location]/bills/[orderId]">;

async function Bill({ params, searchParams }: { params: Props["params"]; searchParams: Props["searchParams"] }) {
  const [{ org, location, orderId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireOrgContext(org); // notFound() for non-members and other organizations
  // Bills are visible to payments.view (cashier/manager/owner) or bills.print (waiter, pre-bill only). Nobody else.
  if (!can(ctx, "payments.view") && !can(ctx, "bills.print")) await requirePermission(ctx.org.id, "payments.view"); // forbidden()
  const loc = ctx.locations.find((l) => l.id === location);
  if (!loc) notFound(); // a location the user cannot access looks the same as one that does not exist

  const perms = { take: can(ctx, "payments.take"), refund: can(ctx, "payments.refund"), viewPayments: can(ctx, "payments.view"), print: can(ctx, "payments.view") || can(ctx, "bills.print") };
  const [order, set, cash] = await Promise.all([
    getBillableOrder(ctx.org.slug, loc.id, orderId),
    getBillSet(ctx.org.slug, loc.id, orderId),
    perms.viewPayments ? getOpenCashSession(ctx.org.slug, loc.id) : Promise.resolve(null),
  ]);
  if (!order) notFound(); // an order of another location or organization is a plain 404

  // English by default (the (pos) tree is lang="en"); `?lang=id` switches to Bahasa Indonesia.
  const locale: Locale = isLocale(sp.lang) ? sp.lang : "en";
  const t = await getDictionary(locale).then((d) => d.bills);
  const slug = ctx.org.slug;
  // Org slug and location id are bound here, on the server. The client never sends either.
  const actions: BillsActions = {
    createBills: bills.createBills.bind(null, slug, loc.id),
    recordPayment: bills.recordPayment.bind(null, slug, loc.id),
    recordRefund: bills.recordRefund.bind(null, slug, loc.id),
    voidBillSet: bills.voidBillSet.bind(null, slug, loc.id),
    openCashSession: bills.openCashSession.bind(null, slug, loc.id),
    closeCashSession: bills.closeCashSession.bind(null, slug, loc.id),
  } as BillsActions;
  const langQuery = locale === "id" ? "?lang=id" : "";
  return (
    <div lang={locale}>
      <BillsScreen t={t} locale={locale} locationId={loc.id} order={order} set={set} cash={cash} perms={perms} actions={actions}
        printHref={(billId) => `/${slug}/${loc.id}/print/${billId}${langQuery}`} />
    </div>
  );
}

export default function BillPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<BillsSkeleton />}>
      <Bill params={params} searchParams={searchParams} />
    </Suspense>
  );
}
