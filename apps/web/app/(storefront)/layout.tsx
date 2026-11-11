import { RootDocument, defaultMetadata } from "@/components/ui/RootDocument";

// Root layout of this route group (see RootDocument). Not translated yet: lang stays "en".
export const metadata = defaultMetadata;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <RootDocument lang="en">{children}</RootDocument>;
}
