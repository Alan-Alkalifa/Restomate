import "server-only";

import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import type { TenantDetail } from "./tenant-detail-types";

export type { TenantDetail, TenantSubscription, TenantAuditEntry, TenantLimitKey } from "./tenant-detail-types";

const subscription = z.object({
  id: z.string(),
  packageCode: z.string(),
  packageName: z.string(),
  status: z.enum(["trialing", "active", "past_due", "canceled"]),
  billingPeriod: z.enum(["monthly", "yearly"]),
  trialEndsAt: z.string().nullable(),
  currentPeriodEnd: z.string().nullable(),
  canceledAt: z.string().nullable(),
  createdAt: z.string(),
});
// bigint counts may arrive as numbers or numeric strings
const count = z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v), z.number().int().nonnegative());
const usageEntry = z.object({ used: count, limit: count.nullable() });

export const tenantDetailSchema = z.object({
  org: z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    status: z.enum(["active", "suspended", "past_due", "read_only"]),
    createdAt: z.string(),
  }),
  locations: z.array(z.object({ id: z.string(), name: z.string(), timezone: z.string(), currency: z.string(), isActive: z.boolean() })),
  subscription: subscription.nullable(),
  subscriptionHistory: z.array(subscription),
  usage: z.object({
    max_locations: usageEntry,
    max_staff: usageEntry,
    max_tables: usageEntry,
    max_orders_per_month: usageEntry,
  }),
  owners: z.array(z.object({ userId: z.string(), name: z.string().nullable(), email: z.string() })),
  auditTrail: z.array(
    z.object({
      id: z.number(),
      action: z.string(),
      actorName: z.string().nullable(),
      createdAt: z.string(),
      metadata: z.record(z.string(), z.unknown()),
    }),
  ),
});

/**
 * Everything the super admin tenant page shows, in one round trip (admin_get_tenant_detail, which re-checks
 * is_platform_admin()). Platform admins only (404 otherwise). null = not a uuid, or no such organization.
 * Not cached. Call inside <Suspense>.
 */
export async function getTenantDetail(orgId: string): Promise<TenantDetail | null> {
  await requirePlatformAdmin();
  if (!z.uuid().safeParse(orgId).success) return null;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_get_tenant_detail", { org_id: orgId });
  if (error) throw new Error(`getTenantDetail failed: ${error.message}`);
  if (data === null || data === undefined) return null;
  return tenantDetailSchema.parse(data);
}
