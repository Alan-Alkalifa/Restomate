import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireOrgContext, requirePermission } from "@/app/(dashboard)/_data";
import { ForbiddenNotice } from "@/components/dashboard/notices";
import { VenueManager } from "@/components/venue/VenueManager";
import { createArea, createTable, renameArea, reorderAreas, rotateTableQr, setAreaActive, setTableActive, updateTable } from "@/lib/venue/actions";
import { getVenue } from "@/lib/venue/data";
import { TablesNav } from "./nav";
import { TablesSkeleton } from "./skeleton";

export const metadata: Metadata = { title: "Tables · Restomate" };

async function Tables({ params }: { params: PageProps<"/[org]/[location]/tables">["params"] }) {
  const { org, location } = await params;
  const ctx = await requireOrgContext(org);
  // Same answer for an unknown location and one this member cannot access.
  const loc = ctx.locations.find((l) => l.id === location);
  if (!loc) notFound();
  if (!ctx.permissions.includes("tables.view")) return <ForbiddenNotice />;
  await requirePermission(ctx.org.id, "tables.view");
  const data = await getVenue(ctx.org.slug, loc.id);
  // The org slug and location id are bound here, on the server. The client never sends an organization or location.
  const slug = ctx.org.slug;
  const actions = {
    createArea: createArea.bind(null, slug, loc.id),
    renameArea: renameArea.bind(null, slug, loc.id),
    setAreaActive: setAreaActive.bind(null, slug, loc.id),
    reorderAreas: reorderAreas.bind(null, slug, loc.id),
    createTable: createTable.bind(null, slug, loc.id),
    updateTable: updateTable.bind(null, slug, loc.id),
    setTableActive: setTableActive.bind(null, slug, loc.id),
    rotateTableQr: rotateTableQr.bind(null, slug, loc.id),
  };
  return (
    <main className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold">Tables</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">{loc.name}</p>
      </header>
      <TablesNav base={`/${slug}/${loc.id}/tables`} current="list" />
      {/* key: switching location remounts everything, so no dialog or notice from the old location survives. */}
      <VenueManager key={loc.id} data={data} actions={actions} upgradeHref={`/${slug}/settings`} />
    </main>
  );
}

export default function TablesPage({ params }: PageProps<"/[org]/[location]/tables">) {
  return (
    <Suspense fallback={<TablesSkeleton />}>
      <Tables params={params} />
    </Suspense>
  );
}
