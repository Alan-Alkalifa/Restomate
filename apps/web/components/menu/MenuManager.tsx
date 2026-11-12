"use client";

import { useMemo, useState } from "react";
import { CategoriesPanel } from "./CategoriesPanel";
import { GroupsPanel } from "./GroupsPanel";
import { ItemsPanel } from "./ItemsPanel";
import { bySort } from "./order";
import type { MenuActions, MenuData } from "./types";

export function MenuManager({ data, actions }: { data: MenuData; actions: MenuActions }) {
  const [view, setView] = useState<"menu" | "groups">("menu");
  const categories = useMemo(() => data.categories.slice().sort(bySort), [data.categories]);
  const [selected, setSelected] = useState<string | null>(categories[0]?.id ?? null);
  const current = categories.find((c) => c.id === selected) ?? categories[0] ?? null;
  const items = useMemo(() => data.items.filter((i) => i.categoryId === current?.id).sort(bySort), [data.items, current?.id]);
  const tab = (key: typeof view, label: string) => (
    <button type="button" aria-pressed={view === key} onClick={() => setView(key)} className={`min-h-12 rounded-lg px-4 text-sm font-medium ring-1 ring-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 ${view === key ? "bg-teal-700 text-white ring-teal-700" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}>{label}</button>
  );
  return (
    <div className="flex flex-col gap-4">
      {!data.canManage && <p role="note" className="text-sm text-neutral-600 dark:text-neutral-400">View only. You need permission to manage the menu to change it.</p>}
      <div role="group" aria-label="Section" className="flex gap-2">
        {tab("menu", "Categories & items")}
        {tab("groups", "Modifier groups")}
      </div>
      {view === "groups" ? (
        <GroupsPanel groups={data.modifierGroups.slice().sort(bySort)} currency={data.currency} canManage={data.canManage} actions={actions} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
          <CategoriesPanel categories={categories} selectedId={current?.id ?? null} onSelect={setSelected} canManage={data.canManage} actions={actions} />
          {current ? <ItemsPanel key={current.id} category={current} data={data} actions={actions} items={items} /> : <p className="rounded-xl border border-dashed border-neutral-400 p-6 text-sm">Select or add a category to see its items.</p>}
        </div>
      )}
    </div>
  );
}
