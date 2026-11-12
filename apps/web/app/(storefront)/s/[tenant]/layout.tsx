import { Suspense } from "react";
import { PlatformBannerSlot } from "@/components/ui/PlatformBannerSlot";

// No Restomate chrome beyond the platform maintenance banner (it only renders when an admin turns it on).
export default function TenantLayout({ children }: LayoutProps<"/s/[tenant]">) {
  return (
    <>
      <Suspense fallback={null}>
        <PlatformBannerSlot />
      </Suspense>
      {children}
    </>
  );
}
