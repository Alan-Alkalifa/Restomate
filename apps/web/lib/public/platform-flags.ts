import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";
import type { MaintenanceBanner } from "@/lib/admin/platform-settings-schemas";
import { createAnonClient } from "@/lib/supabase/anon";

export type PublicPlatformFlags = { signupEnabled: boolean; maintenanceBanner: MaintenanceBanner | null };

const FALLBACK: PublicPlatformFlags = { signupEnabled: true, maintenanceBanner: null };

const flagsSchema = z.object({
  signupEnabled: z.boolean(),
  maintenanceBanner: z.object({ enabled: z.boolean(), message: z.string(), level: z.enum(["info", "warning"]) }).nullable(),
});

export function mapPublicFlags(data: unknown): PublicPlatformFlags {
  return flagsSchema.parse(data);
}

async function fetchFlags(): Promise<PublicPlatformFlags> {
  const { data, error } = await createAnonClient().rpc("get_public_platform_flags");
  if (error) throw new Error(`get_public_platform_flags failed: ${error.message}`);
  return mapPublicFlags(data);
}

// Cached inner function: it THROWS on failure (thrown results are not cached), so a fallback is never cached.
async function getCachedFlags(): Promise<PublicPlatformFlags> {
  "use cache";
  cacheTag("platform-flags");
  cacheLife("minutes");
  return fetchFlags();
}

/** For display only (banner, hiding the signup link). Refreshed by `updateTag('platform-flags')`. Never blocks the site. */
export async function getPublicPlatformFlags(): Promise<PublicPlatformFlags> {
  try {
    return await getCachedFlags();
  } catch (e) {
    console.error(`[flags] ${e instanceof Error ? e.message : "unknown error"}`);
    return FALLBACK;
  }
}

/**
 * Uncached, for ENFORCEMENT (signUp, createOrganization): a stale cache can never let a signup through.
 * On failure it returns true; the database trigger on organizations still refuses.
 */
export async function isSignupEnabled(): Promise<boolean> {
  try {
    return (await fetchFlags()).signupEnabled;
  } catch (e) {
    console.error(`[flags] ${e instanceof Error ? e.message : "unknown error"}`);
    return true;
  }
}
