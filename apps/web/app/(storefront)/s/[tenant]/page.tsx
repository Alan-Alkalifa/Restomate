import { notFound } from "next/navigation";
import { Suspense } from "react";
import { StorefrontHome, StorefrontUnavailable } from "@/components/storefront/StorefrontHome";
import { brandingToCssVars, getStorefront } from "../_data";

async function StorefrontContent({ params }: { params: PageProps<"/s/[tenant]">["params"] }) {
  const { tenant } = await params;
  const storefront = await getStorefront(tenant);
  if (!storefront) notFound();
  if (storefront.status === "unavailable") return <StorefrontUnavailable />;
  return <StorefrontHome data={storefront} cssVars={brandingToCssVars(storefront.branding)} />;
}

export default function StorefrontPage({ params }: PageProps<"/s/[tenant]">) {
  return (
    <Suspense fallback={<div role="status" aria-label="Loading" className="min-h-screen animate-pulse bg-neutral-100 dark:bg-neutral-900" />}>
      <StorefrontContent params={params} />
    </Suspense>
  );
}
