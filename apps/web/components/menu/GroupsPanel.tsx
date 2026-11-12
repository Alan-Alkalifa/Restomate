"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { formatMoney } from "@/lib/money";
import { errorsFor } from "./errors";
import { InlineAction } from "./InlineAction";
import { MenuDialog } from "./MenuDialog";
import type { ActionResult, MenuActions, ModifierGroup } from "./types";
import { buildList, MAX_MODIFIERS, RowsEditor, toRows, type Row } from "./VariantsEditor";

/** min/max rules, mirrored from the server for inline feedback: max >= 1 and min <= max (whole numbers). */
export function selectRangeProblems(minText: string, maxText: string): { min?: string; max?: string } {
  const out: { min?: string; max?: string } = {};
  const int = (t: string) => (/^\d{1,3}$/.test(t.trim()) ? Number(t.trim()) : null);
  const min = int(minText);
  const max = int(maxText);
  if (min === null) out.min = "Enter a whole number, 0 or more.";
  if (max === null) out.max = "Enter a whole number, 1 or more.";
  else if (max < 1) out.max = "Maximum must be at least 1.";
  if (min !== null && max !== null && max >= 1 && min > max) out.max = "Maximum must be at least the minimum.";
  return out;
}

function GroupFields({ s, g }: { s: ActionResult | null; g?: ModifierGroup }) {
  const [min, setMin] = useState(String(g?.minSelect ?? 0));
  const [max, setMax] = useState(String(g?.maxSelect ?? 1));
  const p = selectRangeProblems(min, max);
  return (
    <>
      <Field name="name" label="Group name" defaultValue={g?.name ?? ""} maxLength={60} required autoComplete="off" errors={errorsFor(s, "name")} />
      <div className="grid grid-cols-2 gap-3">
        <Field name="minSelect" label="Minimum choices" type="number" inputMode="numeric" min={0} step={1} value={min} onChange={(e) => setMin(e.target.value)} errors={[...(errorsFor(s, "minSelect") ?? []), ...(p.min ? [p.min] : [])]} hint="0 = optional" />
        <Field name="maxSelect" label="Maximum choices" type="number" inputMode="numeric" min={1} step={1} value={max} onChange={(e) => setMax(e.target.value)} errors={[...(errorsFor(s, "maxSelect") ?? []), ...(p.max ? [p.max] : [])]} />
      </div>
    </>
  );
}

function ModifiersEditor({ group, currency, action }: { group: ModifierGroup; currency: string; action: MenuActions["saveGroupModifiers"] }) {
  const [rows, setRows] = useState<Row[]>(() => toRows(group.modifiers, currency));
  const { json, problems } = buildList(rows, currency, false, "modifier");
  return (
    <MenuDialog wide triggerLabel="Options" triggerAriaLabel={`Options in ${group.name}`} title={`Options in ${group.name}`} description="Choices guests can add, with an extra price (0 or more). Rows you remove are deactivated." submitLabel="Save options" action={action} hidden={{ groupId: group.id }} canSubmit={problems.every((p) => !p)} onOpen={() => setRows(toRows(group.modifiers, currency))}>
      {() => (
        <>
          <input type="hidden" name="modifiers" value={json} />
          <RowsEditor rows={rows} setRows={setRows} allowNegative={false} noun="modifier" max={MAX_MODIFIERS} problems={problems} />
        </>
      )}
    </MenuDialog>
  );
}

export function GroupsPanel({ groups, currency, canManage, actions }: { groups: ModifierGroup[]; currency: string; canManage: boolean; actions: MenuActions }) {
  return (
    <section aria-labelledby="groups" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="groups" className="text-lg font-semibold">Modifier groups</h2>
        {canManage && (
          <MenuDialog primary triggerLabel="Add group" title="Add modifier group" submitLabel="Add group" action={actions.createModifierGroup}>
            {(s) => <GroupFields s={s} />}
          </MenuDialog>
        )}
      </div>
      {groups.length === 0 && <p className="rounded-xl border border-dashed border-neutral-400 p-6 text-sm">{canManage ? "No modifier groups yet. Add one (for example “Toppings”), then attach it to items." : "No modifier groups."}</p>}
      <ul className="flex flex-col gap-2">
        {groups.map((g) => (
          <li key={g.id} className="flex flex-col gap-2 rounded-xl border border-neutral-300 p-3 dark:border-neutral-700">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold break-words">{g.name}</span>
              <span className="text-sm text-neutral-600 dark:text-neutral-400">choose {g.minSelect}–{g.maxSelect}</span>
              {!g.isActive && <Badge tone="amber">Inactive</Badge>}
            </div>
            <ul className="flex flex-wrap gap-1.5">
              {g.modifiers.filter((m) => m.isActive).map((m) => <li key={m.id}><Badge>{m.name}{m.priceDelta > 0 ? ` +${formatMoney(m.priceDelta, currency)}` : ""}</Badge></li>)}
            </ul>
            {canManage && (
              <div className="flex flex-wrap gap-2">
                <MenuDialog triggerLabel="Edit" triggerAriaLabel={`Edit ${g.name}`} title={`Edit ${g.name}`} submitLabel="Save" action={actions.updateModifierGroup} hidden={{ groupId: g.id }}>
                  {(s) => <GroupFields s={s} g={g} />}
                </MenuDialog>
                <ModifiersEditor group={g} currency={currency} action={actions.saveGroupModifiers} />
                <InlineAction action={actions.setModifierGroupActive} fields={{ groupId: g.id, active: g.isActive ? "false" : "true" }} label={g.isActive ? "Deactivate" : "Reactivate"} ariaLabel={`${g.isActive ? "Deactivate" : "Reactivate"} ${g.name}`} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
