import { TENANT_LIMIT_KEYS, type TenantAuditEntry, type TenantLimitKey, TenantDetail, TenantSubscription } from "@/lib/admin/tenant-detail-types";
import type { AuthAction } from "@/components/auth/types";
import { OwnerResetDialog } from "./OwnerResetDialog";

// Every string below comes from the database (names, slugs, metadata). It is only ever rendered as React
// text nodes, which escape it. Never use dangerouslySetInnerHTML in this file.

const STATUS_BADGE: Record<TenantDetail["org"]["status"], string> = {
  active: "bg-green-100 text-green-900",
  suspended: "bg-red-100 text-red-900",
  past_due: "bg-amber-100 text-amber-900",
  read_only: "bg-neutral-200 text-neutral-900",
};

const LIMIT_LABELS: Record<TenantLimitKey, string> = {
  max_locations: "Locations",
  max_staff: "Staff",
  max_tables: "Tables",
  max_orders_per_month: "Orders per month",
};

/** Without a live subscription every limit is 0 ("no plan"), which is not the same as a plan that allows 0. */
export const hasNoPlan = (sub: TenantSubscription | null) => !sub || sub.status === "canceled";

const TZ = "Asia/Jakarta";
export const formatDate = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: TZ }).format(new Date(iso)) : "—";
export const formatDateTime = (iso: string) =>
  `${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: TZ }).format(new Date(iso))} WIB`;

const card = "flex flex-col gap-3 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800";
const h2 = "text-lg font-semibold";
const muted = "text-sm text-neutral-600 dark:text-neutral-400";

function Empty({ children }: { children: string }) {
  return <p role="status" className="rounded-lg border border-dashed border-neutral-400 p-4 text-center text-sm">{children}</p>;
}

export function TenantHeader({ org, rootDomain }: { org: TenantDetail["org"]; rootDomain: string }) {
  return (
    <header className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold break-words">{org.name}</h1>
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[org.status]}`}>{org.status.replace("_", " ")}</span>
      </div>
      {org.status === "suspended" ? (
        <p role="status" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">This restaurant is suspended. Its staff cannot use the dashboard.</p>
      ) : null}
      <p className={muted}>
        <span className="break-all">{org.slug}</span> · Created {formatDate(org.createdAt)} ·{" "}
        <a href={`https://${encodeURIComponent(org.slug)}.${rootDomain}`} target="_blank" rel="noreferrer" className="underline">Open storefront</a>
      </p>
    </header>
  );
}

