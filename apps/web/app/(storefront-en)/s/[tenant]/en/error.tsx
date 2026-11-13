"use client";

import { en } from "@/i18n/en";

// An error boundary cannot read the locale from the server, but each language tree knows its own.
export default function StorefrontError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = en.storefront.error;
  return (
    <div role="alert" lang="en" className="mx-auto mt-24 max-w-md px-4 text-center">
      <h1 className="text-2xl font-bold">{t.heading}</h1>
      <p className="mt-3">{t.body}</p>
      <button type="button" onClick={reset} className="mt-6 min-h-12 rounded-lg bg-neutral-900 px-8 text-lg font-bold text-white">{t.retry}</button>
    </div>
  );
}
