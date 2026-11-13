import Link from "next/link";
import { fmt, localePath, type Locale } from "@/i18n/config";
import type { MarketingDictionary } from "@/i18n/types";
import type { PublicPackage } from "./types";

type Props = {
  packages: PublicPackage[];
  /** MF-T09 `formatMoney`, injected so this component stays presentational. */
  formatMoney: (amount: number, currency: string, locale?: string) => string;
  t: MarketingDictionary["pricing"];
  locale: Locale;
  /** Read on the server (never a client flag). When false no signup link is rendered at all. */
  signupEnabled: boolean;
};

const humanize = (key: string) =>
  key.replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase());

// Plan names, descriptions, limit and feature keys come from the database (packages) and are not translated here.
export function PricingGrid({ packages, formatMoney, t, locale, signupEnabled }: Props) {
  // Known keys (packages contract LIMIT_KEYS / FEATURE_KEYS) are translated; an unknown key falls back to humanize().
  // Plural-aware: "1 location" / "2 locations" in English via Intl.PluralRules; Bahasa has no plural form (same word).
  const plural = new Intl.PluralRules(locale);
  const limitLabel = (k: string, n: number | null) => {
    const forms = (n !== null && plural.select(n) === "one" ? t.limitsOne : t.limits) as Record<string, string>;
    return forms[k] ?? humanize(k).toLowerCase();
  };
  const featureLabel = (f: string) => (t.features as Record<string, string>)[f] ?? humanize(f);
  const numberLocale = locale === "id" ? "id-ID" : "en-US";
  if (packages.length === 0) {
    return (
      <p role="status" className="rounded-lg border border-dashed border-neutral-400 p-6 text-center">
        {t.unavailable}
      </p>
    );
  }
  return (
    <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {packages.map((p) => (
        <li key={p.code} className="flex flex-col gap-4 rounded-xl border border-neutral-300 p-6 dark:border-neutral-700">
          <h2 className="text-lg font-semibold">{p.name}</h2>
          {p.description && <p className="text-sm text-neutral-600 dark:text-neutral-400">{p.description}</p>}
          <p>
            <span className="text-3xl font-semibold">{formatMoney(p.priceMonthly, p.currency, numberLocale)}</span>
            <span className="text-sm text-neutral-600 dark:text-neutral-400"> {t.perMonth}</span>
          </p>
          {p.priceYearly > 0 && (
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              {fmt(t.orYearly, { price: formatMoney(p.priceYearly, p.currency, numberLocale) })}
            </p>
          )}
          {p.trialDays > 0 && <p className="text-sm font-medium">{fmt(t.trial, { days: p.trialDays })}</p>}
          <ul className="flex flex-col gap-1 text-sm">
            {Object.entries(p.limits).map(([k, v]) => (
              <li key={k}>
                {v === null ? t.unlimited : v} {limitLabel(k, v)}
              </li>
            ))}
            {p.features.map((f) => (
              <li key={f}>✓ {featureLabel(f)}</li>
            ))}
          </ul>
          {signupEnabled ? (
            <Link
              href={localePath(locale, "/signup")}
              className="mt-auto flex min-h-12 items-center justify-center rounded-lg bg-teal-700 px-4 font-semibold text-white hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
            >
              {t.cta}
            </Link>
          ) : (
            <p className="mt-auto flex min-h-12 items-center justify-center rounded-lg border border-neutral-300 px-4 text-sm font-medium text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
              {t.signupClosed}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
