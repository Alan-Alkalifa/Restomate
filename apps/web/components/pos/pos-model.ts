import type { LocationMenuRow, MenuCategory, MenuItem, ModifierGroup } from "@/lib/menu/data";

export type PosVariant = { id: string; name: string; priceDelta: number };
export type PosModifier = { id: string; name: string; priceDelta: number };
export type PosGroup = { id: string; name: string; minSelect: number; maxSelect: number; modifiers: PosModifier[] };
export type PosItem = {
  id: string; categoryId: string; name: string; description: string | null;
  /** Effective price at this location (display only; the server recomputes at submit). */
  price: number; soldOut: boolean; variants: PosVariant[]; groups: PosGroup[];
};
export type PosCategory = { id: string; name: string };
export type PosCatalog = { currency: string; categories: PosCategory[]; items: PosItem[] };

export type Selection = { variantId: string | null; modifierIds: string[] };

type MenuInput = { currency: string; categories: MenuCategory[]; items: MenuItem[]; modifierGroups: ModifierGroup[] };
type LocationInput = { rows: LocationMenuRow[] };

/** Merges the org menu (variants, modifier groups) with this location's rows (price, availability, sold out). */
export function buildCatalog(menu: MenuInput, loc: LocationInput, now: Date): PosCatalog {
  const rows = new Map(loc.rows.map((r) => [r.itemId, r]));
  const groups = new Map(menu.modifierGroups.filter((g) => g.isActive).map((g) => [g.id, g]));
  const items: PosItem[] = [];
  for (const i of [...menu.items].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const r = rows.get(i.id);
    if (!i.isActive || !i.isPublished || !r || !r.isActive || !r.isPublished || !r.isAvailable) continue;
    const g: PosGroup[] = i.modifierGroupIds.flatMap((id) => {
      const grp = groups.get(id);
      const mods = grp?.modifiers.filter((m) => m.isActive).sort((a, b) => a.sortOrder - b.sortOrder) ?? [];
      // A group that can never satisfy its minimum would block the item, so it is left out.
      if (!grp || mods.length < grp.minSelect) return [];
      return [{ id: grp.id, name: grp.name, minSelect: grp.minSelect, maxSelect: grp.maxSelect, modifiers: mods.map(({ id: mid, name, priceDelta }) => ({ id: mid, name, priceDelta })) }];
    });
    items.push({
      id: i.id, categoryId: i.categoryId, name: i.name, description: i.description, price: r.effectivePrice,
      soldOut: r.soldOutUntil !== null && new Date(r.soldOutUntil) > now,
      variants: i.variants.filter((v) => v.isActive).sort((a, b) => a.sortOrder - b.sortOrder).map(({ id, name, priceDelta }) => ({ id, name, priceDelta })),
      groups: g,
    });
  }
  const used = new Set(items.map((i) => i.categoryId));
  const categories = menu.categories.filter((c) => c.isActive && used.has(c.id)).sort((a, b) => a.sortOrder - b.sortOrder).map(({ id, name }) => ({ id, name }));
  return { currency: menu.currency, categories, items };
}

export const needsSheet = (i: PosItem) => i.variants.length > 0 || i.groups.length > 0;

/** Empty array = valid. The UI never adds a line while this returns errors. */
export function validateSelection(item: PosItem, sel: Selection): string[] {
  const errors: string[] = [];
  if (item.variants.length > 0 && !item.variants.some((v) => v.id === sel.variantId)) errors.push("Choose a variant.");
  if (item.variants.length === 0 && sel.variantId !== null) errors.push("This item has no variants.");
  const known = new Set(item.groups.flatMap((g) => g.modifiers.map((m) => m.id)));
  if (sel.modifierIds.some((id) => !known.has(id)) || new Set(sel.modifierIds).size !== sel.modifierIds.length) errors.push("An option is not available.");
  for (const g of item.groups) {
    const n = g.modifiers.filter((m) => sel.modifierIds.includes(m.id)).length;
    if (n < g.minSelect) errors.push(g.minSelect === 1 ? `Choose 1 option for ${g.name}.` : `Choose at least ${g.minSelect} options for ${g.name}.`);
    if (n > g.maxSelect) errors.push(`Choose at most ${g.maxSelect} for ${g.name}.`);
  }
  return errors;
}

/** Display-only unit price: effective price + variant delta + modifier deltas, never below 0. */
export function unitPrice(item: PosItem, sel: Selection): number {
  const v = item.variants.find((x) => x.id === sel.variantId)?.priceDelta ?? 0;
  const m = item.groups.flatMap((g) => g.modifiers).filter((x) => sel.modifierIds.includes(x.id)).reduce((s, x) => s + x.priceDelta, 0);
  return Math.max(0, item.price + v + m);
}
