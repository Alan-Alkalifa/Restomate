/**
 * TEMPORARY SEAM until MF-T20 merges. Replace with:
 *   export { getStorefront } from "@/lib/public/storefront";
 *   export { brandingToCssVars } from "@/lib/theme";
 * (adapt to DAVIN's final paths).
 */
import type { Storefront, StorefrontBranding } from "@/components/storefront/types";

export async function getStorefront(slug: string): Promise<Storefront | null> {
  void slug;
  return null;
}

export function brandingToCssVars(branding: StorefrontBranding): Record<string, string> {
  void branding;
  return {};
}
