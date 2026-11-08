/**
 * TEMPORARY SEAM until MF-T07 (requirePlatformAdmin) and MF-T22 (listTenants, setOrgStatus) merge.
 * Replace with re-exports from lib/auth and lib/admin. Until then every visitor gets a 404.
 */
import { notFound } from "next/navigation";
import type { ActionResult } from "@/components/auth/types";
import type { ListTenantsInput, ListTenantsResult } from "@/components/admin/types";

export async function requirePlatformAdmin(): Promise<void> {
  notFound();
}

export async function listTenants(input: ListTenantsInput): Promise<ListTenantsResult> {
  void input;
  return { rows: [], total: 0 };
}

/** FormData: orgId, status ('active'|'suspended'), reason. */
export async function setOrgStatus(prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  void prev;
  void formData;
  return { ok: false, formError: "Not available yet." };
}
