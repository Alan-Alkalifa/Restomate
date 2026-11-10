import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireOrgContext } from "@/app/(dashboard)/_data";
import { LocationMenu } from "@/components/menu/location/LocationMenu";
import { MenuTabs } from "@/components/menu/MenuTabs";
import * as menu from "@/lib/menu/actions";
import { getLocationMenu } from "@/lib/menu/data";
import { LocationMenuSkeleton } from "./skeleton";

export const metadata: Metadata = { title: "Location menu · Restomate" };

async function Content({ params }: { params: PageProps<"/[org]/[location]/menu">["params"] }) {
  const { org, location } = await params;
  const ctx = await requireOrgContext(org);
  // Same answer for an unknown location and one this member cannot access.
  const loc = ctx.locations.find((l) => l.id === location);
  if (!loc) notFound();
  const data = await getLocationMenu(ctx.org.slug, loc.id);
  const slug = ctx.org.slug;
  // Org slug and location id are bound here, on the server. The client never sends either.
  const actions = {
    setLocationOverride: menu.setLocationOverride.bind(null, slug, loc.id),
    toggleSoldOut: menu.toggleSoldOut.bind(null, slug, loc.id),
    createStation: menu.createStation.bind(null, slug, loc.id),
    renameStation: menu.renameStation.bind(null, slug, loc.id),
    setStationActive: menu.setStationActive.bind(null, slug, loc.id),
  };
  return (
    <main className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold">Menu</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">{loc.name}</p>
      </header>
      <MenuTabs orgSlug={slug} locationId={loc.id} current="location" canManage={ctx.permissions.includes("menu.manage")} />
      {/* key: switching location remounts the list, so no dialog or notice from the old location survives. */}
      <LocationMenu key={loc.id} data={data} actions={actions} nowIso={new Date().toISOString()} />
    </main>
  );
}

export default function LocationMenuPage({ params }: PageProps<"/[org]/[location]/menu">) {
  return (
    <Suspense fallback={<LocationMenuSkeleton />}>
      <Content params={params} />
    </Suspense>
  );
}
