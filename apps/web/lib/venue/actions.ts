"use server";

import { updateTag } from "next/cache";
import { requireOrgContext, requirePermission, requireUser } from "@/lib/auth/dal";
import type { ActionResult } from "@/lib/auth/schemas";
import { EVENTS } from "@/lib/posthog/events";
import { captureServer } from "@/lib/posthog/server";
import { createClient } from "@/lib/supabase/server";
import { mapVenueError } from "./errors";
import {
  createAreaSchema, createTableSchema, fieldErrors, parseForm, positionsSchema, renameAreaSchema, reorderAreasSchema,
  setAreaActiveSchema, setTableActiveSchema, tableIdSchema, updateTableSchema,
} from "./schemas";
import { assertLocation, venueTag } from "./shared";

/*
 * Venue Server Actions. Every mutation: requireOrgContext(slug) -> requirePermission(org.id, 'tables.manage') ->
 * location must be one the caller can access -> Zod -> ids must belong to THIS location (IDOR) -> RLS-checked write
 * -> updateTag -> PostHog (no PII, no tokens). orgSlug and locationId are bound server-side; the organization id
 * is never read from FormData. Limits, uniqueness and area/table integrity are enforced by SQL triggers and
 * constraints (migration 20261109000000); this layer maps their errors to friendly results.
 */
