import { RootDocument, defaultMetadata } from "@/components/ui/RootDocument";

// Root layout of this route group (see RootDocument). Not translated yet: lang stays "en".
// Reads no session or params: the page does that inside its own Suspense. The POS is full-screen, so there is no
// regular chrome here.
export const metadata = defaultMetadata;

export default function PosRootLayout({ children }: { children: React.ReactNode }) {
  return <RootDocument lang="en">{children}</RootDocument>;
}
