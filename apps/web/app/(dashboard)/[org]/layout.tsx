import { Suspense } from "react";
import { signOut } from "@/app/(auth)/_actions";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { LocationSwitcher } from "@/components/dashboard/LocationSwitcher";
import { SuspendedNotice } from "@/components/dashboard/notices";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { resolveNav } from "@/components/dashboard/nav";
import { getCurrentUser, requireOrgContext } from "../_data";

async function UserEmail() {
  const user = await getCurrentUser();
  return user ? <span className="hidden text-sm sm:inline">{user.email}</span> : null;
}

// Params/session are only awaited inside this Suspense-wrapped child (Next 16 rule).
async function Shell({ params, children }: { params: LayoutProps<"/[org]">["params"]; children: React.ReactNode }) {
  const { org } = await params;
  const ctx = await requireOrgContext(org); // notFound() for non-members, identical to a missing org
  if (ctx.org.status === "suspended") return <SuspendedNotice />; // no nav, no data
  const items = resolveNav(ctx);
  const firstLocationItem = items.find((i) => i.scope === "location" && !i.locked)?.key ?? null;
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-neutral-200 md:w-64 md:border-r md:border-b-0 dark:border-neutral-800">
        <p className="px-6 pt-4 text-lg font-semibold text-teal-700 dark:text-teal-400">Restomate</p>
        <Sidebar items={items} orgSlug={ctx.org.slug} locationIds={ctx.locations.map((l) => l.id)} />
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
          <p className="font-semibold break-words">{ctx.org.name}</p>
          <div className="flex items-center gap-3">
            <LocationSwitcher orgSlug={ctx.org.slug} locations={ctx.locations} defaultSection={firstLocationItem} />
            <Suspense fallback={null}>
              <UserEmail />
            </Suspense>
            <SignOutButton action={signOut} />
          </div>
        </header>
        <div className="flex-1 p-4 md:p-6">{children}</div>
      </div>
    </div>
  );
}

export default function OrgLayout({ params, children }: LayoutProps<"/[org]">) {
  return (
    <Suspense fallback={<div role="status" aria-label="Loading" className="min-h-screen animate-pulse bg-neutral-100 dark:bg-neutral-900" />}>
      <Shell params={params}>{children}</Shell>
    </Suspense>
  );
}
