"use client";

import { en } from "@/i18n/en";

// The error boundary cannot read the locale from the server, so it shows the English copy (the board itself has both).
export default function KitchenError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = en.kitchen.error;
  return (
    <div role="alert" className="mx-auto mt-24 max-w-md px-4 text-center">
      <h1 className="text-3xl font-extrabold">{t.heading}</h1>
      <p className="mt-3 text-xl">{t.body}</p>
      <button type="button" onClick={reset} className="mt-6 min-h-16 rounded-lg bg-teal-700 px-8 text-2xl font-bold text-white focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-teal-900">
        {t.retry}
      </button>
    </div>
  );
}
