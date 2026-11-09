import { getPublicPlatformFlags } from "@/lib/public/platform-flags";
import { PlatformBanner } from "./PlatformBanner";

/** Async server component: render it inside <Suspense fallback={null}> in a layout. Renders nothing when there is no banner. */
export async function PlatformBannerSlot() {
  const { maintenanceBanner } = await getPublicPlatformFlags();
  return <PlatformBanner banner={maintenanceBanner} />;
}
