"use client";

import { useParams, usePathname, useRouter } from "next/navigation";

/**
 * The selected location is the `[location]` (id) URL segment of location-scoped pages.
 * Only locations from the server-provided context are offered. On org-level pages the
 * switcher jumps to that location's POS-style landing (`/[org]/[location]/[first section]`).
 */
export function LocationSwitcher({
  orgSlug,
  locations,
  defaultSection,
}: {
  orgSlug: string;
  locations: { id: string; name: string }[];
  defaultSection: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ location?: string }>();
  if (locations.length === 0) return null;
  const inLocation = params.location && locations.some((l) => l.id === params.location);
  const current = inLocation ? params.location! : locations[0].id;
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only sm:not-sr-only">Location</span>
      <select
        value={current}
        onChange={(e) => {
          const id = e.target.value;
          if (inLocation) router.push(pathname.replace(`/${params.location}`, `/${id}`));
          else if (defaultSection) router.push(`/${orgSlug}/${id}/${defaultSection}`);
        }}
        className="min-h-12 rounded-lg border border-neutral-400 bg-transparent px-2"
      >
        {locations.map((l) => (
          <option key={l.id} value={l.id}>{l.name}</option>
        ))}
      </select>
    </label>
  );
}
