import Link from "next/link";
import { localePath, type Locale } from "@/i18n/config";
import type { MarketingDictionary } from "@/i18n/types";
import { getDemoUrl } from "./demo-url";

const link = "rounded underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700";

export function MarketingFooter({ t, locale }: { t: MarketingDictionary; locale: Locale }) {
  const { footer, nav, brand } = t;
  return (
    <footer className="border-t border-neutral-200 px-4 py-8 text-sm text-neutral-700 dark:border-neutral-800 dark:text-neutral-300">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 sm:flex-row sm:justify-between">
        <div className="max-w-xs">
          <p className="font-semibold text-teal-800 dark:text-teal-300">{brand}</p>
          <p className="mt-1">{footer.tagline}</p>
        </div>
        <nav aria-label={footer.ariaLabel} className="flex gap-10">
          <div>
            <h2 className="font-semibold">{footer.productHeading}</h2>
            <ul className="mt-2 flex flex-col gap-2">
              <li><Link href={localePath(locale, "/features")} className={link}>{nav.features}</Link></li>
              <li><Link href={localePath(locale, "/pricing")} className={link}>{nav.pricing}</Link></li>
              <li><Link href={getDemoUrl()} className={link}>{nav.demo}</Link></li>
            </ul>
          </div>
          <div>
            <h2 className="font-semibold">{footer.accountHeading}</h2>
            <ul className="mt-2 flex flex-col gap-2">
              <li><Link href={localePath(locale, "/login")} className={link}>{nav.login}</Link></li>
              <li><Link href={localePath(locale, "/signup")} className={link}>{nav.signup}</Link></li>
            </ul>
          </div>
        </nav>
      </div>
      <p className="mx-auto mt-6 max-w-5xl">© {footer.copyright}</p>
    </footer>
  );
}
