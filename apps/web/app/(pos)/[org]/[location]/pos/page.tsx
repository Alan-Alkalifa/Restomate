import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PosScreen } from "@/components/pos/PosScreen";
import { buildCatalog } from "@/components/pos/pos-model";
import { requireOrgContext, requirePermission } from "@/lib/auth/dal";
import { getLocationMenu, getMenu } from "@/lib/menu/data";

export const metadata: Metadata = { title: "POS · Restomate", robots: { index: false } };

async function Pos({ params }: { params: PageProps<"/[org]/[location]/pos">["params"] }) {
  const { org, location } = await params;
  const ctx = await requireOrgContext(org); // notFound() for non-members
  await requirePermission(ctx.org.id, "orders.create"); // forbidden() otherwise; the UI never relies on hiding alone
  const loc = ctx.locations.find((l) => l.id === location);
  if (!loc) notFound(); // a location the user cannot access looks the same as one that does not exist
  // getLocationMenu has prices, availability and sold-out; getMenu has the variants and modifier groups it lacks.
  const [menu, locationMenu] = await Promise.all([getMenu(org), getLocationMenu(org, loc.id)]);
  const catalog = buildCatalog({ ...menu, currency: locationMenu.currency }, locationMenu, new Date());
  return <PosScreen catalog={catalog} orgSlug={ctx.org.slug} locationId={loc.id} locationName={loc.name} />;
}

export default function PosPage({ params }: PageProps<"/[org]/[location]/pos">) {
  return (
    <Suspense fallback={<div role="status" aria-label="Loading POS" className="fixed inset-0 animate-pulse bg-neutral-100 dark:bg-neutral-900" />}>
      <Pos params={params} />
    </Suspense>
  );
}
