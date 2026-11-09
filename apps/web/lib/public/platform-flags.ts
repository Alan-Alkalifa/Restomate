import "server-only";
// TEMPORARY SEAM (MSS-T09): stands in for MSS-T08. Signup open, no banner. Replaced by the real module.
import type { MaintenanceBanner } from "@/lib/admin/platform-settings-schemas";

export type PublicPlatformFlags = { signupEnabled: boolean; maintenanceBanner: MaintenanceBanner | null };

export async function getPublicPlatformFlags(): Promise<PublicPlatformFlags> {
  return { signupEnabled: true, maintenanceBanner: null };
}
export async function isSignupEnabled(): Promise<boolean> {
  return true;
}
