import type { MaintenanceBanner } from "@/lib/admin/platform-settings-schemas";

const TONE = {
  info: "border-sky-300 bg-sky-50 text-sky-950 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-50",
  warning: "border-amber-400 bg-amber-50 text-amber-950 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-50",
} as const;

/** The message is operator-supplied text. It is only ever rendered as a React text node (escaped), never as HTML. */
export function PlatformBanner({ banner }: { banner: MaintenanceBanner | null }) {
  if (!banner || !banner.enabled || banner.message === "") return null;
  return (
    <div role={banner.level === "warning" ? "alert" : "status"} data-platform-banner={banner.level} className={`border-b px-4 py-2 text-center text-sm ${TONE[banner.level]}`}>
      {banner.message}
    </div>
  );
}
