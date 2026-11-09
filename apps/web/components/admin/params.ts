import { ORG_STATUSES, type ListTenantsInput, type OrgStatus } from "./types";

export const PAGE_SIZE = 20;
type Raw = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** URL search params -> validated listTenants input (never trusts the URL). */
export function parseTenantParams(sp: Raw): Required<Pick<ListTenantsInput, "page" | "pageSize">> & ListTenantsInput {
  const q = one(sp.q)?.trim().slice(0, 100) || undefined;
  const s = one(sp.status);
  const status = ORG_STATUSES.includes(s as OrgStatus) ? (s as OrgStatus) : undefined;
  const packageCode = one(sp.plan)?.trim().slice(0, 50) || undefined;
  const n = Number(one(sp.page));
  const page = Number.isSafeInteger(n) && n >= 1 ? n : 1;
  return { q, status, packageCode, page, pageSize: PAGE_SIZE };
}

/** Build a /admin/tenants href keeping the current filters. */
export function tenantsHref(p: { q?: string; status?: string; packageCode?: string }, page: number): string {
  const u = new URLSearchParams();
  if (p.q) u.set("q", p.q);
  if (p.status) u.set("status", p.status);
  if (p.packageCode) u.set("plan", p.packageCode);
  if (page > 1) u.set("page", String(page));
  const qs = u.toString();
  return qs ? `/admin/tenants?${qs}` : "/admin/tenants";
}