type VenueAction = (orgSlug: string, locationId: string, prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;

const OK: ActionResult = { ok: true };
const NOT_FOUND: ActionResult = { ok: false, code: "FORBIDDEN", formError: "That item could not be found in this location." };
const CHUNK = 25;

async function authorize(orgSlug: string, locationId: string) {
  const ctx = await requireOrgContext(orgSlug);
  await requirePermission(ctx.org.id, "tables.manage");
  assertLocation(ctx, locationId);
  const user = await requireUser();
  const supabase = await createClient();
  return { ctx, user, supabase, orgId: ctx.org.id };
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

const areaInLocation = async (s: Supabase, orgId: string, loc: string, areaId: string) =>
  (await s.from("areas").select("id, is_active").eq("organization_id", orgId).eq("location_id", loc).eq("id", areaId).maybeSingle()).data;

const tableInLocation = async (s: Supabase, orgId: string, loc: string, tableId: string) =>
  (await s.from("tables").select("id").eq("organization_id", orgId).eq("location_id", loc).eq("id", tableId).maybeSingle()).data;

export const createArea: VenueAction = async (orgSlug, locationId, _prev, formData) => {
  const { user, supabase, orgId } = await authorize(orgSlug, locationId);
  const parsed = parseForm(createAreaSchema, formData);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const { data: last } = await supabase.from("areas").select("sort_order").eq("organization_id", orgId).eq("location_id", locationId)
    .order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const { error } = await supabase.from("areas").insert({
    organization_id: orgId, location_id: locationId, name: parsed.data.name, sort_order: (last?.sort_order ?? -1) + 1,
  });
  if (error) return mapVenueError(error);
  captureServer(EVENTS.areaCreated, { distinctId: user.id, organizationId: orgId });
  updateTag(venueTag(locationId));
  return OK;
};

export const renameArea: VenueAction = async (orgSlug, locationId, _prev, formData) => {
  const { supabase, orgId } = await authorize(orgSlug, locationId);
  const parsed = parseForm(renameAreaSchema, formData);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  if (!(await areaInLocation(supabase, orgId, locationId, parsed.data.areaId))) return NOT_FOUND;
  const { error } = await supabase.from("areas").update({ name: parsed.data.name })
    .eq("organization_id", orgId).eq("location_id", locationId).eq("id", parsed.data.areaId);
  if (error) return mapVenueError(error);
  updateTag(venueTag(locationId));
  return OK;
};

export const setAreaActive: VenueAction = async (orgSlug, locationId, _prev, formData) => {
  const { supabase, orgId } = await authorize(orgSlug, locationId);
  const parsed = parseForm(setAreaActiveSchema, formData);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  if (!(await areaInLocation(supabase, orgId, locationId, parsed.data.areaId))) return NOT_FOUND;
  const { error } = await supabase.from("areas").update({ is_active: parsed.data.active })
    .eq("organization_id", orgId).eq("location_id", locationId).eq("id", parsed.data.areaId);
  if (error) return mapVenueError(error);
  updateTag(venueTag(locationId));
  return OK;
};

export const reorderAreas: VenueAction = async (orgSlug, locationId, _prev, formData) => {
  const { supabase, orgId } = await authorize(orgSlug, locationId);
  const parsed = parseForm(reorderAreasSchema, formData, ["areaIds"]);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const ids = parsed.data.areaIds;
  if (new Set(ids).size !== ids.length) return NOT_FOUND;
  const { data: owned } = await supabase.from("areas").select("id, sort_order").eq("organization_id", orgId).eq("location_id", locationId).in("id", ids);
  if (!owned || owned.length !== ids.length) return NOT_FOUND;
  const current = new Map(owned.map((a) => [a.id, a.sort_order]));
  const changed = ids.map((id, i) => ({ id, i })).filter(({ id, i }) => current.get(id) !== i);
  for (let n = 0; n < changed.length; n += CHUNK) {
    const results = await Promise.all(changed.slice(n, n + CHUNK).map(({ id, i }) =>
      supabase.from("areas").update({ sort_order: i }).eq("organization_id", orgId).eq("location_id", locationId).eq("id", id)));
    const failed = results.find((r) => r.error);
    if (failed?.error) return mapVenueError(failed.error);
  }
  updateTag(venueTag(locationId));
  return OK;
};

export const createTable: VenueAction = async (orgSlug, locationId, _prev, formData) => {
  const { user, supabase, orgId } = await authorize(orgSlug, locationId);
  const parsed = parseForm(createTableSchema, formData);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const { areaId, label, capacity, shape } = parsed.data;
  if (!(await areaInLocation(supabase, orgId, locationId, areaId))) return { ok: false, fieldErrors: { areaId: ["Choose an area from the list."] } };
  const { error } = await supabase.from("tables").insert({ organization_id: orgId, location_id: locationId, area_id: areaId, label, capacity, shape });
  if (error) return mapVenueError(error);
  captureServer(EVENTS.tableCreated, { distinctId: user.id, organizationId: orgId });
  updateTag(venueTag(locationId));
  return OK;
};

export const updateTable: VenueAction = async (orgSlug, locationId, _prev, formData) => {
  const { supabase, orgId } = await authorize(orgSlug, locationId);
  const parsed = parseForm(updateTableSchema, formData);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const { tableId, areaId, label, capacity, shape } = parsed.data;
  if (!(await tableInLocation(supabase, orgId, locationId, tableId))) return NOT_FOUND;
  if (!(await areaInLocation(supabase, orgId, locationId, areaId))) return { ok: false, fieldErrors: { areaId: ["Choose an area from the list."] } };
  const { error } = await supabase.from("tables").update({ area_id: areaId, label, capacity, shape })
    .eq("organization_id", orgId).eq("location_id", locationId).eq("id", tableId);
  if (error) return mapVenueError(error);
  updateTag(venueTag(locationId));
  return OK;
};

export const setTableActive: VenueAction = async (orgSlug, locationId, _prev, formData) => {
  const { supabase, orgId } = await authorize(orgSlug, locationId);
  const parsed = parseForm(setTableActiveSchema, formData);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  if (!(await tableInLocation(supabase, orgId, locationId, parsed.data.tableId))) return NOT_FOUND;
  const { error } = await supabase.from("tables").update({ is_active: parsed.data.active })
    .eq("organization_id", orgId).eq("location_id", locationId).eq("id", parsed.data.tableId);
  if (error) return mapVenueError(error);
  updateTag(venueTag(locationId));
  return OK;
};

export const saveTablePositions: VenueAction = async (orgSlug, locationId, _prev, formData) => {
  const { supabase, orgId } = await authorize(orgSlug, locationId);
  const parsed = parseForm(positionsSchema, formData);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  const positions = parsed.data.positions;
  const { data: owned } = await supabase.from("tables").select("id").eq("organization_id", orgId).eq("location_id", locationId)
    .in("id", positions.map((p) => p.tableId));
  if (!owned || owned.length !== positions.length) return NOT_FOUND;
  for (let n = 0; n < positions.length; n += CHUNK) {
    const results = await Promise.all(positions.slice(n, n + CHUNK).map((p) =>
      supabase.from("tables").update({ pos_x: p.posX, pos_y: p.posY }).eq("organization_id", orgId).eq("location_id", locationId).eq("id", p.tableId)));
    const failed = results.find((r) => r.error);
    if (failed?.error) return mapVenueError(failed.error);
  }
  updateTag(venueTag(locationId));
  return OK;
};

/** Replaces the table's QR token (the old link stops working at once). The new token is never returned or logged. */
export const rotateTableQr: VenueAction = async (orgSlug, locationId, _prev, formData) => {
  const { user, supabase, orgId } = await authorize(orgSlug, locationId);
  const parsed = parseForm(tableIdSchema, formData);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrors(parsed.error) };
  if (!(await tableInLocation(supabase, orgId, locationId, parsed.data.tableId))) return NOT_FOUND;
  const { error } = await supabase.rpc("rotate_table_qr_token", { table_id: parsed.data.tableId });
  if (error) return mapVenueError(error);
  captureServer(EVENTS.tableQrRotated, { distinctId: user.id, organizationId: orgId });
  updateTag(venueTag(locationId));
  return OK;
};
