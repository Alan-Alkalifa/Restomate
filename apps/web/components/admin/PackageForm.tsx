"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import type { AuthAction } from "@/components/auth/types";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { currencyExponent } from "@/lib/money";
import { fromMinorUnits, failureMessage, toMinorUnitsString } from "./package-form-utils";
import {
  CURRENCIES, FEATURE_KEYS, FEATURE_LABELS, LIMIT_KEYS, LIMIT_LABELS,
  type FeatureKey, type LimitKey,
} from "@/lib/admin/package-schemas";
import type { AdminPackage } from "@/lib/admin/packages";

type Values = {
  code: string; name: string; description: string; currency: string;
  priceMonthly: string; priceYearly: string; trialDays: string;
  limits: Record<LimitKey, string>; features: FeatureKey[]; isPublic: boolean; sortOrder: string;
};

function initial(pkg?: AdminPackage): Values {
  const currency = pkg?.currency ?? "IDR";
  return {
    code: pkg?.code ?? "",
    name: pkg?.name ?? "",
    description: pkg?.description ?? "",
    currency,
    priceMonthly: pkg ? fromMinorUnits(pkg.priceMonthly, currency) : "",
    priceYearly: pkg ? fromMinorUnits(pkg.priceYearly, currency) : "",
    trialDays: String(pkg?.trialDays ?? 14),
    limits: Object.fromEntries(LIMIT_KEYS.map((k) => [k, pkg?.limits[k] == null ? "" : String(pkg.limits[k])])) as Record<LimitKey, string>,
    features: pkg?.features ?? [],
    isPublic: pkg?.isPublic ?? true,
    sortOrder: String(pkg?.sortOrder ?? 0),
  };
}

const textarea = "min-h-24 rounded-lg border border-neutral-400 bg-transparent p-3 text-base aria-[invalid=true]:border-red-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700";

