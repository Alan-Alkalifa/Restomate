import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireOrgContext, requirePermission } from "@/app/(dashboard)/_data";
import { ForbiddenNotice } from "@/components/dashboard/notices";
import { PrintButton } from "@/components/print/qr/PrintButton";
import { qrSvg } from "@/components/print/qr/qr-svg";
import { QrSheet } from "@/components/print/qr/QrSheet";
import { filterByArea, pageCount, parseLayout, type QrCell } from "@/components/print/qr/sheet";
import { getStorefront } from "@/lib/storefront/get-storefront";
import { getTableQrTokens } from "@/lib/venue/data";
import { QrSkeleton } from "./skeleton";

export const metadata: Metadata = { title: "Print QR codes · Restomate", robots: { index: false } };

type P = PageProps<"/[org]/[location]/tables/qr">;

/**
 * Dynamic on purpose: no 'use cache' anywhere on this path, so QR tokens are never stored or put in a cache key.
 * Only tables.manage can reach the tokens (page check + getTableQrTokens + the RPC itself).
 */
async function Qr({ params, searchParams }: { params: P["params"]; searchParams: P["searchParams"] }) {
  const { org, location } = await params;
  const sp = await searchParams;
  const ctx = await requireOrgContext(org);
  const loc = ctx.locations.find((l) => l.id === location);
  if (!loc) notFound();
  if (!ctx.permissions.includes("tables.manage")) return <ForbiddenNotice />;
  await requirePermission(ctx.org.id, "tables.manage");

  const rows = await getTableQrTokens(ctx.org.slug, loc.id);
  const layout = parseLayout(sp.layout);
  const areaParam = typeof sp.area === "string" ? sp.area : "all";
  const areas = [...new Set(rows.map((r) => r.areaName))];
  const picked = filterByArea(rows, areaParam);
  const cells: QrCell[] = await Promise.all(picked.map(async (r) => ({ tableId: r.tableId, label: r.label, areaName: r.areaName, svg: await qrSvg(r.url) })));

  // Public branding only (an https logo, or none). A failure here must never block printing.
  const store = await getStorefront(ctx.org.slug).catch(() => null);
  const logoUrl = store && store.status === "active" ? store.branding.logoUrl : null;

  const base = `/${ctx.org.slug}/${loc.id}/tables/qr`;
  const href = (l: string, a: string) => `${base}?layout=${l}${a !== "all" ? `&area=${encodeURIComponent(a)}` : ""}`;
  const chip = (to: string, label: string, on: boolean) => (
    <Link key={label} href={to} aria-current={on ? "page" : undefined} className={`flex min-h-12 items-center rounded-lg px-4 text-sm font-medium ring-1 ring-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 ${on ? "bg-teal-700 text-white ring-teal-700" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}>{label}</Link>
  );
  return (
    <main className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Print QR codes</h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">{loc.name}</p>
        </div>
        <PrintButton disabled={cells.length === 0} />
      </header>
      <p role="note" className="rounded-lg border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">
        Rotating a table&apos;s QR code makes every printed copy stop working at once. Reprint after you rotate.
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Layout">
        {chip(href("grid", areaParam), "A4 grid (8 per page)", layout === "grid")}
        {chip(href("tents", areaParam), "Table tents (2 per page)", layout === "tents")}
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Tables to print">
        {chip(href(layout, "all"), "All tables", areaParam === "all")}
        {areas.map((a) => chip(href(layout, a), a, areaParam === a))}
      </div>
      <p className="text-sm" role="status">{cells.length} {cells.length === 1 ? "table" : "tables"} · {pageCount(cells.length, layout)} {pageCount(cells.length, layout) === 1 ? "page" : "pages"}</p>
      {cells.length === 0 ? (
        <p className="rounded-xl border border-dashed border-neutral-400 p-6 text-sm">No active tables to print. Add tables on the Tables page first.</p>
      ) : (
        <QrSheet cells={cells} layout={layout} brand={{ orgName: ctx.org.name, locationName: loc.name, logoUrl }} />
      )}
    </main>
  );
}

export default function QrPage({ params, searchParams }: P) {
  return (
    <Suspense fallback={<QrSkeleton />}>
      <Qr params={params} searchParams={searchParams} />
    </Suspense>
  );
}
