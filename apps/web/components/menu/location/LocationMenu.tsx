"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { CheckField } from "@/components/ui/check-field";
import { formatMoney } from "@/lib/money";
import { errorsFor } from "../errors";
import { InlineAction } from "../InlineAction";
import { MenuDialog } from "../MenuDialog";
import { MoneyField } from "../MoneyField";
import { StationsPanel } from "./StationsPanel";
import { formatSoldOutUntil, isSoldOut } from "./time";
import type { LocationMenuActions, LocationMenuData, LocationMenuRow } from "./types";

function OverrideDialog({ row, data, action }: { row: LocationMenuRow; data: LocationMenuData; action: LocationMenuActions["setLocationOverride"] }) {
  const stations = data.stations.filter((s) => s.isActive || s.id === row.kitchenStationId);
  return (
    <MenuDialog triggerLabel="Edit" triggerAriaLabel={`Edit ${row.name} at this location`} title={`${row.name} at this location`} description={`Base price ${formatMoney(row.basePrice, data.currency)}. Leave the override empty to use the base price.`} submitLabel="Save" action={action} hidden={{ itemId: row.itemId }}>
      {(s) => (
        <>
          <MoneyField name="priceOverride" label="Price override (optional)" currency={data.currency} defaultMinor={row.priceOverride ?? undefined} required={false} errors={errorsFor(s, "priceOverride")} />
          <CheckField name="isAvailable" label="Available at this location" defaultChecked={row.isAvailable} />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="field-kitchenStationId" className="text-sm font-medium">Kitchen station</label>
            <select id="field-kitchenStationId" name="kitchenStationId" defaultValue={row.kitchenStationId ?? ""} aria-invalid={errorsFor(s, "kitchenStationId") ? true : undefined} className="min-h-12 rounded-lg border border-neutral-400 bg-transparent px-2">
              <option value="">No station</option>
              {stations.map((st) => <option key={st.id} value={st.id}>{st.name}{st.isActive ? "" : " (inactive)"}</option>)}
            </select>
            {errorsFor(s, "kitchenStationId") && <p className="text-sm text-red-700 dark:text-red-400">{errorsFor(s, "kitchenStationId")!.join(" ")}</p>}
          </div>
        </>
      )}
    </MenuDialog>
  );
}

export function LocationMenu({ data, actions, nowIso }: { data: LocationMenuData; actions: LocationMenuActions; nowIso: string }) {
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const [q, setQ] = useState("");
  const rows = data.rows.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase()));
  const stationName = (id: string | null) => data.stations.find((s) => s.id === id)?.name;
  return (
    <div className="flex flex-col gap-6">
      {!data.canManage && !data.canToggleSoldOut && <p role="note" className="text-sm text-neutral-600 dark:text-neutral-400">View only.</p>}
      <section aria-labelledby="items" className="flex flex-col gap-3">
        <h2 id="items" className="text-lg font-semibold">Items</h2>
        {data.rows.length > 5 && (
          <label className="flex flex-col gap-1 text-sm font-medium">Find an item
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" className="min-h-12 rounded-lg border border-neutral-400 bg-transparent px-3 font-normal" />
          </label>
        )}
        {data.rows.length === 0 && <p className="rounded-xl border border-dashed border-neutral-400 p-6 text-sm">The menu has no items yet.</p>}
        {data.rows.length > 0 && rows.length === 0 && <p className="text-sm">No item matches “{q}”.</p>}
        <ul className="flex flex-col gap-2">
          {rows.map((r) => {
            const out = isSoldOut(r.soldOutUntil, now);
            const st = stationName(r.kitchenStationId);
            return (
              <li key={r.itemId} className={`flex flex-col gap-2 rounded-xl border border-neutral-300 p-3 dark:border-neutral-700 ${r.isActive && r.isAvailable ? "" : "opacity-80"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold break-words">{r.name}</span>
                  <span className="text-sm">{formatMoney(r.effectivePrice, data.currency)}</span>
                  {r.priceOverride !== null ? <Badge tone="good">Override (base {formatMoney(r.basePrice, data.currency)})</Badge> : null}
                  {!r.isAvailable && <Badge tone="warn">Not available here</Badge>}
                  {!r.isActive && <Badge tone="warn">Inactive</Badge>}
                  {!r.isPublished && <Badge>Draft</Badge>}
                  {st && <Badge>{st}</Badge>}
                  {out && r.soldOutUntil && <Badge tone="warn">Sold out until {formatSoldOutUntil(r.soldOutUntil, data.timezone, now)}</Badge>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {data.canToggleSoldOut && (
                    <InlineAction action={actions.toggleSoldOut} fields={{ itemId: r.itemId, soldOut: out ? "false" : "true" }} label={out ? "Back on" : "Sold out today"} ariaLabel={`${out ? "Mark back on the menu" : "Mark sold out today"}: ${r.name}`} pressed={out} />
                  )}
                  {data.canManage && <OverrideDialog row={r} data={data} action={actions.setLocationOverride} />}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      <StationsPanel stations={data.stations} canManage={data.canManage} actions={actions} />
    </div>
  );
}
