import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireOrgContext, requirePermission } from "@/app/(dashboard)/_data";
import { ForbiddenNotice } from "@/components/dashboard/notices";
import { FloorPlan } from "@/components/venue/floor/FloorPlan";
import { saveTablePositions } from "@/lib/venue/actions";
import { getVenue } from "@/lib/venue/data";
import { TablesNav } from "../nav";
import { FloorSkeleton } from "./skeleton";

export const metadata: Metadata = { title: "Floor plan · Restomate" };

async function Floor({ params }: { params: PageProps<"/[org]/[location]/tables/floor">["params"] }) {
  const { org, location } = await params;
  const ctx = await requireOrgContext(org);
  const loc = ctx.locations.find((l) => l.id === location);
  if (!loc) notFound();
  if (!ctx.permissions.includes("tables.view")) return <ForbiddenNotice />;
  await requirePermission(ctx.org.id, "tables.view");
  const data = await getVenue(ctx.org.slug, loc.id);
  // Org slug and location id are bound on the server; the client sends only `positions`.
  const save = saveTablePositions.bind(null, ctx.org.slug, loc.id);
  return (
    <main className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold">Floor plan</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">{loc.name}</p>
      </header>
      <TablesNav base={`/${ctx.org.slug}/${loc.id}/tables`} current="floor" />
      {/* key: switching location remounts the editor, so a drag or unsaved state never carries over. */}
      <FloorPlan key={loc.id} data={data} saveAction={save} />
    </main>
  );
}

export default function FloorPage({ params }: PageProps<"/[org]/[location]/tables/floor">) {
  return (
    <Suspense fallback={<FloorSkeleton />}>
      <Floor params={params} />
    </Suspense>
  );
}
