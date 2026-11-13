import { RootDocument, defaultMetadata } from "@/components/ui/RootDocument";

// Root layout of everything under /en (English). The unprefixed tree is Bahasa Indonesia.
// Same metadata (including metadataBase) as every other tree: see defaultMetadata.
export const metadata = defaultMetadata;

export default function EnglishRootLayout({ children }: { children: React.ReactNode }) {
  return <RootDocument lang="en">{children}</RootDocument>;
}
