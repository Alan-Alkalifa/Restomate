import "server-only";
import { requireOrgContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { assertLocation, canToggleSoldOut } from "./shared";

export type DietaryTag = "vegetarian" | "vegan" | "halal" | "spicy" | "contains_nuts" | "gluten_free";

export type MenuCategory = { id: string; name: string; description: string | null; sortOrder: number; isActive: boolean; itemCount: number };
export type MenuVariant = { id: string; name: string; priceDelta: number; sortOrder: number; isActive: boolean };
export type MenuItem = {
  id: string; categoryId: string; name: string; description: string | null;
  basePrice: number; imagePath: string | null; dietaryTags: DietaryTag[];
  isPublished: boolean; isActive: boolean; sortOrder: number;
  variants: MenuVariant[];
  modifierGroupIds: string[];
};
export type Modifier = { id: string; name: string; priceDelta: number; sortOrder: number; isActive: boolean };
export type ModifierGroup = { id: string; name: string; minSelect: number; maxSelect: number; sortOrder: number; isActive: boolean; modifiers: Modifier[] };

const TAGS: readonly string[] = ["vegetarian", "vegan", "halal", "spicy", "contains_nuts", "gluten_free"];
const bySort = <T extends { sortOrder: number; name?: string }>(a: T, b: T) => a.sortOrder - b.sortOrder || (a.name ?? "").localeCompare(b.name ?? "");

/** Org-level menu for the editor. Any org member can read. Explicit columns only. Call inside <Suspense>. */
export async function getMenu(orgSlug: string): Promise<{
  currency: string; categories: MenuCategory[]; items: MenuItem[]; modifierGroups: ModifierGroup[]; canManage: boolean;
}> {
  const ctx = await requireOrgContext(orgSlug);
  const orgId = ctx.org.id;
  const supabase = await createClient();
  const [cats, items, variants, groups, mods, links] = await Promise.all([
    supabase.from("menu_categories").select("id, name, description, sort_order, is_active").eq("organization_id", orgId),
    supabase.from("menu_items").select("id, category_id, name, description, base_price, image_path, dietary_tags, is_published, is_active, sort_order").eq("organization_id", orgId),
    supabase.from("item_variants").select("id, item_id, name, price_delta, sort_order, is_active").eq("organization_id", orgId),
    supabase.from("modifier_groups").select("id, name, min_select, max_select, sort_order, is_active").eq("organization_id", orgId),
    supabase.from("modifiers").select("id, group_id, name, price_delta, sort_order, is_active").eq("organization_id", orgId),
    supabase.from("menu_item_modifier_groups").select("item_id, group_id, sort_order").eq("organization_id", orgId),
  ]);

  const variantsByItem = new Map<string, MenuVariant[]>();
  for (const v of variants.data ?? []) {
    const list = variantsByItem.get(v.item_id) ?? [];
    list.push({ id: v.id, name: v.name, priceDelta: v.price_delta, sortOrder: v.sort_order, isActive: v.is_active });
    variantsByItem.set(v.item_id, list);
  }
  const linksByItem = new Map<string, { groupId: string; sortOrder: number }[]>();
  for (const l of links.data ?? []) {
    const list = linksByItem.get(l.item_id) ?? [];
    list.push({ groupId: l.group_id, sortOrder: l.sort_order });
    linksByItem.set(l.item_id, list);
  }
  const modsByGroup = new Map<string, Modifier[]>();
  for (const m of mods.data ?? []) {
    const list = modsByGroup.get(m.group_id) ?? [];
    list.push({ id: m.id, name: m.name, priceDelta: m.price_delta, sortOrder: m.sort_order, isActive: m.is_active });
    modsByGroup.set(m.group_id, list);
  }

  const menuItems: MenuItem[] = (items.data ?? []).map((i) => ({
    id: i.id, categoryId: i.category_id, name: i.name, description: i.description, basePrice: i.base_price, imagePath: i.image_path,
    dietaryTags: i.dietary_tags.filter((t): t is DietaryTag => TAGS.includes(t)),
    isPublished: i.is_published, isActive: i.is_active, sortOrder: i.sort_order,
    variants: (variantsByItem.get(i.id) ?? []).sort(bySort),
    modifierGroupIds: (linksByItem.get(i.id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder).map((l) => l.groupId),
  })).sort(bySort);

  const activeCount = new Map<string, number>();
  for (const i of menuItems) if (i.isActive) activeCount.set(i.categoryId, (activeCount.get(i.categoryId) ?? 0) + 1);

  return {
    currency: ctx.org.currency,
    categories: (cats.data ?? []).map((c) => ({
      id: c.id, name: c.name, description: c.description, sortOrder: c.sort_order, isActive: c.is_active, itemCount: activeCount.get(c.id) ?? 0,
    })).sort(bySort),
    items: menuItems,
    modifierGroups: (groups.data ?? []).map((g) => ({
      id: g.id, name: g.name, minSelect: g.min_select, maxSelect: g.max_select, sortOrder: g.sort_order, isActive: g.is_active,
      modifiers: (modsByGroup.get(g.id) ?? []).sort(bySort),
    })).sort(bySort),
    canManage: ctx.permissions.includes("menu.manage"),
  };
}

export type KitchenStation = { id: string; name: string; sortOrder: number; isActive: boolean };
export type LocationMenuRow = {
  itemId: string; categoryId: string; name: string; isPublished: boolean; isActive: boolean;
  basePrice: number; priceOverride: number | null; effectivePrice: number;
  isAvailable: boolean; soldOutUntil: string | null; kitchenStationId: string | null;
};

/** Per-location availability data. Any member with access to the location can read. Call inside <Suspense>. */
export async function getLocationMenu(orgSlug: string, locationId: string): Promise<{
  currency: string; timezone: string; rows: LocationMenuRow[]; stations: KitchenStation[]; canManage: boolean; canToggleSoldOut: boolean;
}> {
  const ctx = await requireOrgContext(orgSlug);
  assertLocation(ctx, locationId);
  const orgId = ctx.org.id;
  const supabase = await createClient();
  const [loc, items, overrides, stations] = await Promise.all([
    supabase.from("locations").select("timezone").eq("organization_id", orgId).eq("id", locationId).maybeSingle(),
    supabase.from("menu_items").select("id, category_id, name, base_price, is_published, is_active, sort_order").eq("organization_id", orgId),
    supabase.from("location_menu_overrides").select("item_id, price_override, is_available, sold_out_until, kitchen_station_id")
      .eq("organization_id", orgId).eq("location_id", locationId),
    supabase.from("kitchen_stations").select("id, name, sort_order, is_active").eq("organization_id", orgId).eq("location_id", locationId),
  ]);
  const byItem = new Map((overrides.data ?? []).map((o) => [o.item_id, o]));
  const rows: LocationMenuRow[] = (items.data ?? []).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)).map((i) => {
    const o = byItem.get(i.id);
    return {
      itemId: i.id, categoryId: i.category_id, name: i.name, isPublished: i.is_published, isActive: i.is_active,
      basePrice: i.base_price, priceOverride: o?.price_override ?? null, effectivePrice: o?.price_override ?? i.base_price,
      isAvailable: o?.is_available ?? true, soldOutUntil: o?.sold_out_until ?? null, kitchenStationId: o?.kitchen_station_id ?? null,
    };
  });
  return {
    currency: ctx.org.currency,
    timezone: loc.data?.timezone ?? "Asia/Jakarta",
    rows,
    stations: (stations.data ?? []).map((s) => ({ id: s.id, name: s.name, sortOrder: s.sort_order, isActive: s.is_active })).sort(bySort),
    canManage: ctx.permissions.includes("menu.manage"),
    canToggleSoldOut: canToggleSoldOut(ctx),
  };
}
