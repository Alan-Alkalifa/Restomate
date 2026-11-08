/**
 * TEMPORARY SEAM until MF-T07 (lib/auth DAL) merges. Replace with:
 *   export { requireOrgContext, requirePermission, hasFeature } from "@/lib/auth";
 * and `getCurrentUser` from lib/auth/dal. Until then every org is "not found" (nothing leaks).
 */
import { notFound } from "next/navigation";
import type { CurrentUser, OrgContext, PermissionKey } from "@/components/dashboard/types";

export async function requireOrgContext(orgSlug: string): Promise<OrgContext> {
  void orgSlug;
  notFound();
}

export async function requirePermission(orgId: string, perm: PermissionKey): Promise<void> {
  void orgId;
  void perm;
  throw new Error("requirePermission is not wired yet");
}

export function hasFeature(ctx: OrgContext, key: string): boolean {
  return ctx.package?.features.includes(key) ?? false;
}

export async function getCurrentUser(): Promise<CurrentUser> {
  return null;
}
