import { AuthFrame } from "@/components/auth/AuthFrame";
import { en } from "@/i18n/en";

export default function EnglishAuthLayout({ children }: { children: React.ReactNode }) {
  return <AuthFrame brand={en.auth.brand}>{children}</AuthFrame>;
}