export function LocationsSection({ locations }: { locations: TenantDetail["locations"] }) {
  return (
    <section aria-labelledby="locations-h" className={card}>
      <h2 id="locations-h" className={h2}>Locations</h2>
      {locations.length === 0 ? <Empty>No locations yet.</Empty> : (
        <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
          {locations.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="break-words font-medium">{l.name}</span>
              <span className={muted}>{l.timezone} · {l.currency}{l.isActive ? "" : " · Inactive"}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function usageLabel(key: TenantLimitKey, { used, limit }: { used: number; limit: number | null }, noPlan = false) {
  if (key === "max_orders_per_month") return "Not tracked yet";
  if (limit === null) return `${used} · Unlimited`;
  if (noPlan && limit === 0) return `${used} · No plan`;
  return `${used} of ${limit}`;
}

export function UsageSection({ usage, subscription }: { usage: TenantDetail["usage"]; subscription: TenantSubscription | null }) {
  return (
    <section aria-labelledby="usage-h" className={card}>
      <h2 id="usage-h" className={h2}>Plan &amp; usage</h2>
      <p className={muted}>{subscription ? `${subscription.packageName} · ${subscription.status.replace("_", " ")}` : "No subscription"}</p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {TENANT_LIMIT_KEYS.map((k) => {
          const u = usage[k];
          const noPlan = hasNoPlan(subscription) && u.limit === 0;
          const tracked = k !== "max_orders_per_month" && !noPlan;
          const over = tracked && u.limit !== null && u.used > u.limit;
          const full = tracked && u.limit !== null && u.used === u.limit;
          const pct = tracked && u.limit ? Math.min(100, Math.round((u.used / u.limit) * 100)) : 0;
          return (
            <li key={k} data-over-limit={over || undefined} className={`rounded-lg p-3 ring-1 ${over ? "bg-red-50 ring-red-400 dark:bg-red-950" : "ring-neutral-300 dark:ring-neutral-700"}`}>
              <p className="text-sm font-medium">{LIMIT_LABELS[k]}</p>
              <p className="text-base">{usageLabel(k, u, noPlan)}{over ? <strong className="ml-2 text-red-800 dark:text-red-300">Over limit</strong> : full ? <span className="ml-2 text-amber-800 dark:text-amber-300">At limit</span> : null}</p>
              {tracked && u.limit !== null && u.limit > 0 ? (
                <div role="progressbar" aria-label={`${LIMIT_LABELS[k]} usage`} aria-valuemin={0} aria-valuemax={u.limit} aria-valuenow={Math.min(u.used, u.limit)}
                  className="mt-2 h-2 overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800">
                  <div className={`h-full ${over ? "bg-red-600" : "bg-teal-700"}`} style={{ width: `${pct}%` }} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function SubscriptionHistorySection({ history }: { history: TenantSubscription[] }) {
  const th = "px-3 py-2 text-left text-xs font-semibold uppercase text-neutral-600 dark:text-neutral-400";
  const td = "px-3 py-2 text-sm";
  return (
    <section aria-labelledby="subs-h" className={card}>
      <h2 id="subs-h" className={h2}>Subscription history</h2>
      {history.length === 0 ? <Empty>No subscriptions yet.</Empty> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem]">
            <caption className="sr-only">Subscription history, newest first</caption>
            <thead><tr>{["Plan", "Status", "Billing", "Trial ends", "Period ends", "Canceled", "Started"].map((h) => <th key={h} scope="col" className={th}>{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {history.map((s) => (
                <tr key={s.id}>
                  <th scope="row" className={`${td} text-left font-medium break-words`}>{s.packageName}</th>
                  <td className={td}>{s.status.replace("_", " ")}</td>
                  <td className={td}>{s.billingPeriod}</td>
                  <td className={td}>{formatDate(s.trialEndsAt)}</td>
                  <td className={td}>{formatDate(s.currentPeriodEnd)}</td>
                  <td className={td}>{formatDate(s.canceledAt)}</td>
                  <td className={td}>{formatDate(s.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function OwnersSection({ orgId, owners, reset }: { orgId: string; owners: TenantDetail["owners"]; reset: AuthAction }) {
  return (
    <section aria-labelledby="owners-h" className={card}>
      <h2 id="owners-h" className={h2}>Owners</h2>
      {owners.length === 0 ? <Empty>No active owners.</Empty> : (
        <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
          {owners.map((o) => (
            <li key={o.userId} className="flex flex-wrap items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="font-medium break-words">{o.name ?? "Unnamed"}</p>
                <p className={`${muted} break-all`}>{o.email}</p>
              </div>
              <OwnerResetDialog action={reset} orgId={orgId} userId={o.userId} ownerName={o.name ?? o.email} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function metadataText(m: Record<string, unknown>): string | null {
  if (Object.keys(m).length === 0) return null;
  try {
    return JSON.stringify(m, null, 2);
  } catch {
    return "(unreadable)";
  }
}

export function AuditSection({ entries }: { entries: TenantAuditEntry[] }) {
  return (
    <section aria-labelledby="audit-h" className={card}>
      <h2 id="audit-h" className={h2}>Audit trail</h2>
      {entries.length === 0 ? <Empty>No audit entries yet.</Empty> : (
        <ol className="divide-y divide-neutral-200 dark:divide-neutral-800">
          {entries.map((e) => {
            const meta = metadataText(e.metadata);
            return (
              <li key={e.id} className="py-2 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium break-all">{e.action}</span>
                  <span className={muted}>{e.actorName ?? "System"} · <time dateTime={e.createdAt}>{formatDateTime(e.createdAt)}</time></span>
                </div>
                {meta ? (
                  <details className="mt-1">
                    <summary className="min-h-8 cursor-pointer text-xs underline">Details</summary>
                    <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded bg-neutral-100 p-2 text-xs dark:bg-neutral-900">{meta}</pre>
                  </details>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export function TenantDetailView({ detail, reset, rootDomain }: { detail: TenantDetail; reset: AuthAction; rootDomain: string }) {
  return (
    <div className="flex flex-col gap-4">
      <TenantHeader org={detail.org} rootDomain={rootDomain} />
      <LocationsSection locations={detail.locations} />
      <UsageSection usage={detail.usage} subscription={detail.subscription} />
      <SubscriptionHistorySection history={detail.subscriptionHistory} />
      <OwnersSection orgId={detail.org.id} owners={detail.owners} reset={reset} />
      <AuditSection entries={detail.auditTrail} />
    </div>
  );
}
