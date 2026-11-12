import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { LanguageSwitcher } from "@/components/auth/LanguageSwitcher";
import { PricingGrid } from "@/components/frontend/PricingGrid";
import { alternatesFor, localePath, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import type { ModuleKey } from "@/i18n/types";
import { formatMoney } from "@/lib/money";
import { getPublicPackages } from "@/lib/public/packages";
import { CtaButtons } from "./CtaButtons";
import { MarketingFooter } from "./MarketingFooter";
import { MarketingHeader } from "./MarketingHeader";
import { ModuleCard } from "./ModuleCard";

/**
 * One component per marketing page, shared by the unprefixed (id) and /en route files, so the two trees cannot drift.
 * All pages are static: no session, cookies or headers (pricing reads packages inside Suspense, at request time).
 */
const moduleKeys: ModuleKey[] = ["pos", "kds", "qr", "reservations", "reports"];
const textLink = "font-semibold text-teal-800 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 dark:text-teal-300";
const closingBox = "flex flex-col items-start gap-4 rounded-xl bg-neutral-100 p-6 dark:bg-neutral-900";
const muted = "text-neutral-700 dark:text-neutral-300";

type Page = "home" | "features" | "pricing";
const paths: Record<Page, string> = { home: "/", features: "/features", pricing: "/pricing" };

export async function marketingMetadata(locale: Locale, page: Page): Promise<Metadata> {
  const t = (await getDictionary(locale)).marketing;
  const m = t[page === "home" ? "home" : page];
  return {
    title: m.metaTitle,
    description: m.metaDescription,
    alternates: alternatesFor(locale, paths[page]),
    openGraph: { title: m.metaTitle, description: m.metaDescription, type: "website", siteName: t.brand, locale: locale === "id" ? "id_ID" : "en_US" },
    twitter: { card: "summary", title: m.metaTitle, description: m.metaDescription },
  };
}

export async function MarketingShell({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const t = (await getDictionary(locale)).marketing;
  return (
    <>
      <MarketingHeader t={t} locale={locale} />
      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">{children}</div>
      <MarketingFooter t={t} locale={locale} />
    </>
  );
}

export async function HomePage({ locale }: { locale: Locale }) {
  const t = (await getDictionary(locale)).marketing;
  const { home, cta } = t;
  return (
    <main className="flex flex-col gap-14">
      <section aria-labelledby="hero" className="flex flex-col items-start gap-6 py-6">
        <h1 id="hero" className="max-w-2xl text-4xl font-semibold tracking-tight">{home.heroTitle}</h1>
        <p className={`max-w-xl text-lg ${muted}`}>{home.heroBody}</p>
        <CtaButtons cta={cta} locale={locale} />
      </section>

      <section aria-labelledby="modules" className="flex flex-col gap-5">
        <div>
          <h2 id="modules" className="text-2xl font-semibold tracking-tight">{home.modulesHeading}</h2>
          <p className={`mt-1 ${muted}`}>{home.modulesIntro}</p>
        </div>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {moduleKeys.map((k) => <ModuleCard key={k} module={t.modules[k]} />)}
        </ul>
        <Link href={localePath(locale, "/features")} className={`w-fit ${textLink}`}>{cta.seeFeatures}</Link>
      </section>

      <section aria-labelledby="closing" className={closingBox}>
        <h2 id="closing" className="text-2xl font-semibold tracking-tight">{home.closingTitle}</h2>
        <p className={muted}>{home.closingBody}</p>
        <CtaButtons cta={cta} locale={locale} />
        <Link href={localePath(locale, "/pricing")} className={textLink}>{cta.seePricing}</Link>
      </section>
      <LanguageSwitcher locale={locale} path="/" t={t.switcher} />
    </main>
  );
}

export async function FeaturesPage({ locale }: { locale: Locale }) {
  const t = (await getDictionary(locale)).marketing;
  const { features, cta } = t;
  return (
    <main className="flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{features.title}</h1>
        <p className={`max-w-2xl ${muted}`}>{features.intro}</p>
      </header>
      <ul className="grid gap-4 sm:grid-cols-2">
        {moduleKeys.map((k) => <ModuleCard key={k} module={t.modules[k]} showPoints />)}
      </ul>
      <section aria-labelledby="closing" className={closingBox}>
        <h2 id="closing" className="text-2xl font-semibold tracking-tight">{features.closingTitle}</h2>
        <p className={muted}>{features.closingBody}</p>
        <CtaButtons cta={cta} locale={locale} />
        <Link href={localePath(locale, "/pricing")} className={textLink}>{cta.seePricing}</Link>
      </section>
      <LanguageSwitcher locale={locale} path="/features" t={t.switcher} />
    </main>
  );
}

export async function PricingPage({ locale }: { locale: Locale }) {
  const t = (await getDictionary(locale)).marketing;
  return (
    <main className="flex flex-col gap-8">
      <h1 className="text-3xl font-semibold tracking-tight">{t.pricing.title}</h1>
      <Suspense fallback={<div role="status" aria-label={t.pricing.loading} className="h-64 animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-800" />}>
        <Packages locale={locale} />
      </Suspense>
      <LanguageSwitcher locale={locale} path="/pricing" t={t.switcher} />
    </main>
  );
}

async function Packages({ locale }: { locale: Locale }) {
  // Read at request time (cached by getPublicPackages), so `next build` needs no database.
  await connection();
  const [packages, dict] = await Promise.all([getPublicPackages(), getDictionary(locale)]);
  return <PricingGrid packages={packages} formatMoney={formatMoney} t={dict.marketing.pricing} locale={locale} />;
}
