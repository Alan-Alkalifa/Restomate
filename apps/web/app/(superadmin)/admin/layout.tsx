import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requirePlatformAdmin } from "../_data";

export const metadata: Metadata = {
  title: "Platform admin · Restomate",
  robots: { index: false, follow: false },
};

const NAV = [
  { href: "/admin/tenants", label: "Tenants" },
  { href: "/admin/packages", label: "Packages" },
  { href: "/admin/billing", label: "Billing" },
  { href: "/admin/settings", label: "Settings" },
];

// The guard runs inside Suspense (Next 16): 404 for everyone who isn't a platform admin.
async function Guard({ children }: { children: React.ReactNode }) {
  await requirePlatformAdmin();
  return <>{children}</>;
}

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-indigo-900 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-2">
          <p className="font-semibold">Restomate platform admin</p>
          <nav aria-label="Admin" className="flex flex-wrap gap-1 text-sm">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="flex min-h-12 items-center rounded-lg px-3 hover:bg-indigo-800">{n.label}</Link>
            ))}
          </nav>
        </div>
      </header>
      <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Suspense fallback={<div role="status" aria-label="Loading" className="h-64 animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-800" />}>
          <Guard>{children}</Guard>
        </Suspense>
      </div>
    </div>
  );
}
