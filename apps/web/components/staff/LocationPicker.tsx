"use client";

import { useState } from "react";

/** "All locations" toggle OR a multi-select; an empty selection is never submitted as valid. */
export function LocationPicker({
  locations,
  initialAll = true,
  initialIds = [],
}: {
  locations: { id: string; name: string }[];
  initialAll?: boolean;
  initialIds?: string[];
}) {
  const [all, setAll] = useState(initialAll);
  const [ids, setIds] = useState<string[]>(initialIds);
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">Locations</legend>
      <label className="flex min-h-12 items-center gap-3 text-sm">
        <input type="checkbox" name="allLocations" value="true" checked={all} onChange={(e) => setAll(e.target.checked)} className="h-6 w-6" />
        All locations
      </label>
      {!all && (
        <>
          {locations.map((l) => (
            <label key={l.id} className="flex min-h-12 items-center gap-3 pl-6 text-sm">
              <input
                type="checkbox"
                name="locationIds"
                value={l.id}
                checked={ids.includes(l.id)}
                onChange={(e) => setIds((cur) => (e.target.checked ? [...cur, l.id] : cur.filter((x) => x !== l.id)))}
                className="h-6 w-6"
              />
              {l.name}
            </label>
          ))}
          {ids.length === 0 && <p role="alert" className="text-sm text-red-700 dark:text-red-400">Choose at least one location, or select All locations.</p>}
        </>
      )}
    </fieldset>
  );
}
