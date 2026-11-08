import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { forbidden, notFound, redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isPermissionKey, type PermissionKey } from "./permissions";
import { sanitizeNext } from "./redirect";
import { memberTag, orgTag } from "./tags";

/*
 * Auth DAL. Every export reads cookies (the Supabase session), so CALLERS MUST BE INSIDE A <Suspense> BOUNDARY
 * (Cache Components makes a runtime read outside Suspense a build error).
 *
 * Caching: `getCurrentUser` and the org loader use `'use cache: private'` (they read cookies, so a plain
 * `'use cache'` scope cannot be used) and always run under RLS with the user's own session. The service-role
 * client is never used here. In production a private cache is not stored across requests (it only dedupes within
 * one request); in dev it is held in memory keyed by the request cookies. Cache keys are the function arguments
 * (user id, org slug); tags are `org:{orgId}` and `member:{userId}:{orgId}` (IDs only).
 */

export type CurrentUser = { id: string; email: string };

export type OrgStatus = "active" | "suspended" | "past_due" | "read_only";

export type OrgContext = {
  org: { id: string; slug: string; name: string; status: OrgStatus; currency: string; timezone: string };
  membership: { roleKey: string; roleName: string; allLocations: boolean };
  /** From my_permissions(org); [] for a suspended org. */
  permissions: PermissionKey[];
  /** Only locations the user can access (has_location_access, enforced by RLS). */
  locations: { id: string; name: string }[];
  package: { code: string; name: string; features: string[]; limits: Record<string, number | null> } | null;
};

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * The signed-in user, from a verified JWT (`getClaims`; never `getSession`, which trusts the cookie).
 * Returns null when signed out. Call only inside a <Suspense> boundary.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  "use cache: private";
  cacheLife({ stale: 30 });

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims || typeof claims.sub !== "string" || claims.sub.length === 0) return null;
  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : "" };
}

/**
 * Like getCurrentUser, but redirects to `/login?next=…` when signed out. `next` must be a same-site path;
 * anything else falls back to "/". Call only inside a <Suspense> boundary.
 */
export async function requireUser(next?: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (user) return user;
  const target = next === undefined ? null : sanitizeNext(next, "");
  redirect(target ? `/login?next=${encodeURIComponent(target)}` : "/login");
}

const membershipSchema = z.object({
  all_locations: z.boolean(),
  org: z.object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    status: z.string(),
    currency: z.string(),
    timezone: z.string(),
  }),
  role: z.object({ key: z.string(), name: z.string() }),
});
const packageSchema = z.object({
  code: z.string(),
  name: z.string(),
  features: z.array(z.string()),
  limits: z.record(z.string(), z.number().nullable()),
});

function toOrgStatus(value: string): OrgStatus {
  // Unknown status fails closed: treated as suspended (no permissions).
  return value === "active" || value === "suspended" || value === "past_due" || value === "read_only"
    ? value
    : "suspended";
}

async function loadOrgContext(userId: string, orgSlug: string): Promise<OrgContext | null> {
  "use cache: private";
  cacheLife({ stale: 30 });

  const supabase = await createClient();

  // The caller's own active membership, via a definer RPC: it works for a suspended org too (RLS hides the
  // member's own rows while suspended) and returns null for an unknown slug, a non-member and a deactivated
  // member alike, so slugs cannot be enumerated. A platform admin who is not a member also gets null.
  const { data: raw, error } = await supabase.rpc("my_org_membership", { org_slug: orgSlug });
  const parsed = membershipSchema.safeParse(raw);
  if (error || !parsed.success) return null;
  const { org: orgRow, role, all_locations: allLocations } = parsed.data;
  const status = toOrgStatus(orgRow.status);

  cacheTag(orgTag(orgRow.id), memberTag(userId, orgRow.id));

  const [permsRes, locsRes, pkgRes] = await Promise.all([
    status === "suspended" ? Promise.resolve({ data: [] as string[] }) : supabase.rpc("my_permissions", { org: orgRow.id }),
    supabase.from("locations").select("id, name").eq("organization_id", orgRow.id).eq("is_active", true).order("name"),
    supabase.rpc("get_org_package", { org: orgRow.id }),
  ]);

  const permissions = (Array.isArray(permsRes.data) ? permsRes.data : []).filter(isPermissionKey);
  const locations = (locsRes.data ?? []).map((l) => ({ id: l.id, name: l.name }));
  const pkgParsed = packageSchema.safeParse(pkgRes.data);

  return {
    org: { id: orgRow.id, slug: orgRow.slug, name: orgRow.name, status, currency: orgRow.currency, timezone: orgRow.timezone },
    membership: { roleKey: role.key, roleName: role.name, allLocations },
    permissions: status === "suspended" ? [] : permissions,
    locations,
    package: pkgParsed.success ? pkgParsed.data : null,
  };
}

/**
 * The org context for the signed-in user, derived from the slug plus their membership (never from client input).
 * null = signed out, unknown slug, not a member, or deactivated (all indistinguishable).
 * A suspended org still returns a context (status 'suspended', permissions []) so the layout can show a notice.
 * Call only inside a <Suspense> boundary.
 */
export async function getOrgContext(orgSlug: string): Promise<OrgContext | null> {
  const slug = orgSlug.trim().toLowerCase();
  if (!SLUG.test(slug)) return null;
  const user = await getCurrentUser();
  if (!user) return null;
  return loadOrgContext(user.id, slug);
}

/**
 * getOrgContext or `notFound()` (404). The response is identical for an unknown org and a non-member, so org
 * slugs cannot be enumerated. Signed-out users are redirected to login first. Call only inside <Suspense>.
 */
export async function requireOrgContext(orgSlug: string): Promise<OrgContext> {
  await requireUser(`/${encodeURIComponent(orgSlug)}`);
  const ctx = await getOrgContext(orgSlug);
  if (!ctx) notFound();
  return ctx;
}

/**
 * Authorization check for Server Actions and route handlers. Re-checks `has_permission` in the database on every
 * call (never from the cache), so a revoked role or suspended org fails immediately. `forbidden()` (403) when the
 * permission is missing, the org is suspended, or the check errors (fail closed). Signed-out → login.
 * `orgId` must come from a trusted source (an OrgContext), never from the client.
 */
export async function requirePermission(orgId: string, perm: PermissionKey): Promise<void> {
  await requireUser();
  if (!isPermissionKey(perm)) forbidden();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("has_permission", { org: orgId, perm });
  if (error || data !== true) forbidden();
}

/**
 * Platform admins only (`platform_admins`, via is_platform_admin()); everyone else gets `notFound()` (404) so the
 * admin area is not discoverable. Call only inside a <Suspense> boundary.
 */
export async function requirePlatformAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("is_platform_admin");
  if (error || data !== true) notFound();
  return user;
}

/** Whether the org's plan includes a feature flag (e.g. 'qr_ordering'). False when there is no plan. */
export function hasFeature(ctx: OrgContext, key: string): boolean {
  return ctx.package?.features.includes(key) ?? false;
}
