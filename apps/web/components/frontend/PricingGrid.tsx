import Link from "next/link";
import type { PublicPackage } from "./types";

type Props = {
  packages: PublicPackage[];
  /** MF-T09 `formatMoney`, injected so this component stays presentational. */
  formatMoney: (amount: number, currency: string, locale?: string) => string;
};

const humanize = (key: string) =>
  key.replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase());

export function PricingGrid({ packages, formatMoney }: Props) {
  if (packages.length === 0) {
    return (
      <p role="status" className="rounded-lg border border-dashed border-neutral-400 p-6 text-center">
        Pricing is not available right now. Please check back soon.
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
            <span className="text-3xl font-semibold">{formatMoney(p.priceMonthly, p.currency)}</span>
            <span className="text-sm text-neutral-600 dark:text-neutral-400"> / month</span>
          </p>
          {p.priceYearly > 0 && (
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              or {formatMoney(p.priceYearly, p.currency)} / year
            </p>
          )}
          {p.trialDays > 0 && <p className="text-sm font-medium">{p.trialDays}-day free trial</p>}
          <ul className="flex flex-col gap-1 text-sm">
            {Object.entries(p.limits).map(([k, v]) => (
              <li key={k}>
                {v === null ? "Unlimited" : v} {humanize(k).toLowerCase()}
              </li>
            ))}
            {p.features.map((f) => (
              <li key={f}>✓ {humanize(f)}</li>
            ))}
          </ul>
          <Link
            href="/signup"
            className="mt-auto flex min-h-12 items-center justify-center rounded-lg bg-teal-700 px-4 font-semibold text-white hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
          >
            Start free trial
          </Link>
        </li>
      ))}
    </ul>
  );
}
