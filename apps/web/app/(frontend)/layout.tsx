import { RootDocument, defaultMetadata } from "@/components/ui/RootDocument";

// Root layout of the (frontend) tree (see RootDocument). It only supplies <html lang>: the marketing header and
// footer live in (marketing)/layout.tsx and the minimal onboarding header in (onboarding)/layout.tsx.
// Marketing is Bahasa Indonesia (the /en tree has its own root layout); onboarding stays English inside it (lang="id").
export const metadata = defaultMetadata;

export default function FrontendRootLayout({ children }: LayoutProps<"/">) {
  return <RootDocument lang="id">{children}</RootDocument>;
}
