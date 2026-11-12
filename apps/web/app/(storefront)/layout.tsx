import { RootDocument, defaultMetadata } from "@/components/ui/RootDocument";

// Root layout of the Bahasa Indonesia storefront (the default language). English lives in app/(storefront-en), its own
// root layout with lang="en", so <html lang> is right on both (same pattern as auth and marketing).
export const metadata = defaultMetadata;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <RootDocument lang="id">{children}</RootDocument>;
}
