import { RootDocument, defaultMetadata } from "@/components/ui/RootDocument";

// Root layout of the English storefront, reached at {tenant host}/en (the proxy rewrites it to /s/{slug}/en: no proxy
// change is needed because tenantPath keeps the rest of the path).
export const metadata = defaultMetadata;

export default function EnglishStorefrontRootLayout({ children }: { children: React.ReactNode }) {
  return <RootDocument lang="en">{children}</RootDocument>;
}
