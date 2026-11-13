"use server";

import { updateTag } from "next/cache";
import type { z } from "zod";
import { requireOrgContext, requirePermission, requireUser } from "@/lib/auth/dal";
import type { ActionResult } from "@/lib/auth/schemas";
import { createClient } from "@/lib/supabase/server";
import { venueTag } from "@/lib/venue/shared";
import { mapStorefrontError } from "./errors";
import { fieldErrors, parseForm, saveLocationHoursSchema, updateOrderingSettingsSchema } from "./schemas";
import { assertLocation, storefrontTag } from "./shared";

/*
 * Storefront settings Server Actions (docs/contracts/storefront.md). Every mutation: requireOrgContext(slug) ->
 * requirePermission(org.id, 'locations.manage') -> the location must be one the caller can access -> Zod -> RLS-checked
 * write (and the database triggers/constraints as the backstop) -> updateTag. orgSlug and locationId are bound
 * server-side; an organization id never comes from FormData.
 */
type StorefrontAction = (orgSlug: string, locationId: string, prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;

async function authorize(orgSlug: string, locationId: string) {
  const ctx = await requireOrgContext(orgSlug);
  assertLocation(ctx, locationId);
  await requirePermission(ctx.org.id, "locations.manage");
  await requireUser();
  return { ctx, supabase: await createClient() };
}

function refresh(slug: string, locationId: string) {
  updateTag(storefrontTag(slug));
  updateTag(venueTag(locationId));
}

function parse<S extends z.ZodType>(schema: S, formData: FormData) {
  const p = parseForm(schema, formData);
  return p.success ? { data: p.data as z.infer<S> } : { error: { ok: false, fieldErrors: fieldErrors(p.error) } as ActionResult };
}

/** Ordering switches and pickup settings. Online pickup can only be turned on once the location has opening hours. */
export const updateOrderingSettings: StorefrontAction = async (orgSlug, locationId, _prev, formData) => {
  const { ctx, supabase } = await authorize(orgSlug, locationId);
  const p = parse(updateOrderingSettingsSchema, formData);
  if (p.error) return p.error;
  const v = p.data;
  if (v.onlineEnabled) {
    const { count, error } = await supabase.from("location_hours").select("id", { count: "exact", head: true })
      .eq("organization_id", ctx.org.id).eq("location_id", locationId);
    if (error) return mapStorefrontError(error);
    if (!count) return mapStorefrontError({ message: "HOURS_REQUIRED" }); // friendly field error before any write
  }
  const { data, error } = await supabase.from("location_ordering_settings").update({
    qr_enabled: v.qrEnabled, online_enabled: v.onlineEnabled, accepting_orders: v.acceptingOrders,
    auto_accept_qr: v.autoAcceptQr, auto_accept_online: v.autoAcceptOnline,
    pickup_lead_minutes: v.pickupLeadMinutes, pickup_slot_minutes: v.pickupSlotMinutes,
    pickup_max_orders_per_slot: (v.pickupMaxOrdersPerSlot ?? null) as unknown as number, // null clears the limit; the generated type is non-null
    min_order_amount: v.minOrderAmount, pending_ttl_minutes: v.pendingTtlMinutes,
  }).eq("location_id", locationId).eq("organization_id", ctx.org.id).select("location_id").maybeSingle();
  if (error) return mapStorefrontError(error);
  if (!data) return mapStorefrontError({ code: "42501" }); // RLS refused (no locations.manage): zero rows is never success
  refresh(ctx.org.slug, locationId);
  return { ok: true };
};

/** Replaces the location's whole opening-hours list in one transaction (weekday minute intervals). */
export const saveLocationHours: StorefrontAction = async (orgSlug, locationId, _prev, formData) => {
  const { ctx, supabase } = await authorize(orgSlug, locationId);
  const p = parse(saveLocationHoursSchema, formData);
  if (p.error) return p.error;
  const { error } = await supabase.rpc("save_location_hours", { location_id: locationId, intervals: p.data.intervals });
  if (error) return mapStorefrontError(error);
  refresh(ctx.org.slug, locationId);
  return { ok: true };
};
