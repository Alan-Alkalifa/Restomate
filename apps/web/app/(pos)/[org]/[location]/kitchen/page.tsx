import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { KitchenBoard } from "@/components/kitchen/KitchenBoard";
import { KitchenSkeleton } from "@/components/kitchen/KitchenSkeleton";
import type { KitchenActions } from "@/components/kitchen/TicketCard";
import { isLocale, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { requireOrgContext, requirePermission } from "@/lib/auth/dal";
import { getLocationMenu } from "@/lib/menu/data";
import * as kds from "./_actions";
import { getKdsTickets } from "./_data";

export const metadata: Metadata = { title: "Kitchen · Restomate", robots: { index: false } };

type Props = PageProps<"/[org]/[location]/kitchen">;

async function Kitchen({ params, searchParams }: { params: Props["params"]; searchParams: Props["searchParams"] }) {
  const [{ org, location }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireOrgContext(org); // notFound() for non-members and other organizations
  await requirePermission(ctx.org.id, "kitchen.view"); // forbidden() otherwise; the UI never relies on hiding alone
  const loc = ctx.locations.find((l) => l.id === location);
  if (!loc) notFound(); // a location the user cannot access looks the same as one that does not exist

  // English by default (the (pos) tree is lang="en"); `?lang=id` switches the screen to Bahasa Indonesia.
  const locale: Locale = isLocale(sp.lang) ? sp.lang : "en";
  const [t, payload, menu] = await Promise.all([
    getDictionary(locale).then((d) => d.kitchen),
    getKdsTickets(ctx.org.slug, loc.id),
    getLocationMenu(ctx.org.slug, loc.id), // station names for the filter (any member with access to the location)
  ]);

  // Org slug and location id are bound here, on the server. The client never sends either.
  const slug = ctx.org.slug;
  const actions: KitchenActions = {
    updateKotStatus: kds.updateKotStatus.bind(null, slug, loc.id),
    bumpKot: kds.bumpKot.bind(null, slug, loc.id),
    setKotItemStatus: kds.setKotItemStatus.bind(null, slug, loc.id),
  };
  const base = `/${slug}/${loc.id}/kitchen`;
  const languages = (["en", "id"] as const).map((l) => ({
    id: l, label: l === "en" ? "English" : "Bahasa Indonesia", current: l === locale, href: l === "en" ? base : `${base}?lang=id`,
  }));

  return (
    <div lang={locale}>
      <KitchenBoard
        payload={payload}
        stations={menu.stations.filter((s) => s.isActive).map((s) => ({ id: s.id, name: s.name }))}
        locationId={loc.id}
        locationName={loc.name}
        canUpdate={ctx.permissions.includes("kitchen.update")}
        actions={actions}
        t={t}
        languages={languages}
      />
    </div>
  );
}

export default function KitchenPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<KitchenSkeleton />}>
      <Kitchen params={params} searchParams={searchParams} />
    </Suspense>
  );
}
