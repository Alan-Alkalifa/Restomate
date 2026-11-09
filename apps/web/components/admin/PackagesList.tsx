import Link from "next/link";
import type { AuthAction } from "@/components/auth/types";
import { formatMoney } from "@/lib/money";
import { ArchiveDialog, SetDefaultButton } from "./PackageActions";
import { FEATURE_LABELS, LIMIT_KEYS, LIMIT_LABELS } from "@/lib/admin/package-schemas";
import type { AdminPackage } from "@/lib/admin/packages";

const badge = "rounded-full px-2 py-0.5 text-xs font-medium";

export function PackagesList({ packages, archive, setDefault }: { packages: AdminPackage[]; archive: AuthAction; setDefault: AuthAction }) {
  if (packages.length === 0) {
    return (
      <div role="status" className="rounded-xl border border-dashed border-neutral-400 p-8 text-center">
        <p className="font-medium">No plans yet.</p>
        <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">Create the first plan so restaurants can subscribe.</p>
        <Link href="/admin/packages/new" className="mt-4 inline-flex min-h-12 items-center rounded-lg bg-teal-700 px-4 font-semibold text-white hover:bg-teal-800">New plan</Link>
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-4">
      {packages.map((p) => (
        <li key={p.id} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <article aria-labelledby={`pkg-${p.id}`} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id={`pkg-${p.id}`} className="text-lg font-semibold break-words">{p.name}</h2>
              <code className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs dark:bg-neutral-800">{p.code}</code>
              {p.isDefault ? <span className={`${badge} bg-teal-100 text-teal-900 dark:bg-teal-900 dark:text-teal-100`}>Default</span> : null}
              {!p.isActive ? <span className={`${badge} bg-neutral-200 text-neutral-900 dark:bg-neutral-700 dark:text-neutral-100`}>Archived</span> : null}
              {!p.isPublic ? <span className={`${badge} bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100`}>Hidden</span> : null}
            </div>
            {p.description ? <p className="text-sm text-neutral-700 dark:text-neutral-300">{p.description}</p> : null}
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div><dt className="text-neutral-600 dark:text-neutral-400">Monthly</dt><dd>{formatMoney(p.priceMonthly, p.currency)}</dd></div>
              <div><dt className="text-neutral-600 dark:text-neutral-400">Yearly</dt><dd>{formatMoney(p.priceYearly, p.currency)}</dd></div>
              <div><dt className="text-neutral-600 dark:text-neutral-400">Trial</dt><dd>{p.trialDays} days</dd></div>
              <div><dt className="text-neutral-600 dark:text-neutral-400">Subscriptions</dt><dd>{p.subscriptionCount}</dd></div>
              <div className="sm:col-span-2">
                <dt className="text-neutral-600 dark:text-neutral-400">Limits</dt>
                <dd>{LIMIT_KEYS.map((k) => `${LIMIT_LABELS[k]}: ${p.limits[k] ?? "Unlimited"}`).join(" · ")}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-neutral-600 dark:text-neutral-400">Features</dt>
                <dd>{p.features.length ? p.features.map((f) => FEATURE_LABELS[f]).join(", ") : "None"}</dd>
              </div>
            </dl>
            <div className="flex flex-wrap items-start gap-2">
              <Link href={`/admin/packages/${p.id}`} className="flex min-h-12 items-center rounded-lg px-3 text-sm font-medium ring-1 ring-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800">Edit</Link>
              {p.isActive && !p.isDefault ? <SetDefaultButton action={setDefault} packageId={p.id} /> : null}
              <ArchiveDialog action={archive} packageId={p.id} name={p.name} restore={!p.isActive} />
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}
