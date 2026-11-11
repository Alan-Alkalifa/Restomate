import { Suspense } from "react";
import { PlatformBannerSlot } from "@/components/ui/PlatformBannerSlot";
import { signOut } from "@/lib/auth/actions";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { DashboardSignOut } from "@/components/dashboard/DashboardSignOut";
import { LocationSwitcher } from "@/components/dashboard/LocationSwitcher";
import { SuspendedNotice } from "@/components/dashboard/notices";
import { Sidebar } from "@/components/dashboard/Sidebar";
import { resolveNav } from "@/components/dashboard/nav";
import { getCurrentUser, requireOrgContext } from "../_data";

async function UserEmail() {
  const user = await getCurrentUser();
  return user ? <span className="hidden max-w-56 truncate text-sm sm:inline" title={user.email}>{user.email}</span> : null;
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
      <aside className="shrink-0 border-b border-neutral-200 md:w-64 md:border-r md:border-b-0 dark:border-neutral-800">
        <p className="px-6 pt-4 text-lg font-semibold text-teal-700 dark:text-teal-400">Restomate</p>
        <Sidebar items={items} orgSlug={ctx.org.slug} locationIds={ctx.locations.map((l) => l.id)} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <DashboardHeader orgName={ctx.org.name}>
          <LocationSwitcher orgSlug={ctx.org.slug} locations={ctx.locations} defaultSection={firstLocationItem} />
          <Suspense fallback={null}>
            <UserEmail />
          </Suspense>
          <DashboardSignOut action={signOut} />
        </DashboardHeader>
        <div className="flex-1 p-4 md:p-6">{children}</div>
      </div>
    </div>
  );
}

export default function OrgLayout({ params, children }: LayoutProps<"/[org]">) {
  return (
    <>
      <Suspense fallback={null}>
        <PlatformBannerSlot />
      </Suspense>
      <Suspense fallback={<div role="status" aria-label="Loading" className="min-h-screen animate-pulse bg-neutral-100 dark:bg-neutral-900" />}>
        <Shell params={params}>{children}</Shell>
      </Suspense>
    </>
  );
}
