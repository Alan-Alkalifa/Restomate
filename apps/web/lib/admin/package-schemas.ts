import { z } from "zod";
import type { Json } from "@restomate/db";

export const LIMIT_KEYS = ["max_locations", "max_staff", "max_tables", "max_orders_per_month"] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];

export const FEATURE_KEYS = ["qr_ordering", "reservations", "custom_domain", "advanced_reports"] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const CURRENCIES = ["IDR", "USD"] as const;

export const LIMIT_LABELS: Record<LimitKey, string> = {
  max_locations: "Locations",
  max_staff: "Staff",
  max_tables: "Tables",
  max_orders_per_month: "Orders per month",
};

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  qr_ordering: "QR table ordering",
  reservations: "Reservations",
  custom_domain: "Custom domain",
  advanced_reports: "Advanced reports",
};

const LIMIT_MAX = 1_000_000;

/** Digits only: no decimals, signs, separators or exponents. Result is a safe integer in minor units. */
const minorUnits = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^\d{1,15}$/, `${label} must be a whole number in minor units.`)
    .transform(Number)
    .pipe(z.number().int().min(0).max(Number.MAX_SAFE_INTEGER));

const intField = (label: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .regex(/^\d{1,7}$/, `${label} must be a whole number.`)
    .transform(Number)
    .pipe(z.number().int().min(min, `${label} must be at least ${min}.`).max(max, `${label} must be at most ${max}.`));

/** Empty string = unlimited (null). */
const limitField = (label: string) =>
  z
    .string()
    .trim()
    .transform((s) => (s === "" ? null : s))
    .pipe(z.union([z.null(), intField(label, 0, LIMIT_MAX)]));

const boolField = z.enum(["true", "false"]).transform((v) => v === "true");

export const codeSchema = z.string().regex(/^[a-z][a-z0-9_-]{1,39}$/, "Use 2–40 lowercase letters, digits, - or _, starting with a letter.");

const planFields = {
  name: z.string().trim().min(1, "Enter a name.").max(60, "Keep it under 60 characters."),
  description: z
    .string()
    .trim()
    .max(300, "Keep it under 300 characters.")
    .transform((s) => (s === "" ? null : s)),
  currency: z.enum(CURRENCIES),
  priceMonthly: minorUnits("Monthly price"),
  priceYearly: minorUnits("Yearly price"),
  trialDays: intField("Trial days", 0, 365),
  limit_max_locations: limitField("Locations"),
  limit_max_staff: limitField("Staff"),
  limit_max_tables: limitField("Tables"),
  limit_max_orders_per_month: limitField("Orders per month"),
  features: z.array(z.enum(FEATURE_KEYS)).transform((a) => [...new Set(a)]),
  isPublic: boolField,
  sortOrder: intField("Sort order", 0, 9999),
};

export const updatePackageSchema = z.strictObject({ packageId: z.uuid(), ...planFields });
export const packageInputSchema = z.strictObject({ code: codeSchema, ...planFields });
export type PackageInput = z.infer<typeof packageInputSchema>;

/** The shape the RPCs take (snake_case jsonb). */
export function toRpcInput(p: Omit<PackageInput, "code">): { [key: string]: Json | undefined } {
  return {
    name: p.name,
    description: p.description,
    currency: p.currency,
    price_monthly: p.priceMonthly,
    price_yearly: p.priceYearly,
    trial_days: p.trialDays,
    limits: {
      max_locations: p.limit_max_locations,
      max_staff: p.limit_max_staff,
      max_tables: p.limit_max_tables,
      max_orders_per_month: p.limit_max_orders_per_month,
    },
    features: p.features,
    is_public: p.isPublic,
    sort_order: p.sortOrder,
  };
}

/** FormData -> plain object for the schemas. Unknown `limit_*` fields are kept so strictObject rejects them. */
export function planFormToObject(fd: FormData): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const key of new Set(fd.keys())) {
    if (key.startsWith("$ACTION")) continue; // React form-action bookkeeping
    o[key] = key === "features" ? fd.getAll(key) : fd.get(key);
  }
  return o;
}

export const archiveSchema = z.strictObject({ packageId: z.uuid(), archived: boolField });
export const setDefaultSchema = z.strictObject({ packageId: z.uuid() });
