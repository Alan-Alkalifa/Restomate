/** Seam for the super admin pages: re-exports the real DAL and lib/admin. */
export { requirePlatformAdmin } from "@/lib/auth/dal";
export { listTenants } from "@/lib/admin/tenants";
export { setOrgStatus } from "@/lib/admin/actions";
