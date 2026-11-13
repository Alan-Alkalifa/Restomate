import { Suspense } from "react";
import { PlatformBannerSlot } from "@/components/ui/PlatformBannerSlot";

// Same as the Bahasa tenant layout: no Restomate chrome beyond the platform maintenance banner (only when an admin turns it on).
export default function EnglishTenantLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <PlatformBannerSlot />
      </Suspense>
      {children}
    </>
  );
}
