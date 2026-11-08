import type { Metadata } from "next";
import { Suspense } from "react";
import { PricingGrid } from "@/components/frontend/PricingGrid";
import { formatMoney, getPublicPackages } from "../_data";

export const metadata: Metadata = {
  title: "Pricing · Restomate",
  description: "Simple plans for every restaurant. Start with a free trial.",
};

async function Packages() {
  const packages = await getPublicPackages();
  return <PricingGrid packages={packages} formatMoney={formatMoney} />;
}

export default function PricingPage() {
  return (
    <main className="flex flex-col gap-8">
      <h1 className="text-3xl font-semibold tracking-tight">Pricing</h1>
      <Suspense fallback={<div role="status" aria-label="Loading plans" className="h-64 animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-800" />}>
        <Packages />
      </Suspense>
    </main>
  );
}
