import type { Storefront } from "@/lib/storefront/get-storefront";

export type { Storefront, StorefrontBranding, StorefrontLocation } from "@/lib/storefront/get-storefront";
export type ActiveStorefront = Extract<Storefront, { status: "active" }>;
