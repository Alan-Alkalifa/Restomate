import type { Metadata } from "next";
import { Suspense } from "react";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { requireUser } from "@/lib/auth/dal";
import { checkSlug, createOrganization } from "@/lib/onboarding/actions";
import { ALLOWED_TIMEZONES, CURRENCIES } from "@/lib/onboarding/schemas";

export const metadata: Metadata = { title: "Set up your restaurant · Restomate", robots: { index: false } };

async function Wizard() {
  await requireUser("/onboarding"); // signed-out users go to /login?next=/onboarding; inside Suspense per Next 16 rules
  return <OnboardingWizard actions={{ checkSlug, createOrganization }} options={{ timezones: ALLOWED_TIMEZONES, currencies: CURRENCIES }} />;
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
