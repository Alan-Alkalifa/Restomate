import type { Metadata } from "next";
import { AuthFrame } from "@/components/auth/AuthFrame";
import { en } from "@/i18n/en";

export default function EnglishAuthLayout({ children }: { children: React.ReactNode }) {
  return <AuthFrame brand={en.auth.brand}>{children}</AuthFrame>;
}

// English auth pages are not indexed (the /en root layout is shared with the public marketing pages).
export const metadata: Metadata = { robots: { index: false } };
