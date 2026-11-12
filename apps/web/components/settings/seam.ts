import "server-only";

import { requireOrgContext, requirePermission } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

/*
 * TEMPORARY SEAM until B1-T33 (DAVIN) adds `getLocationSettings` to lib/settings/data.ts. Delete this file and import the
 * real function in the settings page (same name, same shape: ALAN's spec).
 *
 * It is the query the real one will make: the user's own locations (RLS: has_location_access; SELECT on `locations` is
 * table-level, see the tax_id migration), explicit columns, scoped by the organization derived from the slug. `canEdit`
 * mirrors the write rule (locations.manage); the action itself enforces it again, so this only decides what the UI offers.
 */
export type LocationSettingsRow = { id: string; name: string; taxId: string | null; canEdit: boolean };

export async function getLocationSettings(orgSlug: string): Promise<LocationSettingsRow[]> {
  const ctx = await requireOrgContext(orgSlug);
  const perms = ctx.permissions as string[];
  if (!perms.includes("settings.manage") && !perms.includes("locations.manage")) await requirePermission(ctx.org.id, "settings.manage"); // forbidden()
  const canEdit = perms.includes("locations.manage");
  const supabase = await createClient();
  const { data, error } = await supabase.from("locations").select("id, name, tax_id")
    .eq("organization_id", ctx.org.id).eq("is_active", true).order("name");
  if (error) throw new Error("Could not load location settings.");
  return (data ?? []).map((l) => ({ id: l.id, name: l.name, taxId: l.tax_id, canEdit }));
}
