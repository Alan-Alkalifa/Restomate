"use client";

import Link from "next/link";
import { errorsFor } from "@/components/auth/use-form-focus";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { SelectField } from "@/components/ui/select-field";
import { byOrder } from "./areas";
import type { Area, TableShape, TableStatus, VenueActions, VenueTable } from "./types";
import { VenueDialog } from "./VenueDialog";

const SHAPES = [
  { value: "square", label: "Square" },
  { value: "round", label: "Round" },
  { value: "rect", label: "Rectangle" },
] as const;
const SHAPE_LABEL: Record<TableShape, string> = { square: "Square", round: "Round", rect: "Rectangle" };

const STATUS: Record<TableStatus, { label: string; tone: "green" | "amber" | "red" | "sky" }> = {
  available: { label: "Available", tone: "green" },
  reserved: { label: "Reserved", tone: "amber" },
  occupied: { label: "Occupied", tone: "red" },
  needs_cleaning: { label: "Needs cleaning", tone: "sky" },
};
export const StatusBadge = ({ status }: { status: TableStatus }) => <Badge tone={STATUS[status].tone}>{STATUS[status].label}</Badge>;

const th = "px-3 py-2 text-left text-xs font-semibold uppercase text-neutral-600 dark:text-neutral-400";
const td = "px-3 py-2 align-middle text-sm";

type Common = { actions: VenueActions; offline: boolean; upgradeHref: string; areas: Area[]; onNotice: (m: string) => void };

function TableFields({ areas, table, state }: { areas: Area[]; table?: VenueTable; state: Parameters<typeof errorsFor>[0] }) {
  // Only active areas are offered (an active table cannot sit in an inactive area: AREA_INACTIVE).
  const options = areas.filter((a) => a.isActive).map((a) => ({ value: a.id, label: a.name }));
  const current = options.find((o) => o.value === table?.areaId);
  return (
    <>
      <SelectField
        name="areaId"
        label="Area"
        options={options}
        defaultValue={current?.value ?? options[0]?.value}
        hint={table && !current ? "This table's area is inactive. Choose an active area." : undefined}
        errors={errorsFor(state, "areaId")}
      />
      <Field name="label" label="Table label" maxLength={20} required autoComplete="off" defaultValue={table?.label ?? ""} errors={errorsFor(state, "label")} />
      <div className="grid grid-cols-2 gap-4">
        <Field name="capacity" label="Seats" type="number" inputMode="numeric" min={1} max={50} step={1} required defaultValue={table?.capacity ?? 4} errors={errorsFor(state, "capacity")} />
        <SelectField name="shape" label="Shape" options={SHAPES} defaultValue={table?.shape ?? "square"} errors={errorsFor(state, "shape")} />
      </div>
    </>
  );
}

export function AddTableButton({ areas, actions, offline, upgradeHref, disabled }: Omit<Common, "onNotice"> & { disabled: boolean }) {
  return (
    <VenueDialog primary triggerLabel="Add table" title="Add table" submitLabel="Add table" action={actions.createTable} offline={offline} disabled={disabled} upgradeHref={upgradeHref}>
      {(s) => <TableFields areas={areas} state={s} />}
    </VenueDialog>
  );
}

