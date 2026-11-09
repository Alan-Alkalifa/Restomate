import { Suspense } from "react";
import { PackageForm } from "@/components/admin/PackageForm";
import { createPackage } from "@/lib/admin/package-actions";
import { requirePlatformAdmin } from "../../../_data";

async function Form() {
  await requirePlatformAdmin();
  return <PackageForm action={createPackage} />;
}

export default function NewPackagePage() {
  return (
    <main className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">New plan</h1>
      <Suspense fallback={<div role="status" aria-label="Loading" className="h-64 animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-800" />}>
        <Form />
      </Suspense>
    </main>
  );
}
