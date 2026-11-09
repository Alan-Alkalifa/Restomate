import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminShell, AdminShellFallback } from "@/components/admin/AdminShell";

// Neutral on purpose: this metadata is sent before the guard runs, including to people who are not platform admins.
export const metadata: Metadata = {
  title: "Restomate",
  robots: { index: false, follow: false },
};

// Everything admin-specific lives inside AdminShell, which renders only after requirePlatformAdmin() (Next 16: the
// guard runs inside Suspense and 404s everyone else). The layout itself renders nothing but the boundary.
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <Suspense fallback={<AdminShellFallback />}>
      <AdminShell>{children}</AdminShell>
    </Suspense>
  );
}
