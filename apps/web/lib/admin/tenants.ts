import "server-only";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import type { ListTenantsInput, ListTenantsResult } from "./types";

export type { ListTenantsInput, ListTenantsResult, TenantRow, TenantStatus } from "./types";

export const listTenantsSchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["active", "suspended", "past_due", "read_only"]).optional(),
  packageCode: z.string().trim().max(40).optional(),
  page: z.number().int().min(1).max(100_000).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
});

/** Call args for the admin_list_tenants RPC (not yet in the generated Database types; regenerate packages/db). */
export function toRpcArgs(input: ListTenantsInput & { orgId?: string }) {
  const p = listTenantsSchema.parse(input);
  return {
    q: p.q || null,
    status_filter: p.status ?? null,
    package_code: p.packageCode || null,
    page_size: p.pageSize,
    page_offset: (p.page - 1) * p.pageSize,
    org_id: input.orgId ?? null,
  };
}

type RpcClient = { rpc: (fn: string, args: unknown) => PromiseLike<{ data: unknown; error: { message: string } | null }> };

/** Runs the RPC as the signed-in user: the function itself re-checks is_platform_admin(). No service role. */
export async function callAdminListTenants(args: ReturnType<typeof toRpcArgs>): Promise<ListTenantsResult> {
  const supabase = (await createClient()) as unknown as RpcClient;
  const { data, error } = await supabase.rpc("admin_list_tenants", args);
  if (error || !data) throw new Error("Could not load tenants");
  return data as ListTenantsResult;
}

/** Platform admins only (404 otherwise). Call inside <Suspense>. */
export async function listTenants(input: ListTenantsInput): Promise<ListTenantsResult> {
  await requirePlatformAdmin();
  return callAdminListTenants(toRpcArgs(input));
}
