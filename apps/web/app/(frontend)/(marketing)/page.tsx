import type { Metadata } from "next";
import Link from "next/link";
import { CtaButtons } from "@/components/marketing/CtaButtons";
import { ModuleCard } from "@/components/marketing/ModuleCard";
import { content } from "../_content/en";

const { home, modules, cta } = content;

export const metadata: Metadata = {
  title: home.metaTitle,
  description: home.metaDescription,
  openGraph: { title: home.metaTitle, description: home.metaDescription, type: "website", siteName: content.brand },
  twitter: { card: "summary", title: home.metaTitle, description: home.metaDescription },
};

export default function HomePage() {
  return (
    <main className="flex flex-col gap-14">
      <section aria-labelledby="hero" className="flex flex-col items-start gap-6 py-6">
        <h1 id="hero" className="max-w-2xl text-4xl font-semibold tracking-tight">{home.heroTitle}</h1>
        <p className="max-w-xl text-lg text-neutral-700 dark:text-neutral-300">{home.heroBody}</p>
        <CtaButtons cta={cta} />
      </section>

      <section aria-labelledby="modules" className="flex flex-col gap-5">
        <div>
          <h2 id="modules" className="text-2xl font-semibold tracking-tight">{home.modulesHeading}</h2>
          <p className="mt-1 text-neutral-700 dark:text-neutral-300">{home.modulesIntro}</p>
        </div>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {modules.map((m) => <ModuleCard key={m.key} module={m} />)}
        </ul>
        <Link href="/features" className="w-fit font-semibold text-teal-800 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 dark:text-teal-300">
          {cta.seeFeatures}
        </Link>
      </section>

      <section aria-labelledby="closing" className="flex flex-col items-start gap-4 rounded-xl bg-neutral-100 p-6 dark:bg-neutral-900">
        <h2 id="closing" className="text-2xl font-semibold tracking-tight">{home.closingTitle}</h2>
        <p className="text-neutral-700 dark:text-neutral-300">{home.closingBody}</p>
        <CtaButtons cta={cta} />
        <Link href="/pricing" className="font-semibold text-teal-800 underline underline-offset-4 dark:text-teal-300">{cta.seePricing}</Link>
      </section>
    </main>
  );
}
