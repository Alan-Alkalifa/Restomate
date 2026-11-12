import { notFound } from "next/navigation";
import { Suspense } from "react";
import { TenantDetailView } from "@/components/admin/TenantDetailSections";
import { sendOwnerPasswordReset } from "@/lib/admin/tenant-actions";
import { getTenantDetail } from "@/lib/admin/tenant-detail";
import { requirePlatformAdmin } from "../../../_data";

const ROOT = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "restomate.app";

async function Detail({ params }: { params: PageProps<"/admin/tenants/[orgId]">["params"] }) {
  await requirePlatformAdmin(); // pages re-check; the layout guard is not the only protection
  const { orgId } = await params;
  const detail = await getTenantDetail(orgId); // null: not a uuid, or no such organization
  if (!detail) notFound();
  return <TenantDetailView detail={detail} reset={sendOwnerPasswordReset} rootDomain={ROOT} />;
}

export default function TenantDetailPage({ params }: PageProps<"/admin/tenants/[orgId]">) {
  return (
    <main className="flex flex-col gap-4">
      <Suspense fallback={<div role="status" aria-label="Loading tenant" className="flex flex-col gap-4">{[0, 1, 2].map((i) => <div key={i} className="h-40 animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-800" />)}</div>}>
        <Detail params={params} />
      </Suspense>
    </main>
  );
}
