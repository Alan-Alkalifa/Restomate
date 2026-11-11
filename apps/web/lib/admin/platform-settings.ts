import "server-only";

import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { ownedOrgCapSchema, signupSchema, taxPresetsSchema, type PlatformSettings } from "./platform-settings-schemas";

const rowSchema = z.object({
  signup: signupSchema,
  maintenance_banner: z.object({ enabled: z.boolean(), message: z.string(), level: z.enum(["info", "warning"]) }),
  tax_presets: taxPresetsSchema,
  owned_org_cap: ownedOrgCapSchema,
});

export function mapPlatformSettings(data: unknown): PlatformSettings {
  const r = rowSchema.parse(data);
  return { signup: r.signup, maintenanceBanner: r.maintenance_banner, taxPresets: r.tax_presets, ownedOrgCap: r.owned_org_cap };
}

/** All typed settings with defaults filled in. Platform admins only (404 otherwise). Not cached. Call inside <Suspense>. */
export async function getPlatformSettings(): Promise<PlatformSettings> {
  await requirePlatformAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_get_platform_settings");
  if (error) throw new Error(`getPlatformSettings failed: ${error.message}`);
  return mapPlatformSettings(data);
}