export function PackageForm({ action, pkg }: { action: AuthAction; pkg?: AdminPackage }) {
  const router = useRouter();
  const editing = !!pkg;
  // Controlled state: React resets uncontrolled fields after an action, which would drop the admin's input on error.
  const [v, setV] = useState<Values>(() => initial(pkg));
  const [state, formAction, pending] = useActionState(action, null);
  const ok = state?.ok === true;
  useEffect(() => {
    if (ok) {
      router.push("/admin/packages");
      router.refresh();
    }
  }, [ok, router]);

  const fe = (name: string) => (state && !state.ok ? state.fieldErrors?.[name] : undefined);
  const set = <K extends keyof Values>(k: K, val: Values[K]) => setV((p) => ({ ...p, [k]: val }));
  const inUse = (pkg?.subscriptionCount ?? 0) > 0;
  const priceHint = (() => {
    try {
      return currencyExponent(v.currency) === 0 ? "Whole rupiah, e.g. 250000 or 250.000." : "Include cents, e.g. 12.50.";
    } catch {
      return undefined;
    }
  })();
  const prefix = v.currency === "IDR" ? "Rp" : v.currency;

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-5" noValidate>
      <FormAlert message={failureMessage(state)} />
      {editing ? <input type="hidden" name="packageId" value={pkg.id} /> : null}

      {editing ? (
        <p className="text-sm">Code: <code className="rounded bg-neutral-100 px-1.5 py-0.5 dark:bg-neutral-800">{pkg.code}</code> <span className="text-neutral-600 dark:text-neutral-400">(cannot be changed)</span></p>
      ) : (
        <Field name="code" label="Code" value={v.code} onChange={(e) => set("code", e.target.value)} errors={fe("code")}
          hint="Lowercase letters, digits, - or _. Starts with a letter. Cannot be changed later." autoComplete="off" required maxLength={40} />
      )}
      <Field name="name" label="Name" value={v.name} onChange={(e) => set("name", e.target.value)} errors={fe("name")} required maxLength={60} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="field-description" className="text-sm font-medium">Description</label>
        <textarea id="field-description" name="description" rows={3} maxLength={300} value={v.description}
          onChange={(e) => set("description", e.target.value)} aria-invalid={fe("description")?.length ? true : undefined}
          aria-describedby={fe("description")?.length ? "field-description-error" : undefined} className={textarea} />
        {fe("description")?.length ? <p id="field-description-error" className="text-sm text-red-700 dark:text-red-400">{fe("description")!.join(" ")}</p> : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="field-currency" className="text-sm font-medium">Currency</label>
        <select id="field-currency" name="currency" value={v.currency} onChange={(e) => set("currency", e.target.value)}
          aria-invalid={fe("currency")?.length ? true : undefined} aria-describedby={[inUse && "field-currency-hint", fe("currency")?.length && "field-currency-error"].filter(Boolean).join(" ") || undefined}
          className="min-h-12 rounded-lg border border-neutral-400 bg-transparent px-3 text-base aria-[invalid=true]:border-red-600">
          {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {inUse ? <p id="field-currency-hint" className="text-xs text-neutral-600 dark:text-neutral-400">This plan has subscriptions, so its currency can&apos;t change.</p> : null}
        {fe("currency")?.length ? <p id="field-currency-error" className="text-sm text-red-700 dark:text-red-400">{fe("currency")!.join(" ")}</p> : null}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        {(["priceMonthly", "priceYearly"] as const).map((k) => (
          <div key={k}>
            <Field name={`${k}_input`} label={`${k === "priceMonthly" ? "Monthly" : "Yearly"} price (${prefix})`} inputMode="decimal"
              value={v[k]} onChange={(e) => set(k, e.target.value)} errors={fe(k)} hint={priceHint} autoComplete="off" required />
            {/* The server parses and validates this; the visible field is only for typing. */}
            <input type="hidden" name={k} value={toMinorUnitsString(v[k], v.currency)} />
          </div>
        ))}
      </div>
      <p className="-mt-3 text-xs text-neutral-600 dark:text-neutral-400">Price changes apply to future invoices only.</p>

      <Field name="trialDays" label="Trial length (days)" type="number" inputMode="numeric" min={0} max={365}
        value={v.trialDays} onChange={(e) => set("trialDays", e.target.value)} errors={fe("trialDays")} required />

      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium">Limits</legend>
        <p className="text-xs text-neutral-600 dark:text-neutral-400">Leave blank for unlimited.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {LIMIT_KEYS.map((k) => (
            <Field key={k} name={`limit_${k}`} label={LIMIT_LABELS[k]} inputMode="numeric" placeholder="Unlimited" autoComplete="off"
              value={v.limits[k]} onChange={(e) => setV((p) => ({ ...p, limits: { ...p.limits, [k]: e.target.value } }))} errors={fe(`limit_${k}`)} />
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium">Features</legend>
        {FEATURE_KEYS.map((k) => (
          <label key={k} className="flex min-h-12 items-center gap-3">
            <input type="checkbox" name="features" value={k} checked={v.features.includes(k)} className="size-6"
              onChange={(e) => set("features", e.target.checked ? [...v.features, k] : v.features.filter((x) => x !== k))} />
            {FEATURE_LABELS[k]}
          </label>
        ))}
        {fe("features")?.length ? <p className="text-sm text-red-700 dark:text-red-400">{fe("features")!.join(" ")}</p> : null}
      </fieldset>

      <div>
        <label className="flex min-h-12 items-center gap-3">
          <input type="checkbox" className="size-6" checked={v.isPublic} onChange={(e) => set("isPublic", e.target.checked)} />
          Show on the public pricing page
        </label>
        <input type="hidden" name="isPublic" value={String(v.isPublic)} />
        <p className="text-xs text-neutral-600 dark:text-neutral-400">Hidden plans can still be assigned to a tenant.</p>
      </div>

      <Field name="sortOrder" label="Sort order" type="number" inputMode="numeric" min={0} max={9999}
        value={v.sortOrder} onChange={(e) => set("sortOrder", e.target.value)} errors={fe("sortOrder")} hint="Lower numbers come first." required />

      <div className="flex gap-3">
        <Button type="submit" pending={pending}>{pending ? "Saving…" : editing ? "Save changes" : "Create plan"}</Button>
        <Link href="/admin/packages" className="flex min-h-12 items-center rounded-lg px-4 ring-1 ring-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800">Cancel</Link>
      </div>
    </form>
  );
}
