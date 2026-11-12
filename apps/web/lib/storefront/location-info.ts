import "server-only";
import { connection } from "next/server";
import { z } from "zod";
import { createAnonClient } from "@/lib/supabase/anon";
import { SLUG, UUID } from "./shared";

/*
 * Public location data for the customer site (docs/contracts/storefront.md). Both reads are time-dependent
 * ("open now", pickup slots), so they are NEVER cached: `connection()` keeps them out of the static shell, and a
 * stale cache can therefore never offer a closed location. Whitelisted fields only (the SQL functions enforce it).
 */
export type LocationInfo = {
  name: string; currency: string; timezone: string; address: string | null; city: string | null; phone: string | null;
  taxRateBps: number; serviceChargeBps: number; taxOnServiceCharge: boolean;
  hours: { day: number; opens: string; closes: string }[];
  openNow: boolean;
  ordering: { qr: boolean; online: boolean; accepting: boolean };
  minOrderAmount: number;
  pickup: { leadMinutes: number; slotMinutes: number };
};

const infoSchema = z.object({
  name: z.string(), currency: z.string(), timezone: z.string(),
  address: z.string().nullish(), city: z.string().nullish(), phone: z.string().nullish(),
  taxRateBps: z.number().int(), serviceChargeBps: z.number().int(), taxOnServiceCharge: z.boolean(),
  hours: z.array(z.object({ day: z.number().int().min(0).max(6), opens: z.string(), closes: z.string() })),
  openNow: z.boolean(),
  ordering: z.object({ qr: z.boolean(), online: z.boolean(), accepting: z.boolean() }),
  minOrderAmount: z.number().int(),
  pickup: z.object({ leadMinutes: z.number().int(), slotMinutes: z.number().int() }),
}).nullable();

/** Validate the get_public_location_info output. `null` = not public (unknown, suspended, inactive, other org). */
export function parseLocationInfo(raw: unknown): LocationInfo | null {
  const r = infoSchema.parse(raw);
  if (r === null) return null;
  return { ...r, address: r.address ?? null, city: r.city ?? null, phone: r.phone ?? null, currency: r.currency.trim() };
}

const slotsSchema = z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)).max(24);

/** Opening hours, "open now" (computed in the location's timezone), ordering switches and pickup settings. */
export async function getLocationInfo(slugInput: string, locationId: string): Promise<LocationInfo | null> {
  const slug = slugInput.trim().toLowerCase();
  if (!SLUG.test(slug) || !UUID.test(locationId)) return null;
  await connection();
  const { data, error } = await createAnonClient().rpc("get_public_location_info", { org_slug: slug, location_id: locationId });
  if (error) throw new Error(`getLocationInfo failed: ${error.message}`);
  return parseLocationInfo(data);
}

/** Up to 24 upcoming pickup times today (ISO UTC). Empty when online ordering is off or the location is not public. */
export async function getPickupSlots(slugInput: string, locationId: string): Promise<string[]> {
  const slug = slugInput.trim().toLowerCase();
  if (!SLUG.test(slug) || !UUID.test(locationId)) return [];
  await connection();
  const { data, error } = await createAnonClient().rpc("get_pickup_slots", { org_slug: slug, location_id: locationId });
  if (error) throw new Error(`getPickupSlots failed: ${error.message}`);
  const r = slotsSchema.safeParse(data);
  return r.success ? r.data : [];
}
