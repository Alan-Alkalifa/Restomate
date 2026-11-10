"use client";

import { useState } from "react";
import { MenuDialog } from "./MenuDialog";
import { moveId } from "./order";
import type { BoundMenuAction, MenuItem, ModifierGroup } from "./types";

/** Attach modifier groups to an item and order them. Posts `groupIds` repeated, in order (may be empty). */
export function ItemGroupsEditor({ item, groups, action }: { item: MenuItem; groups: ModifierGroup[]; action: BoundMenuAction }) {
  const usable = groups.filter((g) => g.isActive || item.modifierGroupIds.includes(g.id));
  const init = () => item.modifierGroupIds.filter((id) => usable.some((g) => g.id === id));
  const [selected, setSelected] = useState<string[]>(init);
  const name = (id: string) => usable.find((g) => g.id === id)?.name ?? id;
  return (
    <MenuDialog
      triggerLabel="Modifiers"
      triggerAriaLabel={`Modifier groups for ${item.name}`}
      title={`Modifier groups for ${item.name}`}
      submitLabel="Save"
      action={action}
      hidden={{ itemId: item.id }}
      onOpen={() => setSelected(init())}
    >
      {() => (
        <>
          {selected.map((id) => <input key={id} type="hidden" name="groupIds" value={id} />)}
          {usable.length === 0 && <p className="text-sm">No modifier groups yet. Create them in the Modifier groups tab.</p>}
          <ul className="flex flex-col gap-1">
            {usable.map((g) => (
              <li key={g.id}>
                <label className="flex min-h-12 items-center gap-3 text-sm">
                  <input type="checkbox" className="h-6 w-6" checked={selected.includes(g.id)} onChange={(e) => setSelected((cur) => (e.target.checked ? [...cur, g.id] : cur.filter((x) => x !== g.id)))} />
                  {g.name}{!g.isActive && " (inactive)"}
                </label>
              </li>
            ))}
          </ul>
          {selected.length > 1 && (
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">Order shown to guests</p>
              <ol className="flex flex-col gap-1">
                {selected.map((id, i) => (
                  <li key={id} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 break-words">{i + 1}. {name(id)}</span>
                    <button type="button" aria-label={`Move ${name(id)} up`} disabled={i === 0} onClick={() => setSelected((c) => moveId(c, id, -1))} className="min-h-12 min-w-12 rounded-lg ring-1 ring-neutral-400 disabled:opacity-60">↑</button>
                    <button type="button" aria-label={`Move ${name(id)} down`} disabled={i === selected.length - 1} onClick={() => setSelected((c) => moveId(c, id, 1))} className="min-h-12 min-w-12 rounded-lg ring-1 ring-neutral-400 disabled:opacity-60">↓</button>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </>
      )}
    </MenuDialog>
  );
}