function Row({ t, canManage, ...c }: Common & { t: VenueTable; canManage: boolean }) {
  return (
    <tr className={t.isActive ? undefined : "bg-neutral-50 text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400"}>
      <th scope="row" className={`${td} text-left font-medium break-words`}>{t.label}</th>
      <td className={td}>{t.capacity}</td>
      <td className={td}>{SHAPE_LABEL[t.shape]}</td>
      <td className={td}>{t.isActive ? <StatusBadge status={t.status} /> : "—"}</td>
      <td className={td}>{t.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
      {canManage && (
        <td className={td}>
          <div className="flex flex-wrap gap-2">
            <VenueDialog triggerLabel="Edit" triggerAriaLabel={`Edit table ${t.label}`} title={`Edit table ${t.label}`} submitLabel="Save" action={c.actions.updateTable} hidden={{ tableId: t.id }} offline={c.offline} upgradeHref={c.upgradeHref}>
              {(s) => <TableFields areas={c.areas} table={t} state={s} />}
            </VenueDialog>
            <VenueDialog
              triggerLabel="Rotate QR"
              disabled={!t.isActive}
              triggerAriaLabel={`Rotate QR code for table ${t.label}`}
              title={`Rotate the QR code for ${t.label}?`}
              description="Printed codes for this table stop working immediately. You will need to print and place the new code."
              submitLabel="Rotate QR code"
              destructive
              action={c.actions.rotateTableQr}
              hidden={{ tableId: t.id }}
              offline={c.offline}
              upgradeHref={c.upgradeHref}
              onSuccess={() => c.onNotice(`New QR code created for ${t.label}. Printed codes for this table no longer work.`)}
            />
            <VenueDialog
              triggerLabel={t.isActive ? "Deactivate" : "Reactivate"}
              triggerAriaLabel={`${t.isActive ? "Deactivate" : "Reactivate"} table ${t.label}`}
              title={`${t.isActive ? "Deactivate" : "Reactivate"} table ${t.label}?`}
              description={t.isActive ? "The table is hidden from ordering and no longer counts toward your plan." : "The table counts toward your plan's table limit again."}
              submitLabel={t.isActive ? "Deactivate" : "Reactivate"}
              destructive={t.isActive}
              action={c.actions.setTableActive}
              hidden={{ tableId: t.id, active: t.isActive ? "false" : "true" }}
              offline={c.offline}
              upgradeHref={c.upgradeHref}
            />
          </div>
        </td>
      )}
    </tr>
  );
}

export function TablesPanel({ areas, tables, canManage, atLimit, ...c }: Omit<Common, "areas"> & {
  areas: Area[];
  tables: VenueTable[];
  canManage: boolean;
  atLimit: boolean;
}) {
  const sorted = byOrder(areas);
  const hasActiveArea = sorted.some((a) => a.isActive);
  return (
    <section aria-labelledby="tables-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="tables-heading" className="text-lg font-semibold">Tables</h2>
        {canManage && <AddTableButton areas={areas} actions={c.actions} offline={c.offline} upgradeHref={c.upgradeHref} disabled={!hasActiveArea || atLimit} />}
      </div>
      {canManage && atLimit && (
        <p role="status" className="text-sm">
          You have reached your plan&apos;s table limit.{" "}
          <Link href={c.upgradeHref} className="font-medium underline">View plans</Link>
        </p>
      )}
      {tables.length === 0 ? (
        <p role="status" className="rounded-lg border border-dashed border-neutral-400 p-6 text-center">
          {hasActiveArea ? `No tables yet.${canManage ? " Add your first table." : ""}` : "Add an area first, then you can add tables to it."}
        </p>
      ) : (
        sorted.map((a) => {
          const list = tables.filter((t) => t.areaId === a.id);
          if (list.length === 0) return null;
          return (
            <div key={a.id} className="flex flex-col gap-2">
              <h3 className="font-medium">{a.name} {!a.isActive && <Badge>Inactive</Badge>}</h3>
              <div className="overflow-x-auto rounded-lg border border-neutral-300 dark:border-neutral-700">
                <table className="w-full min-w-[40rem]">
                  <caption className="sr-only">Tables in {a.name}</caption>
                  <thead className="bg-neutral-100 dark:bg-neutral-900">
                    <tr>
                      {["Table", "Seats", "Shape", "Status", "State", ...(canManage ? ["Actions"] : [])].map((h) => <th key={h} scope="col" className={th}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
                    {list.map((t) => <Row key={t.id} t={t} canManage={canManage} {...c} areas={areas} />)}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })
      )}
    </section>
  );
}
