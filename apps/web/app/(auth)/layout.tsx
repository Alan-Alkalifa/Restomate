import type { Metadata } from "next";
import { AuthFrame } from "@/components/auth/AuthFrame";
import { RootDocument } from "@/components/ui/RootDocument";
import { en } from "@/i18n/en";
import { metadataBase } from "@/i18n/config";

// Root layout of the unprefixed (Bahasa Indonesia) auth tree. /en/... has its own in app/en/.
export const metadata: Metadata = {
  title: "Restomate",
  description: "Restaurant management, POS and ordering in one dashboard.",
  metadataBase: metadataBase(),
  robots: { index: false },
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <RootDocument lang="id">
      <AuthFrame brand={en.auth.brand}>{children}</AuthFrame>
    </RootDocument>
  );
}
