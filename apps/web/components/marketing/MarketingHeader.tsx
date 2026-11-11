import Link from "next/link";
import { localePath, type Locale } from "@/i18n/config";
import type { MarketingDictionary } from "@/i18n/types";
import { getDemoUrl } from "./demo-url";
import { SignupGate } from "./SignupGate";

const link =
  "rounded px-1 py-2 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700";

export function MarketingHeader({ t, locale }: { t: MarketingDictionary; locale: Locale }) {
  const { nav, brand } = t;
  return (
    <header className="border-b border-neutral-200 dark:border-neutral-800">
      <nav aria-label={nav.ariaLabel} className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2">
        <Link href={localePath(locale, "/")} className="rounded py-2 text-lg font-semibold text-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 dark:text-teal-300">
          {brand}
        </Link>
        <ul className="flex flex-wrap items-center gap-x-3 text-sm sm:gap-x-4">
          <li><Link href={localePath(locale, "/features")} className={link}>{nav.features}</Link></li>
          <li><Link href={localePath(locale, "/pricing")} className={link}>{nav.pricing}</Link></li>
          <li><Link href={getDemoUrl()} className={link}>{nav.demo}</Link></li>
          <li><Link href={localePath(locale, "/login")} className={link}>{nav.login}</Link></li>
          <SignupGate><li>
            <Link href={localePath(locale, "/signup")} className="flex min-h-10 items-center rounded-lg bg-teal-700 px-3 font-semibold text-white hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700">
              {nav.signup}
            </Link>
          </li></SignupGate>
        </ul>
      </nav>
    </header>
  );
}
