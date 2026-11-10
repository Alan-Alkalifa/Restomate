import { RootDocument, defaultMetadata } from "@/components/ui/RootDocument";

// Root layout of the (frontend) tree (see RootDocument). It only supplies <html lang>: the marketing header and
// footer live in (marketing)/layout.tsx and the minimal onboarding header in (onboarding)/layout.tsx.
// Marketing is not translated yet, so lang stays "en" (MSS-T13 translates it).
export const metadata = defaultMetadata;

export default function FrontendRootLayout({ children }: LayoutProps<"/">) {
  return <RootDocument lang="en">{children}</RootDocument>;
}
