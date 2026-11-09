"use client";

import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { errorsFor } from "../errors";
import { InlineAction } from "../InlineAction";
import { MenuDialog } from "../MenuDialog";
import type { KitchenStation, LocationMenuActions } from "./types";

export function StationsPanel({ stations, canManage, actions }: { stations: KitchenStation[]; canManage: boolean; actions: LocationMenuActions }) {
  return (
    <section aria-labelledby="stations" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="stations" className="text-lg font-semibold">Kitchen stations</h2>
        {canManage && (
          <MenuDialog primary triggerLabel="Add station" title="Add station" submitLabel="Add station" action={actions.createStation}>
            {(s) => <Field name="name" label="Station name" maxLength={60} required autoComplete="off" errors={errorsFor(s, "name")} />}
          </MenuDialog>
        )}
      </div>
      {stations.length === 0 && <p className="rounded-xl border border-dashed border-neutral-400 p-6 text-sm">{canManage ? "No stations yet. Add one (for example “Bar”), then route items to it." : "No kitchen stations."}</p>}
      <ul className="flex flex-col gap-2">
        {stations.map((st) => (
          <li key={st.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-300 p-3 dark:border-neutral-700">
            <span className="min-w-0 flex-1 font-semibold break-words">{st.name}</span>
            {!st.isActive && <Badge tone="amber">Inactive</Badge>}
            {canManage && (
              <>
                <MenuDialog triggerLabel="Rename" triggerAriaLabel={`Rename ${st.name}`} title={`Rename ${st.name}`} submitLabel="Save" action={actions.renameStation} hidden={{ stationId: st.id }}>
                  {(s) => <Field name="name" label="Station name" defaultValue={st.name} maxLength={60} required autoComplete="off" errors={errorsFor(s, "name")} />}
                </MenuDialog>
                <InlineAction action={actions.setStationActive} fields={{ stationId: st.id, active: st.isActive ? "false" : "true" }} label={st.isActive ? "Deactivate" : "Reactivate"} ariaLabel={`${st.isActive ? "Deactivate" : "Reactivate"} ${st.name}`} />
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
