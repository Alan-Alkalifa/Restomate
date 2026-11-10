import "server-only";

import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { FEATURE_KEYS, LIMIT_KEYS, type FeatureKey, type LimitKey } from "./package-schemas";

export type AdminPackage = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  currency: string;
  priceMonthly: number;
  priceYearly: number;
  trialDays: number;
  limits: Record<LimitKey, number | null>;
  features: FeatureKey[];
  isActive: boolean;
  isPublic: boolean;
  isDefault: boolean;
  sortOrder: number;
  subscriptionCount: number;
  createdAt: string;
  updatedAt: string;
};

// bigint columns may arrive as numbers or numeric strings.
const int = z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v), z.number().int().nonnegative());

const rowSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  currency: z.string(),
  price_monthly: int,
  price_yearly: int,
  trial_days: int,
  limits: z.record(z.string(), z.number().nullable()),
  features: z.array(z.string()),
  is_active: z.boolean(),
  is_public: z.boolean(),
  is_default: z.boolean(),
  sort_order: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
  subscriptions: z.array(z.object({ count: z.number() })).default([]),
});

const featureSet: ReadonlySet<string> = new Set(FEATURE_KEYS);

export function mapAdminPackages(rows: unknown): AdminPackage[] {
  return z
    .array(rowSchema)
    .parse(rows)
    .map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      description: r.description,
      currency: r.currency,
      priceMonthly: r.price_monthly,
      priceYearly: r.price_yearly,
      trialDays: r.trial_days,
      // every known key present; missing = unlimited
      limits: Object.fromEntries(LIMIT_KEYS.map((k) => [k, r.limits[k] ?? null])) as Record<LimitKey, number | null>,
      features: r.features.filter((f): f is FeatureKey => featureSet.has(f)),
      isActive: r.is_active,
      isPublic: r.is_public,
      isDefault: r.is_default,
      sortOrder: r.sort_order,
      subscriptionCount: r.subscriptions[0]?.count ?? 0,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.priceMonthly - b.priceMonthly);
}

/** All packages, including archived and hidden ones, with their subscription counts. Platform admins only. */
export async function listPackagesForAdmin(): Promise<AdminPackage[]> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("packages")
    .select(
      "id,code,name,description,currency,price_monthly,price_yearly,trial_days,limits,features,is_active,is_public,is_default,sort_order,created_at,updated_at,subscriptions(count)",
    );
  if (error) throw new Error(`listPackagesForAdmin failed: ${error.message}`);
  return mapAdminPackages(data);
}
