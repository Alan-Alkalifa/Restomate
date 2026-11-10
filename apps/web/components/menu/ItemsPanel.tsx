"use client";

import { Badge } from "@/components/ui/badge";
import { CheckField } from "@/components/ui/check-field";
import { Field } from "@/components/ui/field";
import { TextAreaField } from "@/components/ui/textarea-field";
import { formatMoney } from "@/lib/money";
import { errorsFor } from "./errors";
import { InlineAction } from "./InlineAction";
import { ItemGroupsEditor } from "./ItemGroupsEditor";
import { MenuDialog } from "./MenuDialog";
import { MoneyField } from "./MoneyField";
import { moveId } from "./order";
import { DIETARY_TAGS, type ActionResult, type MenuActions, type MenuCategory, type MenuData, type MenuItem } from "./types";
import { VariantsEditor } from "./VariantsEditor";

const TAG_LABEL: Record<string, string> = { vegetarian: "Vegetarian", vegan: "Vegan", halal: "Halal", spicy: "Spicy", contains_nuts: "Contains nuts", gluten_free: "Gluten free" };

function ItemFields({ s, item, currency }: { s: ActionResult | null; item?: MenuItem; currency: string }) {
  return (
    <>
      <Field name="name" label="Name" defaultValue={item?.name ?? ""} maxLength={80} required autoComplete="off" errors={errorsFor(s, "name")} />
      <TextAreaField name="description" label="Description (optional)" defaultValue={item?.description ?? ""} maxLength={500} errors={errorsFor(s, "description")} />
      <MoneyField name="basePrice" label="Price" currency={currency} defaultMinor={item?.basePrice} errors={errorsFor(s, "basePrice")} />
      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-medium">Dietary tags</legend>
        <div className="grid grid-cols-2 gap-x-3">
          {DIETARY_TAGS.map((t) => <CheckField key={t} name="dietaryTags" value={t} label={TAG_LABEL[t]} defaultChecked={item?.dietaryTags.includes(t)} explicitFalse={false} />)}
        </div>
        {errorsFor(s, "dietaryTags") && <p className="text-sm text-red-700 dark:text-red-400">{errorsFor(s, "dietaryTags")!.join(" ")}</p>}
      </fieldset>
      <CheckField name="isPublished" label="Published (visible on the customer menu)" defaultChecked={item?.isPublished ?? false} />
    </>
  );
}

export function ItemsPanel({
  category,
  data,
  actions,
  items,
}: {
  category: MenuCategory;
  data: MenuData;
  actions: MenuActions;
  items: MenuItem[]; // this category's items, ordered
}) {
  const { currency, canManage } = data;
  const ids = items.map((i) => i.id);
  return (
    <section aria-labelledby="items" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="items" className="text-lg font-semibold break-words">Items in {category.name}</h2>
        {canManage && (
          <MenuDialog primary wide triggerLabel="Add item" title={`Add item to ${category.name}`} submitLabel="Add item" action={actions.createItem} hidden={{ categoryId: category.id }}>
            {(s) => <ItemFields s={s} currency={currency} />}
          </MenuDialog>
        )}
      </div>
      {items.length === 0 && <p className="rounded-xl border border-dashed border-neutral-400 p-6 text-sm">{canManage ? "No items in this category yet." : "No items in this category."}</p>}
      <ul className="flex flex-col gap-2">
        {items.map((it, i) => (
          <li key={it.id} className="flex flex-col gap-2 rounded-xl border border-neutral-300 p-3 dark:border-neutral-700">
            <div className="flex gap-3">
              <div aria-hidden className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-neutral-200 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">No photo</div>
              <div className="flex min-w-0 flex-col gap-1">
                <p className="font-semibold break-words">{it.name}</p>
                <p className="text-sm">{formatMoney(it.basePrice, currency)}</p>
                {it.description && <p className="text-sm text-neutral-700 dark:text-neutral-300 break-words">{it.description}</p>}
                <div className="flex flex-wrap gap-1.5">
                  {it.isPublished ? <Badge tone="green">Published</Badge> : <Badge>Draft</Badge>}
                  {!it.isActive && <Badge tone="amber">Inactive</Badge>}
                  {it.dietaryTags.map((t) => <Badge key={t}>{TAG_LABEL[t] ?? t}</Badge>)}
                  {it.variants.filter((v) => v.isActive).length > 0 && <Badge>{it.variants.filter((v) => v.isActive).length} variants</Badge>}
                </div>
              </div>
            </div>
            {canManage && (
              <div className="flex flex-wrap gap-2">
                <InlineAction action={actions.reorderItems} fields={{ categoryId: category.id, itemIds: moveId(ids, it.id, -1) }} label="↑" ariaLabel={`Move ${it.name} up`} disabled={i === 0} />
                <InlineAction action={actions.reorderItems} fields={{ categoryId: category.id, itemIds: moveId(ids, it.id, 1) }} label="↓" ariaLabel={`Move ${it.name} down`} disabled={i === items.length - 1} />
                <MenuDialog wide triggerLabel="Edit" triggerAriaLabel={`Edit ${it.name}`} title={`Edit ${it.name}`} submitLabel="Save" action={actions.updateItem} hidden={{ itemId: it.id, categoryId: it.categoryId }}>
                  {(s) => <ItemFields s={s} item={it} currency={currency} />}
                </MenuDialog>
                <VariantsEditor item={it} currency={currency} action={actions.saveItemVariants} />
                <ItemGroupsEditor item={it} groups={data.modifierGroups} action={actions.setItemModifierGroups} />
                <InlineAction action={actions.setItemPublished} fields={{ itemId: it.id, published: it.isPublished ? "false" : "true" }} label={it.isPublished ? "Unpublish" : "Publish"} ariaLabel={`${it.isPublished ? "Unpublish" : "Publish"} ${it.name}`} />
                <InlineAction action={actions.setItemActive} fields={{ itemId: it.id, active: it.isActive ? "false" : "true" }} label={it.isActive ? "Deactivate" : "Reactivate"} ariaLabel={`${it.isActive ? "Deactivate" : "Reactivate"} ${it.name}`} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
