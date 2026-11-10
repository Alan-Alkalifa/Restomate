"use server";

import { updateTag } from "next/cache";
import { forbidden } from "next/navigation";
import { requireOrgContext, requirePermission, requireUser } from "@/lib/auth/dal";
import type { ActionResult } from "@/lib/auth/schemas";
import { EVENTS } from "@/lib/posthog/events";
import { captureServer } from "@/lib/posthog/server";
import { createClient } from "@/lib/supabase/server";
import { mapMenuError } from "./errors";
import {
  createCategorySchema, createItemSchema, createModifierGroupSchema, createStationSchema, fieldErrors, parseForm,
  renameStationSchema, reorderCategoriesSchema, reorderItemsSchema, saveGroupModifiersSchema, saveItemVariantsSchema,
  setCategoryActiveSchema, setItemActiveSchema, setItemModifierGroupsSchema, setItemPublishedSchema, setLocationOverrideSchema,
  setModifierGroupActiveSchema, setStationActiveSchema, toggleSoldOutSchema, updateCategorySchema, updateItemSchema,
  updateModifierGroupSchema, type ListRow,
} from "./schemas";
import { assertLocation, canToggleSoldOut, menuLocationTag, menuTag } from "./shared";

/*
 * Menu Server Actions (contract: docs/contracts/menu.md). Every mutation:
 *   requireOrgContext(slug) -> requirePermission(org.id, 'menu.manage') (toggleSoldOut: menu.manage OR orders.create)
 *   -> assertLocation (location actions) -> Zod -> every id must belong to THIS org (and location) -> RLS-checked write
 *   -> updateTag -> PostHog (no PII).
 * The org id is NEVER read from FormData. Uniqueness, price bounds and cross-org integrity are also enforced in SQL.
 *
 * Full-list saves (saveItemVariants / saveGroupModifiers) run as separate statements (deactivate missing, update
 * listed, insert new) and are NOT one transaction. If a later statement fails, earlier ones stay applied; because the
 * list is the full desired state, simply saving again converges. Deactivation goes first so renames can reuse names.
 */
