"use client";

import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { TextAreaField } from "@/components/ui/textarea-field";
import { errorsFor } from "./errors";
import { InlineAction } from "./InlineAction";
import { MenuDialog } from "./MenuDialog";
import { moveId } from "./order";
import type { MenuActions, MenuCategory } from "./types";

export function CategoriesPanel({
  categories,
  selectedId,
  onSelect,
  canManage,
  actions,
}: {
  categories: MenuCategory[]; // already ordered
  selectedId: string | null;
  onSelect: (id: string) => void;
  canManage: boolean;
  actions: MenuActions;
}) {
  const ids = categories.map((c) => c.id);
  return (
    <section aria-labelledby="cats" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="cats" className="text-lg font-semibold">Categories</h2>
        {canManage && (
          <MenuDialog primary triggerLabel="Add category" title="Add category" submitLabel="Add category" action={actions.createCategory}>
            {(s) => (
              <>
                <Field name="name" label="Name" maxLength={60} required autoComplete="off" errors={errorsFor(s, "name")} />
                <TextAreaField name="description" label="Description (optional)" maxLength={300} errors={errorsFor(s, "description")} />
              </>
            )}
          </MenuDialog>
        )}
      </div>
      {categories.length === 0 && (
        <p className="rounded-xl border border-dashed border-neutral-400 p-6 text-sm">
          {canManage ? "No categories yet. Add one, then add items to it." : "The menu is empty."}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {categories.map((c, i) => (
          <li key={c.id} className={`flex flex-col gap-2 rounded-xl border p-3 ${c.id === selectedId ? "border-teal-700" : "border-neutral-300 dark:border-neutral-700"}`}>
            <button type="button" onClick={() => onSelect(c.id)} aria-pressed={c.id === selectedId} className="flex min-h-12 flex-wrap items-center gap-2 text-left">
              <span className="font-semibold break-words">{c.name}</span>
              <span className="text-sm text-neutral-600 dark:text-neutral-400">{c.itemCount} {c.itemCount === 1 ? "item" : "items"}</span>
              {!c.isActive && <Badge tone="amber">Inactive</Badge>}
            </button>
            {c.description && <p className="text-sm text-neutral-700 dark:text-neutral-300 break-words">{c.description}</p>}
            {canManage && (
              <div className="flex flex-wrap gap-2">
                <InlineAction action={actions.reorderCategories} fields={{ categoryIds: moveId(ids, c.id, -1) }} label="↑" ariaLabel={`Move ${c.name} up`} disabled={i === 0} />
                <InlineAction action={actions.reorderCategories} fields={{ categoryIds: moveId(ids, c.id, 1) }} label="↓" ariaLabel={`Move ${c.name} down`} disabled={i === categories.length - 1} />
                <MenuDialog triggerLabel="Edit" triggerAriaLabel={`Edit ${c.name}`} title={`Edit ${c.name}`} submitLabel="Save" action={actions.updateCategory} hidden={{ categoryId: c.id }}>
                  {(s) => (
                    <>
                      <Field name="name" label="Name" defaultValue={c.name} maxLength={60} required autoComplete="off" errors={errorsFor(s, "name")} />
                      <TextAreaField name="description" label="Description (optional)" defaultValue={c.description ?? ""} maxLength={300} errors={errorsFor(s, "description")} />
                    </>
                  )}
                </MenuDialog>
                <InlineAction action={actions.setCategoryActive} fields={{ categoryId: c.id, active: c.isActive ? "false" : "true" }} label={c.isActive ? "Deactivate" : "Reactivate"} ariaLabel={`${c.isActive ? "Deactivate" : "Reactivate"} ${c.name}`} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
