"use client";

import { useActionState } from "react";
import { errorsFor } from "@/components/auth/use-form-focus";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Badge } from "@/components/ui/badge";
import { byOrder, moveArea } from "./areas";
import { venueErrorMessage } from "./errors";
import type { ActionResult, Area, VenueActions } from "./types";
import { VenueDialog } from "./VenueDialog";

const MOVE = "flex min-h-12 min-w-12 items-center justify-center rounded-lg text-lg ring-1 ring-neutral-400 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-neutral-800";

export function AreasPanel({ areas, canManage, actions, offline, upgradeHref }: {
  areas: Area[];
  canManage: boolean;
  actions: VenueActions;
  offline: boolean;
  upgradeHref: string;
}) {
  const sorted = byOrder(areas);
  const [reorderState, reorderAction, reordering] = useActionState<ActionResult | null, FormData>(actions.reorderAreas, null);

  return (
    <section aria-labelledby="areas-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="areas-heading" className="text-lg font-semibold">Areas</h2>
        {canManage && (
          <VenueDialog primary triggerLabel="Add area" title="Add area" submitLabel="Add area" action={actions.createArea} offline={offline} upgradeHref={upgradeHref}>
            {(s) => <Field name="name" label="Area name" maxLength={60} required autoComplete="off" errors={errorsFor(s, "name")} />}
          </VenueDialog>
        )}
      </div>
      <FormAlert message={venueErrorMessage(reorderState)} />
      {sorted.length === 0 ? (
        <p role="status" className="rounded-lg border border-dashed border-neutral-400 p-6 text-center">
          No areas yet. {canManage ? "Add an area such as Indoor or Terrace, then add tables to it." : "A manager can add areas."}
        </p>
      ) : (
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-300 dark:divide-neutral-800 dark:border-neutral-700">
          {sorted.map((a, i) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <span className="break-words font-medium">{a.name}</span>{" "}
                {!a.isActive && <Badge>Inactive</Badge>}
                <span className="block text-sm text-neutral-600 dark:text-neutral-400">
                  {a.tableCount} {a.tableCount === 1 ? "table" : "tables"}
                </span>
              </div>
              {canManage && (
                <div className="flex flex-wrap items-center gap-2">
                  {(["up", "down"] as const).map((dir) => {
                    const order = moveArea(areas, a.id, dir);
                    return (
                      <form key={dir} action={reorderAction}>
                        {order?.map((id) => <input key={id} type="hidden" name="areaIds" value={id} />)}
                        <button
                          type="submit"
                          disabled={!order || reordering || offline}
                          aria-label={`Move ${a.name} ${dir}`}
                          className={MOVE}
                        >
                          <span aria-hidden>{dir === "up" ? "↑" : "↓"}</span>
                        </button>
                      </form>
                    );
                  })}
                  <VenueDialog triggerLabel="Rename" triggerAriaLabel={`Rename ${a.name}`} title={`Rename ${a.name}`} submitLabel="Save" action={actions.renameArea} hidden={{ areaId: a.id }} offline={offline} upgradeHref={upgradeHref}>
                    {(s) => <Field name="name" label="Area name" defaultValue={a.name} maxLength={60} required autoComplete="off" errors={errorsFor(s, "name")} />}
                  </VenueDialog>
                  <VenueDialog
                    triggerLabel={a.isActive ? "Deactivate" : "Reactivate"}
                    triggerAriaLabel={`${a.isActive ? "Deactivate" : "Reactivate"} ${a.name}`}
                    title={`${a.isActive ? "Deactivate" : "Reactivate"} ${a.name}?`}
                    description={a.isActive ? "Guests and staff will no longer see this area. An area with active tables can't be deactivated until they are moved or deactivated." : "The area becomes available again."}
                    submitLabel={a.isActive ? "Deactivate" : "Reactivate"}
                    destructive={a.isActive}
                    action={actions.setAreaActive}
                    hidden={{ areaId: a.id, active: a.isActive ? "false" : "true" }}
                    offline={offline}
                    upgradeHref={upgradeHref}
                  />
                </div>
              )}
              <span className="sr-only">Position {i + 1} of {sorted.length}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
