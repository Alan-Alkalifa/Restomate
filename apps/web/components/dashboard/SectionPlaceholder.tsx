import { notFound } from "next/navigation";
import { connection } from "next/server";
import { hasFeature, requireOrgContext, requirePermission } from "@/app/(dashboard)/_data";
import { ForbiddenNotice, UpgradeNotice } from "./notices";
import { NAV_ITEMS } from "./nav";

/** Server component: every placeholder re-checks permission and package feature server-side. */
export async function SectionPlaceholder({
  orgSlug,
  section,
  locationId,
}: {
  orgSlug: string;
  section: string;
  locationId?: string;
}) {
  const item = NAV_ITEMS.find((i) => i.key === section && (locationId ? i.scope === "location" : i.scope === "org"));
  if (!item) notFound();
  await connection(); // session checks read the clock: request time only, never the prerender
  const ctx = await requireOrgContext(orgSlug);
  let locationName: string | null = null;
  if (locationId) {
    const loc = ctx.locations.find((l) => l.id === locationId);
    if (!loc) notFound(); // not accessible to this user
    locationName = loc.name;
  }
  if (!ctx.permissions.includes(item.permission)) return <ForbiddenNotice />;
  await requirePermission(ctx.org.id, item.permission);
  if (item.feature && !hasFeature(ctx, item.feature)) {
    return <UpgradeNotice feature={item.feature} orgSlug={ctx.org.slug} />;
  }
  return (
    <main className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">{item.label}</h1>
      {locationName && <p className="text-sm text-neutral-600 dark:text-neutral-400">{locationName}</p>}
      <p role="status">Coming in {item.milestone}.</p>
    </main>
  );
}
