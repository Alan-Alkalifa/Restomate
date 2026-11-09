import { Suspense } from "react";
import { Pagination, TenantFilters, TenantsTable } from "@/components/admin/TenantsTable";
import { parseTenantParams } from "@/components/admin/params";
import { listTenants, requirePlatformAdmin, setOrgStatus } from "../../_data";

async function Tenants({ searchParams }: { searchParams: PageProps<"/admin/tenants">["searchParams"] }) {
  await requirePlatformAdmin(); // pages re-check; the layout guard is not the only protection
  const input = parseTenantParams(await searchParams);
  const { rows, total } = await listTenants(input);
  const filters = { q: input.q, status: input.status, packageCode: input.packageCode };
  return (
    <>
      <TenantFilters {...filters} />
      <TenantsTable rows={rows} setStatus={setOrgStatus} />
      <Pagination page={input.page} pageSize={input.pageSize} total={total} filters={filters} />
    </>
  );
}

export default function TenantsPage({ searchParams }: PageProps<"/admin/tenants">) {
  return (
    <main className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Tenants</h1>
      <Suspense fallback={<div role="status" aria-label="Loading tenants" className="h-64 animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-800" />}>
        <Tenants searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
