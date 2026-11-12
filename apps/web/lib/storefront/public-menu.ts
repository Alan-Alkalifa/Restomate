import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";
import { createAnonClient } from "@/lib/supabase/anon";
import { SLUG, UUID, storefrontTag } from "./shared";

/**
 * The public menu of one location: published, active items that are available right now, with the effective price,
 * active variants and modifier groups (get_public_menu). Cached briefly and tagged `storefront:{slug}`; availability
 * and sold-out state are re-checked server-side at order time, so a cached menu can only be slightly stale for display.
 */
export type PublicModifier = { id: string; name: string; priceDelta: number };
export type PublicModifierGroup = { id: string; name: string; minSelect: number; maxSelect: number; modifiers: PublicModifier[] };
export type PublicMenuItem = {
  id: string; name: string; description: string | null; price: number; imagePath: string | null; dietaryTags: string[];
  variants: { id: string; name: string; priceDelta: number }[]; modifierGroups: PublicModifierGroup[];
};
export type PublicMenu = { currency: string; categories: { id: string; name: string; description: string | null; items: PublicMenuItem[] }[] };

const sv = z.string();
const menuSchema = z.object({
  currency: z.string(),
  categories: z.array(z.object({
    id: sv, name: sv, description: sv.nullish(),
    items: z.array(z.object({
      id: sv, name: sv, description: sv.nullish(), price: z.number(), image_path: sv.nullish(), dietary_tags: z.array(sv).default([]),
      variants: z.array(z.object({ id: sv, name: sv, price_delta: z.number() })).default([]),
      modifier_groups: z.array(z.object({
        id: sv, name: sv, min_select: z.number(), max_select: z.number(),
        modifiers: z.array(z.object({ id: sv, name: sv, price_delta: z.number() })).nullish(),
      })).default([]),
    })),
  })).default([]),
}).nullable();

export function parsePublicMenu(raw: unknown): PublicMenu | null {
  const m = menuSchema.parse(raw);
  if (m === null) return null;
  return {
    currency: m.currency.trim(),
    categories: m.categories.map((c) => ({
      id: c.id, name: c.name, description: c.description ?? null,
      items: c.items.map((i) => ({
        id: i.id, name: i.name, description: i.description ?? null, price: i.price, imagePath: i.image_path ?? null, dietaryTags: i.dietary_tags,
        variants: i.variants.map((v) => ({ id: v.id, name: v.name, priceDelta: v.price_delta })),
        modifierGroups: i.modifier_groups.map((g) => ({
          id: g.id, name: g.name, minSelect: g.min_select, maxSelect: g.max_select,
          modifiers: (g.modifiers ?? []).map((x) => ({ id: x.id, name: x.name, priceDelta: x.price_delta })),
        })),
      })),
    })),
  };
}

/** `null` = not public (unknown slug, suspended, inactive or another org's location). */
export async function getPublicMenu(slugInput: string, locationId: string): Promise<PublicMenu | null> {
  const slug = slugInput.trim().toLowerCase();
  if (!SLUG.test(slug) || !UUID.test(locationId)) return null; // also keeps cache tags/keys to a safe charset
  return fetchPublicMenu(slug, locationId);
}

async function fetchPublicMenu(slug: string, locationId: string): Promise<PublicMenu | null> {
  "use cache";
  cacheTag(storefrontTag(slug));
  cacheLife("minutes");
  const { data, error } = await createAnonClient().rpc("get_public_menu", { org_slug: slug, location_id: locationId });
  if (error) throw new Error(`getPublicMenu failed: ${error.message}`);
  return parsePublicMenu(data);
}
