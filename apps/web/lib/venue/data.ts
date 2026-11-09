import "server-only";
import { requireOrgContext, requirePermission } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { assertLocation, storefrontOrigin } from "./shared";
import { tableIdsSchema } from "./schemas";

export type Area = { id: string; name: string; sortOrder: number; isActive: boolean; tableCount: number };
export type VenueTable = {
  id: string; areaId: string; label: string; capacity: number; shape: "square" | "round" | "rect";
  status: "available" | "reserved" | "occupied" | "needs_cleaning"; posX: number | null; posY: number | null; isActive: boolean;
};

const SHAPES = ["square", "round", "rect"] as const;
const STATUSES = ["available", "reserved", "occupied", "needs_cleaning"] as const;

/**
 * Venue page data. Any member with access to the location can read. Explicit columns only: qr_token is not
 * selectable by clients (column grants) and is never returned here. `tableLimit.used` counts the active tables the
 * caller can see; the database enforces the real, org-wide limit. Call inside <Suspense>.
 */
export async function getVenue(orgSlug: string, locationId: string): Promise<{
  areas: Area[]; tables: VenueTable[]; canManage: boolean; tableLimit: { used: number; max: number | null };
}> {
  const ctx = await requireOrgContext(orgSlug);
  assertLocation(ctx, locationId);
  const supabase = await createClient();
  const [areasRes, tablesRes, usedRes] = await Promise.all([
    supabase.from("areas").select("id, name, sort_order, is_active").eq("organization_id", ctx.org.id).eq("location_id", locationId)
      .order("sort_order").order("name"),
    supabase.from("tables").select("id, area_id, label, capacity, shape, status, pos_x, pos_y, is_active")
      .eq("organization_id", ctx.org.id).eq("location_id", locationId).order("label"),
    supabase.from("tables").select("id", { count: "exact", head: true }).eq("organization_id", ctx.org.id).eq("is_active", true),
  ]);
  const tables: VenueTable[] = (tablesRes.data ?? []).map((t) => ({
    id: t.id, areaId: t.area_id, label: t.label, capacity: t.capacity,
    shape: (SHAPES as readonly string[]).includes(t.shape) ? (t.shape as VenueTable["shape"]) : "square",
    status: (STATUSES as readonly string[]).includes(t.status) ? (t.status as VenueTable["status"]) : "available",
    posX: t.pos_x, posY: t.pos_y, isActive: t.is_active,
  }));
  const activeByArea = new Map<string, number>();
  for (const t of tables) if (t.isActive) activeByArea.set(t.areaId, (activeByArea.get(t.areaId) ?? 0) + 1);
  const areas: Area[] = (areasRes.data ?? []).map((a) => ({
    id: a.id, name: a.name, sortOrder: a.sort_order, isActive: a.is_active, tableCount: activeByArea.get(a.id) ?? 0,
  }));
  return {
    areas, tables,
    canManage: ctx.permissions.includes("tables.manage"),
    tableLimit: { used: usedRes.count ?? 0, max: ctx.package?.limits.max_tables ?? null },
  };
}

/**
 * QR links for the print sheet. tables.manage only, via the get_table_qr_tokens RPC (the only way to read tokens).
 * Never cache the result, and never put a token in a cache key or tag.
 */
export async function getTableQrTokens(orgSlug: string, locationId: string, tableIds?: string[]): Promise<
  { tableId: string; label: string; areaName: string; url: string }[]
> {
  const ctx = await requireOrgContext(orgSlug);
  await requirePermission(ctx.org.id, "tables.manage");
  assertLocation(ctx, locationId);
  const ids = tableIds === undefined ? undefined : tableIdsSchema.parse(tableIds);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_table_qr_tokens", { location_id: locationId, ...(ids ? { table_ids: ids } : {}) });
  if (error) throw new Error("Could not load QR codes.");
  const origin = storefrontOrigin(ctx.org.slug);
  return (data ?? []).map((r) => ({ tableId: r.table_id, label: r.label, areaName: r.area_name, url: `${origin}/t/${encodeURIComponent(r.qr_token)}` }));
}
