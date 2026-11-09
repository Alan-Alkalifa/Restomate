import Link from "next/link";
import { requirePlatformAdmin } from "@/app/(superadmin)/_data";

export const ADMIN_NAV = [
  { href: "/admin/tenants", label: "Tenants" },
  { href: "/admin/packages", label: "Packages" },
  { href: "/admin/billing", label: "Billing" },
  { href: "/admin/settings", label: "Settings" },
];

/**
 * The whole platform-admin chrome. It renders ONLY after requirePlatformAdmin() has resolved (the guard 404s everyone
 * else), so nothing admin-specific (name, nav labels, aria-label) is ever sent to a non-admin. Keep it that way:
 * anything added to the admin layout belongs in here, after the guard.
 */
export async function AdminShell({ children }: { children: React.ReactNode }) {
  await requirePlatformAdmin();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-indigo-900 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-2">
          <p className="font-semibold">Restomate platform admin</p>
          <nav aria-label="Admin" className="flex flex-wrap gap-1 text-sm">
            {ADMIN_NAV.map((n) => (
              <Link key={n.href} href={n.href} className="flex min-h-12 items-center rounded-lg px-3 hover:bg-indigo-800">{n.label}</Link>
            ))}
          </nav>
        </div>
      </header>
      <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</div>
    </div>
  );
}

/** Neutral while the guard resolves: no admin text, labels or colours that identify the surface. */
export function AdminShellFallback() {
  return (
    <div role="status" aria-label="Loading" className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="h-64 animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-800" />
    </div>
  );
}
