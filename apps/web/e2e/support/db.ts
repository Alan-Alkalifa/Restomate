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
