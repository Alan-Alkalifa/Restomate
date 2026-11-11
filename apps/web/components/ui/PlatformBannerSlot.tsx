import { connection } from "next/server";
import { getPublicPlatformFlags } from "@/lib/public/platform-flags";
import { PlatformBanner } from "./PlatformBanner";

/** Async server component: render it inside <Suspense fallback={null}> in a layout. Renders nothing when there is no banner. */
export async function PlatformBannerSlot() {
  // Request time: a build-time flags failure must never be baked into a prerendered shell as "no banner".
  await connection();
  const { maintenanceBanner } = await getPublicPlatformFlags();
  return <PlatformBanner banner={maintenanceBanner} />;
}
