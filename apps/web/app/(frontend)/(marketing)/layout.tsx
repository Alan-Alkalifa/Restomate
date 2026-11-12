import { MarketingShell } from "@/components/marketing/pages";

// Static shell: no session, cookies or headers are read here.
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <MarketingShell locale="id">{children}</MarketingShell>;
}
