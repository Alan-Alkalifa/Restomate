import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PackageForm } from "@/components/admin/PackageForm";
import { updatePackage } from "@/lib/admin/package-actions";
import { listPackagesForAdmin } from "@/lib/admin/packages";
import { requirePlatformAdmin } from "../../../_data";

async function Edit({ params }: { params: PageProps<"/admin/packages/[id]">["params"] }) {
  await requirePlatformAdmin();
  const { id } = await params;
  const pkg = (await listPackagesForAdmin()).find((p) => p.id === id);
  if (!pkg) notFound();
  // key: a different plan (or a refreshed row) gets a fresh form state.
  return <PackageForm key={`${pkg.id}-${pkg.updatedAt}`} action={updatePackage} pkg={pkg} />;
}

export default function EditPackagePage({ params }: PageProps<"/admin/packages/[id]">) {
  return (
    <main className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Edit plan</h1>
      <Suspense fallback={<div role="status" aria-label="Loading" className="h-64 animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-800" />}>
        <Edit params={params} />
      </Suspense>
    </main>
  );
}
