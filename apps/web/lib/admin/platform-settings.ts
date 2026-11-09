import "server-only";
// TEMPORARY SEAM (MSS-T09): stands in for MSS-T08. Returns the defaults. Replaced by the real module.
import { DEFAULT_PLATFORM_SETTINGS, type PlatformSettings } from "./platform-settings-schemas";

export async function getPlatformSettings(): Promise<PlatformSettings> {
  return DEFAULT_PLATFORM_SETTINGS;
}
