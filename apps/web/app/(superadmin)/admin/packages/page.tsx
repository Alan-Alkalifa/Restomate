import Link from "next/link";
import { Suspense } from "react";
import { PackagesList } from "@/components/admin/PackagesList";
import { archivePackage, setDefaultPackage } from "@/lib/admin/package-actions";
import { listPackagesForAdmin } from "@/lib/admin/packages";
import { requirePlatformAdmin } from "../../_data";

async function Packages() {
  await requirePlatformAdmin(); // pages re-check; the layout guard is not the only protection
  const packages = await listPackagesForAdmin();
  return <PackagesList packages={packages} archive={archivePackage} setDefault={setDefaultPackage} />;
}

export default function PackagesPage() {
  return (
    <main className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Packages</h1>
        <Link href="/admin/packages/new" className="flex min-h-12 items-center rounded-lg bg-teal-700 px-4 font-semibold text-white hover:bg-teal-800">New plan</Link>
      </div>
      <Suspense fallback={<div role="status" aria-label="Loading plans" className="h-64 animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-800" />}>
        <Packages />
      </Suspense>
    </main>
  );
}
