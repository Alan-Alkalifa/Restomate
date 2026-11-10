import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "@/app/globals.css";
import { PostHogProvider } from "@/lib/posthog/client";
import type { Locale } from "@/i18n/config";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const defaultMetadata: Metadata = {
  title: "Restomate",
  description: "Restaurant management, POS and ordering in one dashboard.",
};

/**
 * The one <html>/<body> for the whole app. There is no app/layout.tsx: every top-level route group has a thin root
 * layout that renders this with its own `lang`, because Next only takes <html lang> from a root layout and the
 * language differs per tree (id for the unprefixed public pages, en for /en and for surfaces not translated yet).
 */
export function RootDocument({ lang, children }: { lang: Locale; children: React.ReactNode }) {
  return (
    <html lang={lang} className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <PostHogProvider>{children}</PostHogProvider>
      </body>
    </html>
  );
}