type MenuAction = (orgSlug: string, prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
type LocationMenuAction = (orgSlug: string, locationId: string, prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
type Supabase = Awaited<ReturnType<typeof createClient>>;

const OK: ActionResult = { ok: true };
const NOT_FOUND: ActionResult = { ok: false, code: "FORBIDDEN", formError: "That item could not be found." };
const CHUNK = 25;

async function authorize(orgSlug: string) {
  const ctx = await requireOrgContext(orgSlug);
  await requirePermission(ctx.org.id, "menu.manage");
  const user = await requireUser();
  return { ctx, user, supabase: await createClient(), orgId: ctx.org.id };
}
async function authorizeLocation(orgSlug: string, locationId: string) {
  const ctx = await requireOrgContext(orgSlug);
  await requirePermission(ctx.org.id, "menu.manage");
  assertLocation(ctx, locationId);
  const user = await requireUser();
  return { ctx, user, supabase: await createClient(), orgId: ctx.org.id };
}

const bump = (orgId: string) => updateTag(menuTag(orgId));
const bumpLocation = (orgId: string, locationId: string) => { updateTag(menuTag(orgId)); updateTag(menuLocationTag(orgId, locationId)); };

/** Every id in `ids` must exist in `table` for this org (and extra filters). */
async function allOwned(s: Supabase, table: "menu_categories" | "menu_items" | "modifier_groups", orgId: string, ids: string[]) {
  if (ids.length === 0) return true;
  const unique = [...new Set(ids)];
  const { data } = await s.from(table).select("id").eq("organization_id", orgId).in("id", unique);
  return !!data && data.length === unique.length;
}

async function runChunks<T>(items: T[], run: (x: T) => PromiseLike<{ error: { message?: string; code?: string } | null }>) {
  for (let n = 0; n < items.length; n += CHUNK) {
    const results = await Promise.all(items.slice(n, n + CHUNK).map(run));
    const failed = results.find((r) => r.error);
    if (failed?.error) return failed.error;
  }
  return null;
}

// ---- categories ---------------------------------------------------------------------------------------------------------
export const createCategory: MenuAction = async (orgSlug, _prev, formData) => {
  const { supabase, orgId } = await authorize(orgSlug);
  const parsed = parseForm(createCategorySchema, formData);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const { data: last } = await supabase.from("menu_categories").select("sort_order").eq("organization_id", orgId)
    .order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const { error } = await supabase.from("menu_categories").insert({
    organization_id: orgId, name: parsed.data.name, description: parsed.data.description, sort_order: (last?.sort_order ?? -1) + 1,
  });
  if (error) return mapMenuError(error);
  bump(orgId);
  return OK;
};

export const updateCategory: MenuAction = async (orgSlug, _prev, formData) => {
  const { supabase, orgId } = await authorize(orgSlug);
  const parsed = parseForm(updateCategorySchema, formData);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const { categoryId, name, description } = parsed.data;
  if (!(await allOwned(supabase, "menu_categories", orgId, [categoryId]))) return NOT_FOUND;
  const { error } = await supabase.from("menu_categories").update({ name, description }).eq("organization_id", orgId).eq("id", categoryId);
  if (error) return mapMenuError(error);
  bump(orgId);
  return OK;
};

export const setCategoryActive: MenuAction = async (orgSlug, _prev, formData) => {
  const { supabase, orgId } = await authorize(orgSlug);
  const parsed = parseForm(setCategoryActiveSchema, formData);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  if (!(await allOwned(supabase, "menu_categories", orgId, [parsed.data.categoryId]))) return NOT_FOUND;
  const { error } = await supabase.from("menu_categories").update({ is_active: parsed.data.active }).eq("organization_id", orgId).eq("id", parsed.data.categoryId);
  if (error) return mapMenuError(error);
  bump(orgId);
  return OK;
};

export const reorderCategories: MenuAction = async (orgSlug, _prev, formData) => {
  const { supabase, orgId } = await authorize(orgSlug);
  const parsed = parseForm(reorderCategoriesSchema, formData, ["categoryIds"]);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const ids = parsed.data.categoryIds;
  if (new Set(ids).size !== ids.length || !(await allOwned(supabase, "menu_categories", orgId, ids))) return NOT_FOUND;
  const error = await runChunks(ids.map((id, i) => ({ id, i })), ({ id, i }) =>
    supabase.from("menu_categories").update({ sort_order: i }).eq("organization_id", orgId).eq("id", id));
  if (error) return mapMenuError(error);
  bump(orgId);
  return OK;
};

// ---- items --------------------------------------------------------------------------------------------------------------
export const createItem: MenuAction = async (orgSlug, _prev, formData) => {
  const { user, supabase, orgId } = await authorize(orgSlug);
  const parsed = parseForm(createItemSchema, formData, ["dietaryTags"]);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const d = parsed.data;
  if (!(await allOwned(supabase, "menu_categories", orgId, [d.categoryId]))) return { ok: false, fieldErrors: { categoryId: ["Choose a category from the list."] } };
  const { data: last } = await supabase.from("menu_items").select("sort_order").eq("organization_id", orgId).eq("category_id", d.categoryId)
    .order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const { error } = await supabase.from("menu_items").insert({
    organization_id: orgId, category_id: d.categoryId, name: d.name, description: d.description, base_price: d.basePrice,
    dietary_tags: d.dietaryTags, is_published: d.isPublished, sort_order: (last?.sort_order ?? -1) + 1,
  });
  if (error) return mapMenuError(error);
  captureServer(EVENTS.menuItemCreated, { distinctId: user.id, organizationId: orgId });
  bump(orgId);
  return OK;
};

export const updateItem: MenuAction = async (orgSlug, _prev, formData) => {
  const { user, supabase, orgId } = await authorize(orgSlug);
  const parsed = parseForm(updateItemSchema, formData, ["dietaryTags"]);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const d = parsed.data;
  if (!(await allOwned(supabase, "menu_items", orgId, [d.itemId]))) return NOT_FOUND;
  if (!(await allOwned(supabase, "menu_categories", orgId, [d.categoryId]))) return { ok: false, fieldErrors: { categoryId: ["Choose a category from the list."] } };
  const { error } = await supabase.from("menu_items").update({
    category_id: d.categoryId, name: d.name, description: d.description, base_price: d.basePrice,
    dietary_tags: d.dietaryTags, is_published: d.isPublished,
  }).eq("organization_id", orgId).eq("id", d.itemId);
  if (error) return mapMenuError(error);
  captureServer(EVENTS.menuItemUpdated, { distinctId: user.id, organizationId: orgId });
  bump(orgId);
  return OK;
};

export const setItemActive: MenuAction = async (orgSlug, _prev, formData) => {
  const { supabase, orgId } = await authorize(orgSlug);
  const parsed = parseForm(setItemActiveSchema, formData);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  if (!(await allOwned(supabase, "menu_items", orgId, [parsed.data.itemId]))) return NOT_FOUND;
  const { error } = await supabase.from("menu_items").update({ is_active: parsed.data.active }).eq("organization_id", orgId).eq("id", parsed.data.itemId);
  if (error) return mapMenuError(error);
  bump(orgId);
  return OK;
};

export const setItemPublished: MenuAction = async (orgSlug, _prev, formData) => {
  const { supabase, orgId } = await authorize(orgSlug);
  const parsed = parseForm(setItemPublishedSchema, formData);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  if (!(await allOwned(supabase, "menu_items", orgId, [parsed.data.itemId]))) return NOT_FOUND;
  const { error } = await supabase.from("menu_items").update({ is_published: parsed.data.published }).eq("organization_id", orgId).eq("id", parsed.data.itemId);
  if (error) return mapMenuError(error);
  bump(orgId);
  return OK;
};

export const reorderItems: MenuAction = async (orgSlug, _prev, formData) => {
  const { supabase, orgId } = await authorize(orgSlug);
  const parsed = parseForm(reorderItemsSchema, formData, ["itemIds"]);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const { categoryId, itemIds } = parsed.data;
  if (new Set(itemIds).size !== itemIds.length) return NOT_FOUND;
  const { data: owned } = await supabase.from("menu_items").select("id").eq("organization_id", orgId).eq("category_id", categoryId).in("id", itemIds);
  if (!owned || owned.length !== itemIds.length) return NOT_FOUND;
  const error = await runChunks(itemIds.map((id, i) => ({ id, i })), ({ id, i }) =>
    supabase.from("menu_items").update({ sort_order: i }).eq("organization_id", orgId).eq("category_id", categoryId).eq("id", id));
  if (error) return mapMenuError(error);
  bump(orgId);
  return OK;
};

export const saveItemVariants: MenuAction = async (orgSlug, _prev, formData) => {
  const { supabase, orgId } = await authorize(orgSlug);
  const parsed = parseForm(saveItemVariantsSchema, formData);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const { itemId, variants } = parsed.data;
  if (!(await allOwned(supabase, "menu_items", orgId, [itemId]))) return NOT_FOUND;
  const { data: existing } = await supabase.from("item_variants").select("id, is_active").eq("organization_id", orgId).eq("item_id", itemId);
  const known = new Set((existing ?? []).map((v) => v.id));
  if (variants.some((v) => v.id && !known.has(v.id))) return NOT_FOUND; // a variant id from another item / org
  const keep = new Set(variants.flatMap((v) => (v.id ? [v.id] : [])));
  const missing = (existing ?? []).filter((v) => v.is_active && !keep.has(v.id)).map((v) => v.id);

  if (missing.length) {
    const { error } = await supabase.from("item_variants").update({ is_active: false }).eq("organization_id", orgId).eq("item_id", itemId).in("id", missing);
    if (error) return mapMenuError(error);
  }
  const rows = variants.map((v, i) => ({ ...v, i }));
  const upErr = await runChunks(rows.filter((r) => r.id), (r) =>
    supabase.from("item_variants").update({ name: r.name, price_delta: r.priceDelta, sort_order: r.i, is_active: true })
      .eq("organization_id", orgId).eq("item_id", itemId).eq("id", r.id!));
  if (upErr) return listError(upErr, "variants");
  const fresh = rows.filter((r) => !r.id);
  if (fresh.length) {
    const { error } = await supabase.from("item_variants").insert(
      fresh.map((r) => ({ organization_id: orgId, item_id: itemId, name: r.name, price_delta: r.priceDelta, sort_order: r.i })));
    if (error) return listError(error, "variants");
  }
  bump(orgId);
  return OK;
};

/** A unique violation inside a JSON list is reported against the list field, not `name`. */
function listError(error: { message?: string; code?: string }, field: "variants" | "modifiers"): ActionResult {
  const r = mapMenuError(error);
  if (r.ok === false && r.code === "DUPLICATE_NAME") return { ...r, fieldErrors: { [field]: ["Two rows have the same name."] } };
  return r;
}

export const setItemModifierGroups: MenuAction = async (orgSlug, _prev, formData) => {
  const { supabase, orgId } = await authorize(orgSlug);
  const parsed = parseForm(setItemModifierGroupsSchema, formData, ["groupIds"]);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const { itemId, groupIds } = parsed.data;
  if (new Set(groupIds).size !== groupIds.length) return { ok: false, fieldErrors: { groupIds: ["Choose each group once."] } };
  if (!(await allOwned(supabase, "menu_items", orgId, [itemId]))) return NOT_FOUND;
  if (!(await allOwned(supabase, "modifier_groups", orgId, groupIds))) return { ok: false, fieldErrors: { groupIds: ["Choose groups from the list."] } };
  const { data: existing } = await supabase.from("menu_item_modifier_groups").select("group_id").eq("organization_id", orgId).eq("item_id", itemId);
  const have = new Set((existing ?? []).map((l) => l.group_id));
  const remove = [...have].filter((g) => !groupIds.includes(g));
  if (remove.length) {
    const { error } = await supabase.from("menu_item_modifier_groups").delete().eq("organization_id", orgId).eq("item_id", itemId).in("group_id", remove);
    if (error) return mapMenuError(error);
  }
  const upErr = await runChunks(groupIds.map((g, i) => ({ g, i })), ({ g, i }) => have.has(g)
    ? supabase.from("menu_item_modifier_groups").update({ sort_order: i }).eq("organization_id", orgId).eq("item_id", itemId).eq("group_id", g)
    : supabase.from("menu_item_modifier_groups").insert({ organization_id: orgId, item_id: itemId, group_id: g, sort_order: i }));
  if (upErr) return mapMenuError(upErr);
  bump(orgId);
  return OK;
};

// ---- modifier groups ---------------------------------------------------------------------------------------------------
export const createModifierGroup: MenuAction = async (orgSlug, _prev, formData) => {
  const { supabase, orgId } = await authorize(orgSlug);
  const parsed = parseForm(createModifierGroupSchema, formData);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const { data: last } = await supabase.from("modifier_groups").select("sort_order").eq("organization_id", orgId)
    .order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const { error } = await supabase.from("modifier_groups").insert({
    organization_id: orgId, name: parsed.data.name, min_select: parsed.data.minSelect, max_select: parsed.data.maxSelect,
    sort_order: (last?.sort_order ?? -1) + 1,
  });
  if (error) return mapMenuError(error);
  bump(orgId);
  return OK;
};

export const updateModifierGroup: MenuAction = async (orgSlug, _prev, formData) => {
  const { supabase, orgId } = await authorize(orgSlug);
  const parsed = parseForm(updateModifierGroupSchema, formData);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const d = parsed.data;
  if (!(await allOwned(supabase, "modifier_groups", orgId, [d.groupId]))) return NOT_FOUND;
  const { error } = await supabase.from("modifier_groups").update({ name: d.name, min_select: d.minSelect, max_select: d.maxSelect })
    .eq("organization_id", orgId).eq("id", d.groupId);
  if (error) return mapMenuError(error);
  bump(orgId);
  return OK;
};

export const setModifierGroupActive: MenuAction = async (orgSlug, _prev, formData) => {
  const { supabase, orgId } = await authorize(orgSlug);
  const parsed = parseForm(setModifierGroupActiveSchema, formData);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  if (!(await allOwned(supabase, "modifier_groups", orgId, [parsed.data.groupId]))) return NOT_FOUND;
  const { error } = await supabase.from("modifier_groups").update({ is_active: parsed.data.active }).eq("organization_id", orgId).eq("id", parsed.data.groupId);
  if (error) return mapMenuError(error);
  bump(orgId);
  return OK;
};

export const saveGroupModifiers: MenuAction = async (orgSlug, _prev, formData) => {
  const { supabase, orgId } = await authorize(orgSlug);
  const parsed = parseForm(saveGroupModifiersSchema, formData);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const { groupId, modifiers } = parsed.data;
  if (!(await allOwned(supabase, "modifier_groups", orgId, [groupId]))) return NOT_FOUND;
  const { data: existing } = await supabase.from("modifiers").select("id, is_active").eq("organization_id", orgId).eq("group_id", groupId);
  const known = new Set((existing ?? []).map((m) => m.id));
  if (modifiers.some((m) => m.id && !known.has(m.id))) return NOT_FOUND;
  const keep = new Set(modifiers.flatMap((m) => (m.id ? [m.id] : [])));
  const missing = (existing ?? []).filter((m) => m.is_active && !keep.has(m.id)).map((m) => m.id);

  if (missing.length) {
    const { error } = await supabase.from("modifiers").update({ is_active: false }).eq("organization_id", orgId).eq("group_id", groupId).in("id", missing);
    if (error) return mapMenuError(error);
  }
  const rows: (ListRow & { i: number })[] = modifiers.map((m, i) => ({ ...m, i }));
  const upErr = await runChunks(rows.filter((r) => r.id), (r) =>
    supabase.from("modifiers").update({ name: r.name, price_delta: r.priceDelta, sort_order: r.i, is_active: true })
      .eq("organization_id", orgId).eq("group_id", groupId).eq("id", r.id!));
  if (upErr) return listError(upErr, "modifiers");
  const fresh = rows.filter((r) => !r.id);
  if (fresh.length) {
    const { error } = await supabase.from("modifiers").insert(
      fresh.map((r) => ({ organization_id: orgId, group_id: groupId, name: r.name, price_delta: r.priceDelta, sort_order: r.i })));
    if (error) return listError(error, "modifiers");
  }
  bump(orgId);
  return OK;
};

// ---- location level -----------------------------------------------------------------------------------------------------
export const setLocationOverride: LocationMenuAction = async (orgSlug, locationId, _prev, formData) => {
  const { supabase, orgId } = await authorizeLocation(orgSlug, locationId);
  const parsed = parseForm(setLocationOverrideSchema, formData);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const { itemId, priceOverride, isAvailable, kitchenStationId } = parsed.data;
  if (!(await allOwned(supabase, "menu_items", orgId, [itemId]))) return NOT_FOUND;
  if (kitchenStationId) {
    const { data: st } = await supabase.from("kitchen_stations").select("id").eq("organization_id", orgId).eq("location_id", locationId)
      .eq("id", kitchenStationId).eq("is_active", true).maybeSingle();
    if (!st) return { ok: false, fieldErrors: { kitchenStationId: ["Choose a station from the list."] } };
  }
  const { data: current } = await supabase.from("location_menu_overrides").select("id").eq("organization_id", orgId)
    .eq("location_id", locationId).eq("item_id", itemId).maybeSingle();
  // sold_out_until is never touched here: it belongs to set_item_sold_out.
  const { error } = current
    ? await supabase.from("location_menu_overrides").update({ price_override: priceOverride, is_available: isAvailable, kitchen_station_id: kitchenStationId })
        .eq("organization_id", orgId).eq("location_id", locationId).eq("id", current.id)
    : await supabase.from("location_menu_overrides").insert({
        organization_id: orgId, location_id: locationId, item_id: itemId,
        price_override: priceOverride, is_available: isAvailable, kitchen_station_id: kitchenStationId,
      });
  if (error) return mapMenuError(error);
  bumpLocation(orgId, locationId);
  return OK;
};

/** menu.manage OR orders.create (cashier / waiter). The RPC re-checks permission, location access and item ownership. */
export const toggleSoldOut: LocationMenuAction = async (orgSlug, locationId, _prev, formData) => {
  const ctx = await requireOrgContext(orgSlug);
  if (!canToggleSoldOut(ctx)) forbidden();
  assertLocation(ctx, locationId);
  const user = await requireUser();
  const parsed = parseForm(toggleSoldOutSchema, formData);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_item_sold_out", { location_id: locationId, item_id: parsed.data.itemId, sold_out: parsed.data.soldOut });
  if (error) return mapMenuError(error);
  captureServer(EVENTS.menuItemSoldOutToggled, { distinctId: user.id, organizationId: ctx.org.id, properties: { sold_out: parsed.data.soldOut } });
  bumpLocation(ctx.org.id, locationId);
  return OK;
};

export const createStation: LocationMenuAction = async (orgSlug, locationId, _prev, formData) => {
  const { supabase, orgId } = await authorizeLocation(orgSlug, locationId);
  const parsed = parseForm(createStationSchema, formData);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const { data: last } = await supabase.from("kitchen_stations").select("sort_order").eq("organization_id", orgId).eq("location_id", locationId)
    .order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const { error } = await supabase.from("kitchen_stations").insert({
    organization_id: orgId, location_id: locationId, name: parsed.data.name, sort_order: (last?.sort_order ?? -1) + 1,
  });
  if (error) return mapMenuError(error);
  bumpLocation(orgId, locationId);
  return OK;
};

const stationInLocation = async (s: Supabase, orgId: string, locationId: string, stationId: string) =>
  (await s.from("kitchen_stations").select("id").eq("organization_id", orgId).eq("location_id", locationId).eq("id", stationId).maybeSingle()).data;

export const renameStation: LocationMenuAction = async (orgSlug, locationId, _prev, formData) => {
  const { supabase, orgId } = await authorizeLocation(orgSlug, locationId);
  const parsed = parseForm(renameStationSchema, formData);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  if (!(await stationInLocation(supabase, orgId, locationId, parsed.data.stationId))) return NOT_FOUND;
  const { error } = await supabase.from("kitchen_stations").update({ name: parsed.data.name })
    .eq("organization_id", orgId).eq("location_id", locationId).eq("id", parsed.data.stationId);
  if (error) return mapMenuError(error);
  bumpLocation(orgId, locationId);
  return OK;
};

export const setStationActive: LocationMenuAction = async (orgSlug, locationId, _prev, formData) => {
  const { supabase, orgId } = await authorizeLocation(orgSlug, locationId);
  const parsed = parseForm(setStationActiveSchema, formData);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  if (!(await stationInLocation(supabase, orgId, locationId, parsed.data.stationId))) return NOT_FOUND;
  const { error } = await supabase.from("kitchen_stations").update({ is_active: parsed.data.active })
    .eq("organization_id", orgId).eq("location_id", locationId).eq("id", parsed.data.stationId);
  if (error) return mapMenuError(error);
  bumpLocation(orgId, locationId);
  return OK;
};
