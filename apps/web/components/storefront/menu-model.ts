/*
 * Pure storefront menu model: types, selection rules and pricing. No React, no IO (unit tested).
 *
 * SEAM: `PublicMenu` and `LocationInfo` mirror docs/contracts/storefront.md ("Public reads"): `get_public_menu` and
 * `get_public_location_info` (MCS-T02, DAVIN). When `lib/storefront` exports `getPublicMenu` / `getLocationInfo`, import the
 * types from there and delete this section. NOTE: the SQL function OMITS sold-out items (it only returns items available right
 * now), so against the real data `soldOut` is never true; the flag, the disabled state and the cart rule are kept for when a
 * sold-out item is exposed, and for the seam. `imageUrl` is built by the lib wrapper from the SQL `image_path`. Money is integer minor units (whole Rupiah); the server recomputes every price
 * at submission, so nothing here is ever trusted by it.
 */
export type PublicVariant = { id: string; name: string; priceDelta: number };
export type PublicModifier = { id: string; name: string; priceDelta: number };
export type PublicModifierGroup = { id: string; name: string; minSelect: number; maxSelect: number; modifiers: PublicModifier[] };
export type PublicItem = {
  id: string; name: string; description: string | null; imageUrl: string | null; dietaryTags: string[];
  /** Effective price at this location. */
  price: number; soldOut: boolean; variants: PublicVariant[]; modifierGroups: PublicModifierGroup[];
};
export type PublicCategory = { id: string; name: string; description: string | null; items: PublicItem[] };
export type PublicMenu = { currency: string; categories: PublicCategory[] };

export type HoursRow = { day: number; /** minutes since midnight, 0..1439 */ opens: number; /** 1..1440 */ closes: number };
export type LocationInfo = {
  name: string; currency: string; timezone: string; address: string | null; city: string | null; phone: string | null;
  taxRateBps: number; serviceChargeBps: number; taxOnServiceCharge: boolean;
  hours: HoursRow[];
  /** Computed on the server in the location's timezone (not cached). */
  openNow: boolean;
  ordering: { qr: boolean; online: boolean; accepting: boolean };
  minOrderAmount: number;
};
// ---- end of seam ----

/** What the guest picked for one item. Ids only: names and prices always come from the current menu. */
export type Selection = { variantId: string | null; modifierIds: string[] };

export const MAX_QTY = 20;
export const NOTE_MAX = 200;

export const findItem = (menu: PublicMenu, itemId: string): PublicItem | undefined => {
  for (const c of menu.categories) {
    const hit = c.items.find((i) => i.id === itemId);
    if (hit) return hit;
  }
  return undefined;
};

/** True when the guest has to choose something (a variant, or any modifier group) before the item can be added. */
export const needsOptions = (item: PublicItem): boolean => item.variants.length > 0 || item.modifierGroups.length > 0;

export type SelectionError =
  | { kind: "variant_required" }
  | { kind: "variant_unknown" }
  | { kind: "modifier_unknown" }
  | { kind: "modifier_duplicate" }
  | { kind: "group_min"; groupId: string; min: number }
  | { kind: "group_max"; groupId: string; max: number };

/**
 * Every rule the server enforces too: one variant when the item has variants, only known modifiers (each at most once),
 * and each group's min/max. An invalid selection can never be added to the cart.
 */
export function validateSelection(item: PublicItem, sel: Selection): SelectionError[] {
  const errors: SelectionError[] = [];
  if (item.variants.length > 0) {
    if (!sel.variantId) errors.push({ kind: "variant_required" });
    else if (!item.variants.some((v) => v.id === sel.variantId)) errors.push({ kind: "variant_unknown" });
  } else if (sel.variantId) {
    errors.push({ kind: "variant_unknown" });
  }
  const known = new Set(item.modifierGroups.flatMap((g) => g.modifiers.map((m) => m.id)));
  if (sel.modifierIds.some((id) => !known.has(id))) errors.push({ kind: "modifier_unknown" });
  if (new Set(sel.modifierIds).size !== sel.modifierIds.length) errors.push({ kind: "modifier_duplicate" });
  for (const g of item.modifierGroups) {
    const n = g.modifiers.filter((m) => sel.modifierIds.includes(m.id)).length;
    if (n < g.minSelect) errors.push({ kind: "group_min", groupId: g.id, min: g.minSelect });
    if (n > g.maxSelect) errors.push({ kind: "group_max", groupId: g.id, max: g.maxSelect });
  }
  return errors;
}

/** Price of ONE unit: item + variant + modifiers, never below 0. Ids that are not on the item add nothing. */
export function unitPrice(item: PublicItem, sel: Selection): number {
  const variant = item.variants.find((v) => v.id === sel.variantId)?.priceDelta ?? 0;
  const mods = item.modifierGroups.flatMap((g) => g.modifiers).filter((m) => sel.modifierIds.includes(m.id)).reduce((a, m) => a + m.priceDelta, 0);
  return Math.max(0, item.price + variant + mods);
}

export const clampQty = (n: number): number => (Number.isFinite(n) ? Math.min(MAX_QTY, Math.max(1, Math.trunc(n))) : 1);

/** Notes are free text typed by the guest: trimmed, control characters removed, capped. Never trusted by the server. */
export const cleanNote = (s: string): string => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, NOTE_MAX);
