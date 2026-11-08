import type { Metadata } from "next";
import { Suspense } from "react";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { checkSlug, createOrganization, requireUser } from "./_actions";

export const metadata: Metadata = { title: "Set up your restaurant · Restomate", robots: { index: false } };

async function Wizard() {
  await requireUser(); // redirects to /login when signed out; inside Suspense per Next 16 rules
  return <OnboardingWizard actions={{ checkSlug, createOrganization }} />;
}

export default function OnboardingPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">Set up your restaurant</h1>
      <Suspense fallback={<div role="status" aria-label="Loading" className="h-80 animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-800" />}>
        <Wizard />
      </Suspense>
    </main>
  );
}
