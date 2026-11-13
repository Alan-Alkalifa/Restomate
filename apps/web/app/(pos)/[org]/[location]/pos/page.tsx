import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PosScreen } from "@/components/pos/PosScreen";
import { buildCatalog } from "@/components/pos/pos-model";
import { isLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { requireOrgContext, requirePermission } from "@/lib/auth/dal";
import { toggleSoldOut } from "@/lib/menu/actions";
import { getLocationMenu, getMenu } from "@/lib/menu/data";

export const metadata: Metadata = { title: "POS · Restomate", robots: { index: false } };

type Props = PageProps<"/[org]/[location]/pos">;

async function Pos({ params, searchParams }: { params: Props["params"]; searchParams: Props["searchParams"] }) {
  const [{ org, location }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireOrgContext(org); // notFound() for non-members
  await requirePermission(ctx.org.id, "orders.create"); // forbidden() otherwise; the UI never relies on hiding alone
  const loc = ctx.locations.find((l) => l.id === location);
  if (!loc) notFound(); // a location the user cannot access looks the same as one that does not exist
  // getLocationMenu has prices, availability and sold-out; getMenu has the variants and modifier groups it lacks.
  const [menu, locationMenu] = await Promise.all([getMenu(org), getLocationMenu(org, loc.id)]);
  const catalog = buildCatalog({ ...menu, currency: locationMenu.currency }, locationMenu, new Date());
  // The sold-out feature is translated; English by default (this tree is lang="en"), `?lang=id` for Bahasa Indonesia.
  const locale: Locale = isLocale(sp.lang) ? sp.lang : "en";
  const t = await getDictionary(locale).then((d) => d.pos);
  return (
    <PosScreen
      catalog={catalog} orgSlug={ctx.org.slug} locationId={loc.id} locationName={loc.name} t={t} locale={locale}
      // Org slug and location id are bound here, on the server. The client sends only { itemId, soldOut }.
      toggleSoldOut={toggleSoldOut.bind(null, ctx.org.slug, loc.id)}
    />
  );
}

export default function PosPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<div role="status" aria-label="Loading POS" className="fixed inset-0 animate-pulse bg-neutral-100 dark:bg-neutral-900" />}>
      <Pos params={params} searchParams={searchParams} />
    </Suspense>
  );
}
