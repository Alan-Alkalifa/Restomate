"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { navHref, type ResolvedNavItem } from "./nav";

/** Uses the location from the URL when present, else the first accessible location. */
export function Sidebar({
  items,
  orgSlug,
  locationIds,
}: {
  items: ResolvedNavItem[];
  orgSlug: string;
  locationIds: string[];
}) {
  const params = useParams<{ location?: string }>();
  const current = params.location && locationIds.includes(params.location) ? params.location : (locationIds[0] ?? null);
  const row = "flex min-h-12 items-center justify-between gap-2 rounded-lg px-3 text-base hover:bg-neutral-100 dark:hover:bg-neutral-800";
  return (
    <nav aria-label="Dashboard" className="flex flex-col gap-1 p-3">
      <Link href={`/${orgSlug}`} className={`${row} font-medium`}>Home</Link>
      {items.map((i) => {
        const href = navHref(i, orgSlug, current);
        return i.locked ? (
          <Link key={i.key} href={href} className={`${row} text-neutral-500`} aria-label={`${i.label} (locked, upgrade required)`}>
            <span>🔒 {i.label}</span>
            <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">Upgrade</span>
          </Link>
        ) : (
          <Link key={i.key} href={href} className={row}>{i.label}</Link>
        );
      })}
    </nav>
  );
}
