"use client";

import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n/config";
import { en } from "@/i18n/en";
import { id } from "@/i18n/id";

/** Error boundary body for the auth trees. Each tree's error.tsx passes its own locale (boundaries get no params). */
export function AuthError({ locale, retry }: { locale: Locale; retry: () => void }) {
  const t = (locale === "en" ? en : id).auth.error;
  return (
    <div role="alert" className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t.heading}</h1>
      <p className="text-sm">{t.body}</p>
      <Button type="button" onClick={() => retry()}>{t.retry}</Button>
    </div>
  );
}
