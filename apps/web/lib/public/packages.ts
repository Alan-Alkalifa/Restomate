import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";
import { createAnonClient } from "@/lib/supabase/anon";

export type PublicPackage = {
  code: string;
  name: string;
  description: string | null;
  currency: string;
  priceMonthly: number;
  priceYearly: number;
  trialDays: number;
  limits: Record<string, number | null>;
  features: string[];
  isDefault: boolean;
};

// bigint columns may arrive as numbers or numeric strings.
const int = z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v), z.number().int().nonnegative());

const rowSchema = z.object({
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  currency: z.string(),
  price_monthly: int,
  price_yearly: int,
  trial_days: int,
  limits: z.record(z.string(), z.number().nullable()),
  features: z.array(z.string()),
  is_default: z.boolean(),
  sort_order: z.number().int(),
});

export function mapPackages(rows: unknown): PublicPackage[] {
  return z
    .array(rowSchema)
    .parse(rows)
    .sort((a, b) => a.sort_order - b.sort_order || a.price_monthly - b.price_monthly)
    .map((r) => ({
      code: r.code,
      name: r.name,
      description: r.description,
      currency: r.currency,
      priceMonthly: r.price_monthly,
      priceYearly: r.price_yearly,
      trialDays: r.trial_days,
      limits: r.limits,
      features: r.features,
      isDefault: r.is_default,
    }));
}

/** Active + public packages. Works signed out; refresh with `updateTag('packages')`. */
export async function getPublicPackages(): Promise<PublicPackage[]> {
  "use cache";
  cacheTag("packages");
  cacheLife("hours");

  const { data, error } = await createAnonClient()
    .from("packages")
    .select("code,name,description,currency,price_monthly,price_yearly,trial_days,limits,features,is_default,sort_order")
    .eq("is_active", true)
    .eq("is_public", true)
    .order("sort_order", { ascending: true })
    .order("price_monthly", { ascending: true });
  if (error) throw new Error(`getPublicPackages failed: ${error.message}`); // thrown results are not cached
  return mapPackages(data);
}
