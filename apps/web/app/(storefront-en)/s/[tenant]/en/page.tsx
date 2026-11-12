import { Suspense } from "react";
import { StorefrontPage, storefrontMetadata } from "@/components/storefront/pages";
import { StorefrontSkeleton } from "@/components/storefront/StorefrontSkeleton";

export const generateMetadata = ({ params }: PageProps<"/s/[tenant]/en">) => storefrontMetadata("en", params);

export default function Page({ params, searchParams }: PageProps<"/s/[tenant]/en">) {
  return (
    <Suspense fallback={<StorefrontSkeleton />}>
      <StorefrontPage locale="en" params={params} searchParams={searchParams} />
    </Suspense>
  );
}
