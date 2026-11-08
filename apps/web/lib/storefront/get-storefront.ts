import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";
import { createAnonClient } from "@/lib/supabase/anon";

export type StorefrontBranding = {
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  font: string | null;
  theme: Record<string, unknown>;
};

export type StorefrontLocation = {
  name: string;
  address: string | null;
  city: string | null;
  phone: string | null;
  timezone: string;
};

export type Storefront =
  | { status: "active"; name: string; slug: string; branding: StorefrontBranding; locations: StorefrontLocation[] }
  | { status: "unavailable" };

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const rpcSchema = z.union([
  z.null(),
  z.object({ status: z.literal("unavailable") }),
  z.object({
    status: z.literal("active"),
    name: z.string(),
    slug: z.string(),
    branding: z
      .object({
        logo_url: z.string().nullish(),
        primary_color: z.string().nullish(),
        secondary_color: z.string().nullish(),
        font: z.string().nullish(),
        theme: z.record(z.string(), z.unknown()).nullish(),
      })
      .default({}),
    locations: z.array(
      z.object({
        name: z.string(),
        address: z.string().nullish(),
        city: z.string().nullish(),
        phone: z.string().nullish(),
        timezone: z.string(),
      }),
    ),
  }),
]);

/** Validate the get_storefront RPC output and map to camelCase. Throws on malformed output. */
export function parseStorefront(raw: unknown): Storefront | null {
  const r = rpcSchema.parse(raw);
  if (r === null) return null;
  if (r.status === "unavailable") return { status: "unavailable" };
  return {
    status: "active",
    name: r.name,
    slug: r.slug,
    branding: {
      // Only https logos are ever rendered.
      logoUrl: r.branding.logo_url && /^https:\/\//.test(r.branding.logo_url) ? r.branding.logo_url : null,
      primaryColor: r.branding.primary_color ?? null,
      secondaryColor: r.branding.secondary_color ?? null,
      font: r.branding.font ?? null,
      theme: r.branding.theme ?? {},
    },
    locations: r.locations.map((l) => ({
      name: l.name,
      address: l.address ?? null,
      city: l.city ?? null,
      phone: l.phone ?? null,
      timezone: l.timezone,
    })),
  };
}

/** `null` = unknown slug. Refresh with `updateTag('storefront:{slug}')` on branding/status changes. */
export async function getStorefront(slugInput: string): Promise<Storefront | null> {
  const slug = slugInput.trim().toLowerCase();
  if (!SLUG.test(slug)) return null; // also keeps cache tags to a safe charset
  return fetchStorefront(slug);
}

async function fetchStorefront(slug: string): Promise<Storefront | null> {
  "use cache";
  cacheTag(`storefront:${slug}`);
  cacheLife("minutes"); // short, so a suspension cannot be served stale for long

  const { data, error } = await createAnonClient().rpc("get_storefront", { slug });
  if (error) throw new Error(`getStorefront failed: ${error.message}`);
  return parseStorefront(data);
}
