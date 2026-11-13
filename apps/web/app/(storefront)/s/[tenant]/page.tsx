import { Suspense } from "react";
import { StorefrontPage, storefrontMetadata } from "@/components/storefront/pages";
import { StorefrontSkeleton } from "@/components/storefront/StorefrontSkeleton";

export const generateMetadata = ({ params }: PageProps<"/s/[tenant]">) => storefrontMetadata("id", params);

export default function Page({ params, searchParams }: PageProps<"/s/[tenant]">) {
  return (
    <Suspense fallback={<StorefrontSkeleton />}>
      <StorefrontPage locale="id" params={params} searchParams={searchParams} />
    </Suspense>
  );
}
