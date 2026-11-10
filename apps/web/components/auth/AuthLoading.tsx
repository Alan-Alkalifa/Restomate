import type { Locale } from "@/i18n/config";
import { en } from "@/i18n/en";
import { id } from "@/i18n/id";

export function AuthLoading({ locale }: { locale: Locale }) {
  const t = (locale === "en" ? en : id).auth;
  return (
    <div role="status" aria-label={t.loading} className="flex flex-col gap-4">
      <div className="h-8 w-40 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
      <div className="h-12 animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-800" />
      <div className="h-12 animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-800" />
    </div>
  );
}
