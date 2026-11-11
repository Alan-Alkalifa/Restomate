import { Suspense } from "react";
import { PlatformBannerSlot } from "@/components/ui/PlatformBannerSlot";

/** Brand + centred column shared by the id (unprefixed) and en auth trees. The maintenance banner (if any) sits on top. */
export function AuthFrame({ brand, children }: { brand: string; children: React.ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <PlatformBannerSlot />
      </Suspense>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-10 sm:px-6">
        <p className="text-2xl font-semibold tracking-tight text-teal-700 dark:text-teal-400">{brand}</p>
        {children}
      </main>
    </>
  );
}
