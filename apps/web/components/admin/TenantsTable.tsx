import Link from "next/link";
import type { AuthAction } from "@/components/auth/types";
import { StatusDialog } from "./StatusDialog";
import { tenantsHref } from "./params";
import type { OrgStatus, TenantRow } from "./types";

const BADGE: Record<OrgStatus, string> = {
  active: "bg-green-100 text-green-900",
  suspended: "bg-red-100 text-red-900",
  past_due: "bg-amber-100 text-amber-900",
  read_only: "bg-neutral-200 text-neutral-900",
};

const date = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(iso)) : "—";

export function TenantFilters({ q, status, packageCode }: { q?: string; status?: string; packageCode?: string }) {
  const input = "min-h-12 rounded-lg border border-neutral-400 bg-transparent px-3";
  return (
    <form method="get" action="/admin/tenants" role="search" className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-sm">Search
        <input name="q" defaultValue={q} placeholder="Name or slug" className={input} />
      </label>
      <label className="flex flex-col gap-1 text-sm">Status
        <select name="status" defaultValue={status ?? ""} className={input}>
          <option value="">All</option>
          {(Object.keys(BADGE) as OrgStatus[]).map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">Plan code
        <input name="plan" defaultValue={packageCode} className={input} />
      </label>
      <button type="submit" className="min-h-12 rounded-lg bg-indigo-700 px-5 font-semibold text-white">Filter</button>
      <Link href="/admin/tenants" className="flex min-h-12 items-center text-sm underline">Reset</Link>
    </form>
  );
}

export function TenantsTable({ rows, setStatus }: { rows: TenantRow[]; setStatus: AuthAction }) {
  if (rows.length === 0) {
    return <p role="status" className="rounded-lg border border-dashed border-neutral-400 p-6 text-center">No tenants match these filters.</p>;
  }
  const th = "px-3 py-2 text-left text-xs font-semibold uppercase text-neutral-600 dark:text-neutral-400";
  const td = "px-3 py-2 align-middle text-sm";
  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-300 dark:border-neutral-700">
      <table className="w-full min-w-[56rem]">
        <caption className="sr-only">Tenants</caption>
        <thead className="bg-neutral-100 dark:bg-neutral-900">
          <tr>
            {["Restaurant", "Status", "Plan", "Subscription", "Trial ends", "Locations", "Members", "Created", "Actions"].map((h) => (
              <th key={h} scope="col" className={th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
          {rows.map((r) => (
            <tr key={r.id}>
              {/* Names are rendered as React text nodes (escaped); never as HTML. */}
              <th scope="row" className={`${td} text-left font-medium`}>
                <span className="break-words">{r.name}</span>
                <span className="block font-normal text-neutral-600 dark:text-neutral-400 break-all">{r.slug}</span>
              </th>
              <td className={td}><span className={`rounded px-2 py-0.5 text-xs font-medium ${BADGE[r.status]}`}>{r.status.replace("_", " ")}</span></td>
              <td className={td}>{r.packageName ?? "—"}</td>
              <td className={td}>{r.subscriptionStatus ?? "—"}</td>
              <td className={td}>{date(r.trialEndsAt)}</td>
              <td className={td}>{r.locationsCount}</td>
              <td className={td}>{r.membersCount}</td>
              <td className={td}>{date(r.createdAt)}</td>
              <td className={td}>
                {r.status === "suspended" ? (
                  <StatusDialog action={setStatus} orgId={r.id} orgName={r.name} target="active" />
                ) : (
                  <StatusDialog action={setStatus} orgId={r.id} orgName={r.name} target="suspended" />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, pageSize, total, filters }: { page: number; pageSize: number; total: number; filters: { q?: string; status?: string; packageCode?: string } }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const link = "flex min-h-12 items-center rounded-lg px-4 ring-1 ring-neutral-400";
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 text-sm">
      <p>{total} tenant{total === 1 ? "" : "s"} · page {Math.min(page, pages)} of {pages}</p>
      <div className="flex gap-2">
        {page > 1 ? <Link className={link} href={tenantsHref(filters, page - 1)} rel="prev">Previous</Link> : null}
        {page < pages ? <Link className={link} href={tenantsHref(filters, page + 1)} rel="next">Next</Link> : null}
      </div>
    </nav>
  );
}
