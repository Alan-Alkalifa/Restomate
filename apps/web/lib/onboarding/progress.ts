import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import type { OrgContext } from "@/lib/auth/dal";
import { setupProgressTag } from "@/lib/auth/tags";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_PRIMARY } from "@/lib/theme";

/** Contract: docs/contracts/setup-progress.md. */
export const SETUP_STEPS = ["location", "tables", "menu", "staff", "branding"] as const;
export type SetupStepKey = (typeof SETUP_STEPS)[number];

export type SetupStep = {
  key: SetupStepKey;
  done: boolean;
  /** Path relative to the org, e.g. "settings", "{locationId}/tables", "menu", "staff". null = the user can't act on it */
  href: string | null;
};

export type SetupProgress = { steps: SetupStep[]; completed: number; total: number };

type DoneMap = Record<SetupStepKey, boolean>;

/**
 * The done flags, read through the signed-in user's client (RLS applies, so they reflect what this user can see).
 * 'use cache: private': the read needs the session cookies, and a private cache is per user. The key is the org id
 * only (no user data); inputs refresh it with updateTag(setupProgressTag(orgId)). It THROWS on a read error, so a
 * failure is never cached. No side effects.
 */
async function loadDone(orgId: string): Promise<DoneMap> {
  "use cache: private";
  cacheLife("minutes");
  cacheTag(setupProgressTag(orgId));

  const supabase = await createClient();
  const nowIso = new Date().toISOString();

  const [locs, ownerRoles, invites, branding] = await Promise.all([
    supabase.from("locations").select("id, address").eq("organization_id", orgId).eq("is_active", true),
    supabase.from("roles").select("id").eq("organization_id", orgId).eq("is_system", true).eq("key", "owner"),
    supabase
      .from("staff_invitations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .gt("expires_at", nowIso),
    supabase.from("org_branding").select("logo_url, logo_path, primary_color").eq("organization_id", orgId).maybeSingle(),
  ]);
  for (const r of [locs, ownerRoles, invites, branding]) {
    if (r.error) throw new Error(`getSetupProgress read failed: ${r.error.message}`);
  }

  const locations = locs.data ?? [];
  const locationIds = locations.map((l) => l.id);

  // Active members other than the owner(s), and active tables in active locations.
  let members = supabase
    .from("organization_members")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("status", "active");
  const ownerIds = (ownerRoles.data ?? []).map((r) => r.id);
  if (ownerIds.length > 0) members = members.not("role_id", "in", `(${ownerIds.join(",")})`);

  const [membersRes, tablesRes, menuRes] = await Promise.all([
    members,
    locationIds.length > 0
      ? supabase.from("tables").select("id", { count: "exact", head: true }).in("location_id", locationIds).eq("is_active", true)
      : Promise.resolve({ count: 0, error: null }),
    // At least one item guests could order: active and published (under RLS, scoped to this org).
    supabase.from("menu_items").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("is_active", true).eq("is_published", true),
  ]);
  if (membersRes.error) throw new Error(`getSetupProgress read failed: ${membersRes.error.message}`);
  if (tablesRes.error) throw new Error(`getSetupProgress read failed: ${tablesRes.error.message}`);
  if (menuRes.error) throw new Error(`getSetupProgress read failed: ${menuRes.error.message}`);

  const b = branding.data;
  const primary = b?.primary_color?.trim().toLowerCase() ?? "";
  return {
    location: locations.length >= 2 || locations.some((l) => (l.address ?? "").trim() !== ""),
    tables: (tablesRes.count ?? 0) > 0,
    menu: (menuRes.count ?? 0) > 0,
    staff: (membersRes.count ?? 0) > 0 || (invites.count ?? 0) > 0,
    branding: Boolean(b?.logo_url?.trim() || b?.logo_path?.trim()) || (primary !== "" && primary !== DEFAULT_PRIMARY.toLowerCase()),
  };
}

const NOT_DONE: DoneMap = { location: false, tables: false, menu: false, staff: false, branding: false };

/**
 * Setup checklist for the org home page. All five steps, in SETUP_STEPS order. `href` is computed here, outside the
 * cache, from the caller's permissions and accessible locations; it is null where the user cannot act. If the read
 * fails it logs and shows every step as not done rather than breaking the page.
 */
export async function getSetupProgress(ctx: OrgContext): Promise<SetupProgress> {
  let done = NOT_DONE;
  try {
    done = await loadDone(ctx.org.id);
  } catch (e) {
    console.error(`[setup-progress] ${e instanceof Error ? e.message : "unknown error"}`);
  }

  const can = (perm: OrgContext["permissions"][number]) => ctx.permissions.includes(perm);
  const firstLocation = ctx.locations[0];
  const href: Record<SetupStepKey, string | null> = {
    location: can("settings.manage") ? "settings" : null,
    tables: can("tables.manage") && firstLocation ? `${firstLocation.id}/tables` : null,
    menu: can("menu.manage") ? "menu" : null,
    staff: can("staff.manage") ? "staff" : null,
    branding: can("settings.manage") ? "settings" : null,
  };

  const steps = SETUP_STEPS.map((key): SetupStep => ({ key, done: done[key], href: href[key] }));
  return { steps, completed: steps.filter((s) => s.done).length, total: SETUP_STEPS.length };
}
