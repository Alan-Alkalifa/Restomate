/**
 * Test-only database reads through PostgREST with the LOCAL service-role key (from `supabase status`; never a real
 * project). Used to assert what the UI cannot show (row counts, bps values, audit rows). Never imported by app code.
 */
const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const key = () => {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set (local Supabase service-role key required for DB assertions)");
  return k;
};

export async function rest<T = Record<string, unknown>>(path: string): Promise<T[]> {
  const res = await fetch(`${url()}/rest/v1/${path}`, { headers: { apikey: key(), authorization: `Bearer ${key()}` } });
  if (!res.ok) throw new Error(`PostgREST ${path} -> ${res.status} ${await res.text()}`);
  return (await res.json()) as T[];
}

export type OrgSnapshot = {
  orgs: { id: string; slug: string; name: string; status: string }[];
  locations: { name: string; tax_rate_bps: number; service_charge_bps: number; currency: string; timezone: string }[];
  members: { user_id: string; status: string; roles: { key: string } | null }[];
  subscriptions: { status: string; packages: { code: string } | null }[];
  branding: { organization_id: string }[];
  audit: { action: string; actor_id: string | null }[];
};

/** Everything created for one organization slug, in one call. */
export async function snapshotBySlug(slug: string): Promise<OrgSnapshot> {
  const orgs = await rest<OrgSnapshot["orgs"][number]>(`organizations?slug=eq.${encodeURIComponent(slug)}&select=id,slug,name,status`);
  const id = orgs[0]?.id;
  if (!id) return { orgs, locations: [], members: [], subscriptions: [], branding: [], audit: [] };
  const q = `organization_id=eq.${id}`;
  const [locations, members, subscriptions, branding, audit] = await Promise.all([
    rest<OrgSnapshot["locations"][number]>(`locations?${q}&select=name,tax_rate_bps,service_charge_bps,currency,timezone`),
    rest<OrgSnapshot["members"][number]>(`organization_members?${q}&select=user_id,status,roles(key)`),
    rest<OrgSnapshot["subscriptions"][number]>(`subscriptions?${q}&select=status,packages(code)`),
    rest<OrgSnapshot["branding"][number]>(`org_branding?${q}&select=organization_id`),
    rest<OrgSnapshot["audit"][number]>(`audit_logs?${q}&action=eq.organization.created&select=action,actor_id`),
  ]);
  return { orgs, locations, members, subscriptions, branding, audit };
}

/** Number of organizations the given user (by email) belongs to. */
export async function orgCountForEmail(email: string): Promise<number> {
  const users = await rest<{ id: string }>(`profiles?email=eq.${encodeURIComponent(email)}&select=id`);
  if (!users[0]) return 0;
  return (await rest(`organization_members?user_id=eq.${users[0].id}&select=id`)).length;
}

export async function slugExists(slug: string): Promise<boolean> {
  return (await rest(`organizations?slug=eq.${encodeURIComponent(slug)}&select=id`)).length > 0;
}

/* ---- additional helpers for staff / isolation specs ---- */

export async function patchRest(path: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${url()}/rest/v1/${path}`, {
    method: "PATCH",
    headers: { apikey: key(), authorization: `Bearer ${key()}`, "content-type": "application/json", prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PostgREST PATCH ${path} -> ${res.status} ${await res.text()}`);
}

export async function orgIdOf(slug: string): Promise<string> {
  const rows = await rest<{ id: string }>(`organizations?slug=eq.${encodeURIComponent(slug)}&select=id`);
  if (!rows[0]) throw new Error(`No organization ${slug}`);
  return rows[0].id;
}

export async function locationsOf(slug: string): Promise<{ id: string; name: string }[]> {
  const org = await orgIdOf(slug);
  return rest(`locations?organization_id=eq.${org}&select=id,name&order=name.asc`);
}

export async function roleIdOf(slug: string, roleKey: string): Promise<string> {
  const org = await orgIdOf(slug);
  const rows = await rest<{ id: string }>(`roles?organization_id=eq.${org}&key=eq.${roleKey}&select=id`);
  if (!rows[0]) throw new Error(`No role ${roleKey} in ${slug}`);
  return rows[0].id;
}

export async function memberOf(slug: string, email: string): Promise<{ id: string; status: string; roleKey: string; allLocations: boolean; locationCount: number } | null> {
  const org = await orgIdOf(slug);
  const prof = await rest<{ id: string }>(`profiles?email=eq.${encodeURIComponent(email)}&select=id`);
  if (!prof[0]) return null;
  const m = await rest<{ id: string; status: string; all_locations: boolean; roles: { key: string } | null }>(
    `organization_members?organization_id=eq.${org}&user_id=eq.${prof[0].id}&select=id,status,all_locations,roles(key)`,
  );
  if (!m[0]) return null;
  const locs = await rest(`location_staff?member_id=eq.${m[0].id}&select=location_id`);
  return { id: m[0].id, status: m[0].status, roleKey: m[0].roles?.key ?? "", allLocations: m[0].all_locations, locationCount: locs.length };
}

export async function memberCount(slug: string): Promise<number> {
  const org = await orgIdOf(slug);
  return (await rest(`organization_members?organization_id=eq.${org}&select=id`)).length;
}

export async function invitationsFor(slug: string, email: string): Promise<{ id: string; accepted_at: string | null; revoked_at: string | null }[]> {
  const org = await orgIdOf(slug);
  return rest(`staff_invitations?organization_id=eq.${org}&email=eq.${encodeURIComponent(email)}&select=id,accepted_at,revoked_at`);
}

export async function auditActions(slug: string): Promise<string[]> {
  const org = await orgIdOf(slug);
  return (await rest<{ action: string }>(`audit_logs?organization_id=eq.${org}&select=action&order=created_at.asc`)).map((r) => r.action);
}

/** Signs a user in against local GoTrue and returns a user JWT, to call PostgREST exactly as that user would. */
export async function userJwt(email: string, password: string): Promise<string> {
  const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anon) throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set");
  const res = await fetch(`${url()}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`GoTrue sign-in ${email} -> ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

/** PostgREST call as a signed-in user (RLS applies). */
export async function asUser(jwt: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; json: unknown }> {
  const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const res = await fetch(`${url()}/rest/v1/${path}`, {
    method: init.method ?? "GET",
    headers: { apikey: anon, authorization: `Bearer ${jwt}`, "content-type": "application/json", prefer: "return=representation" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

/** Test cleanup: pending invitations count toward the plan's max_staff, so tests remove the ones they created. */
export async function deleteInvitations(emails: string[]): Promise<void> {
  for (const email of emails) {
    const res = await fetch(`${url()}/rest/v1/staff_invitations?email=eq.${encodeURIComponent(email)}&accepted_at=is.null`, {
      method: "DELETE",
      headers: { apikey: key(), authorization: `Bearer ${key()}`, prefer: "return=minimal" },
    });
    if (!res.ok) throw new Error(`cleanup of invitations for ${email} -> ${res.status}`);
  }
}
