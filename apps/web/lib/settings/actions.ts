"use server";

import { updateTag } from "next/cache";
import { requireOrgContext, requirePermission, requireUser } from "@/lib/auth/dal";
import type { ActionResult } from "@/lib/auth/schemas";
import { createClient } from "@/lib/supabase/server";
import { assertLocation, venueTag } from "@/lib/venue/shared";
import { fieldErrors, parseForm, updateLocationTaxIdSchema } from "./schemas";

/*
 * Location settings actions. Org slug and location id are bound server-side; the organization never comes from
 * FormData. The write goes through RLS (locations_update needs locations.manage) and a column grant; a caller without
 * the permission updates zero rows, which is reported as FORBIDDEN, never as success.
 */
type SettingsAction = (orgSlug: string, locationId: string, prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;

/** Set or clear the location's NPWP (printed on bills when set). Needs locations.manage. */
export const updateLocationTaxId: SettingsAction = async (orgSlug, locationId, _prev, formData) => {
  const ctx = await requireOrgContext(orgSlug);
  assertLocation(ctx, locationId);
  await requirePermission(ctx.org.id, "locations.manage");
  await requireUser();
  const p = parseForm(updateLocationTaxIdSchema, formData);
  if (!p.success) return { ok: false, fieldErrors: fieldErrors(p.error) };
  const supabase = await createClient();
  const { data, error } = await supabase.from("locations").update({ tax_id: p.data.taxId })
    .eq("id", locationId).eq("organization_id", ctx.org.id).select("id").maybeSingle();
  if (error) {
    if (error.code === "23514") return { ok: false, fieldErrors: { taxId: ["An NPWP has 15 or 16 digits."] } };
    return { ok: false, formError: "Something went wrong. Please try again." };
  }
  if (!data) return { ok: false, code: "FORBIDDEN", formError: "You don't have permission to do that." };
  updateTag(venueTag(locationId));
  updateTag(`bills:${locationId}`);
  return { ok: true };
};
