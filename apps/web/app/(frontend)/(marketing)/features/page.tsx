import type { Metadata } from "next";
import Link from "next/link";
import { CtaButtons } from "@/components/marketing/CtaButtons";
import { ModuleCard } from "@/components/marketing/ModuleCard";
import { content } from "../../_content/en";

const { features, modules, cta } = content;

export const metadata: Metadata = {
  title: features.metaTitle,
  description: features.metaDescription,
  alternates: { canonical: "/features" },
  openGraph: { title: features.metaTitle, description: features.metaDescription, type: "website", siteName: content.brand },
  twitter: { card: "summary", title: features.metaTitle, description: features.metaDescription },
};

export default function FeaturesPage() {
  return (
    <main className="flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{features.title}</h1>
        <p className="max-w-2xl text-neutral-700 dark:text-neutral-300">{features.intro}</p>
      </header>
      <ul className="grid gap-4 sm:grid-cols-2">
        {modules.map((m) => <ModuleCard key={m.key} module={m} showPoints />)}
      </ul>
      <section aria-labelledby="closing" className="flex flex-col items-start gap-4 rounded-xl bg-neutral-100 p-6 dark:bg-neutral-900">
        <h2 id="closing" className="text-2xl font-semibold tracking-tight">{features.closingTitle}</h2>
        <p className="text-neutral-700 dark:text-neutral-300">{features.closingBody}</p>
        <CtaButtons cta={cta} />
        <Link href="/pricing" className="font-semibold text-teal-800 underline underline-offset-4 dark:text-teal-300">{cta.seePricing}</Link>
      </section>
    </main>
  );
}
