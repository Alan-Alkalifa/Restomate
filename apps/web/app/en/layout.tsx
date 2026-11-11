import type { Metadata } from "next";
import { RootDocument } from "@/components/ui/RootDocument";
import { metadataBase } from "@/i18n/config";

// Root layout of everything under /en (English). The unprefixed tree is Bahasa Indonesia.
export const metadata: Metadata = {
  title: "Restomate",
  description: "Restaurant management, POS and ordering in one dashboard.",
  metadataBase: metadataBase(),
  robots: { index: false },
};

export default function EnglishRootLayout({ children }: { children: React.ReactNode }) {
  return <RootDocument lang="en">{children}</RootDocument>;
}
