import type { StorefrontDictionary } from "@/i18n/types";

/** Neutral screen for a suspended or non-active organization: never says why. Not indexed. */
export function StorefrontUnavailable({ t }: { t: StorefrontDictionary }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <meta name="robots" content="noindex" />
      <h1 className="text-2xl font-semibold">{t.unavailable.heading}</h1>
      <p className="text-sm">{t.unavailable.body}</p>
    </main>
  );
}
