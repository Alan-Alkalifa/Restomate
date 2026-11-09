"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { percentToBps } from "./bps";
import { suggestSlug } from "@/lib/onboarding/slug";
import { clear, getServerSnapshot, getSnapshot, parse, save, subscribe } from "./wizard-store";
import type { OnboardingActions, OnboardingOptions, SlugStatus, WizardState } from "./types";

const ROOT = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "restomate.app";
const STEPS = ["Restaurant", "Location", "Branding"] as const;
/** Tax and service charge are capped at 25% (2500 bps) by lib/onboarding's schema. */
const MAX_RATE_BPS = 2500;

const SLUG_MESSAGES: Record<SlugStatus, string> = {
  available: "This address is available.",
  taken: "This address is already taken.",
  reserved: "This address is reserved. Please choose another.",
  invalid: "Use 3-40 lowercase letters, numbers or hyphens.",
};

export function OnboardingWizard({ actions, options }: { actions: OnboardingActions; options: OnboardingOptions }) {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const state = useMemo(() => parse(raw), [raw]);
  const set = (patch: Partial<WizardState>) => save({ ...state, ...patch });
  const [pending, startTransition] = useTransition();
  // createOrganization redirects server-side on success (it never returns ok). The wizard then
  // unmounts, so clear the persisted state at that point; a returned error resets the flag.
  const submitted = useRef(false);
  useEffect(() => () => { if (submitted.current) clear(); }, []);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[] | undefined>>({});

  // Debounced slug availability check; "checking" is derived (result is for a different slug).
  const [slugResult, setSlugResult] = useState<{ slug: string; status: SlugStatus } | null>(null);
  useEffect(() => {
    if (!state.slug) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await actions.checkSlug(state.slug);
        if (!cancelled) setSlugResult({ slug: state.slug, status: r.status });
      } catch {
        if (!cancelled) setSlugResult({ slug: state.slug, status: "invalid" });
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [state.slug, actions]);
  const slugStatus = slugResult?.slug === state.slug ? slugResult.status : null;
  const slugChecking = !!state.slug && slugStatus === null;

  // A value saved in sessionStorage by an older build may no longer be allowed: fall back to the default.
  const timezone = options.timezones.find((z) => z === state.timezone) ?? options.timezones[0];
  const currency = options.currencies.find((c) => c === state.currency) ?? options.currencies[0];
  const tax = percentToBps(state.taxPercent, MAX_RATE_BPS);
  const service = percentToBps(state.servicePercent, MAX_RATE_BPS);
  const colorOk = /^#[0-9a-fA-F]{6}$/.test(state.primaryColor);
  const logoOk = state.logoUrl === "" || /^https:\/\/\S+$/.test(state.logoUrl);

  const step1Ok = state.name.trim() !== "" && slugStatus === "available";
  const step2Ok = state.locationName.trim() !== "" && tax.ok && service.ok;
  const step3Ok = colorOk && logoOk;

  function submit(skipBranding: boolean) {
    if (!tax.ok || !service.ok || pending) return;
    setFormError(null);
    setFieldErrors({});
    submitted.current = true;
    startTransition(async () => {
      const result = await actions.createOrganization({
        name: state.name.trim(),
        slug: state.slug,
        location: {
          name: state.locationName.trim(),
          address: state.address.trim(),
          city: state.city.trim(),
          phone: state.phone.trim(),
          timezone,
          currency,
          taxRateBps: tax.bps,
          serviceChargeBps: service.bps,
          taxOnServiceCharge: state.taxOnServiceCharge,
        },
        branding: skipBranding ? null : { primaryColor: state.primaryColor, logoUrl: state.logoUrl || null },
      });
      if (!result.ok) {
        submitted.current = false;
        setFormError(result.formError ?? null);
        setFieldErrors(result.fieldErrors ?? {});
      }
    });
  }

  const err = (k: string) => fieldErrors[k];

  return (
    <div className="flex flex-col gap-6">
      <ol aria-label="Progress" className="flex gap-2 text-sm">
        {STEPS.map((label, i) => (
          <li key={label} aria-current={state.step === i + 1 ? "step" : undefined} className={`flex-1 rounded-lg px-2 py-2 text-center ${state.step === i + 1 ? "bg-teal-700 font-semibold text-white" : "bg-neutral-200 dark:bg-neutral-800"}`}>
            {i + 1}. {label}
          </li>
        ))}
      </ol>
      <FormAlert message={formError} />

      {state.step === 1 && (
        <form onSubmit={(e) => { e.preventDefault(); if (step1Ok) set({ step: 2 }); }} className="flex flex-col gap-4" noValidate>
          <Field name="name" label="Restaurant name" value={state.name} autoComplete="organization" required errors={err("name")}
            onChange={(e) => set({ name: e.target.value, ...(state.slugEdited ? {} : { slug: suggestSlug(e.target.value) }) })} />
          <Field name="slug" label="Web address" value={state.slug} autoCapitalize="none" spellCheck={false} required
            hint={`${state.slug || "your-name"}.${ROOT}`} errors={err("slug")}
            onChange={(e) => set({ slug: e.target.value.toLowerCase(), slugEdited: true })} />
          <p role="status" className="text-sm">
            {!state.slug ? "" : slugChecking ? "Checking availability…" : slugStatus ? SLUG_MESSAGES[slugStatus] : ""}
          </p>
          <Button type="submit" disabled={!step1Ok}>Next</Button>
        </form>
      )}

      {state.step === 2 && (
        <form onSubmit={(e) => { e.preventDefault(); if (step2Ok) set({ step: 3 }); }} className="flex flex-col gap-4" noValidate>
          <Field name="locationName" label="Location name" value={state.locationName} required errors={err("location.name")} onChange={(e) => set({ locationName: e.target.value })} />
          <Field name="address" label="Address" value={state.address} autoComplete="street-address" onChange={(e) => set({ address: e.target.value })} />
          <Field name="city" label="City" value={state.city} autoComplete="address-level2" onChange={(e) => set({ city: e.target.value })} />
          <Field name="phone" label="Phone" type="tel" value={state.phone} autoComplete="tel" onChange={(e) => set({ phone: e.target.value })} />
          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1.5 text-sm font-medium">Timezone
              <select value={timezone} onChange={(e) => set({ timezone: e.target.value })} className="min-h-12 rounded-lg border border-neutral-400 bg-transparent px-2 font-normal">
                {options.timezones.map((z) => <option key={z}>{z}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">Currency
              <select value={currency} onChange={(e) => set({ currency: e.target.value })} className="min-h-12 rounded-lg border border-neutral-400 bg-transparent px-2 font-normal">
                {options.currencies.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field name="tax" label="Tax (PB1/PBJT) %" inputMode="decimal" value={state.taxPercent} onChange={(e) => set({ taxPercent: e.target.value })}
              errors={tax.ok ? err("location.taxRateBps") : [tax.error]} />
            <Field name="service" label="Service charge %" inputMode="decimal" value={state.servicePercent} onChange={(e) => set({ servicePercent: e.target.value })}
              errors={service.ok ? err("location.serviceChargeBps") : [service.error]} />
          </div>
          <p className="text-xs text-neutral-600 dark:text-neutral-400">Tax rates are set by your regional government. Check the rate for your area.</p>
          <label className="flex min-h-12 items-center gap-3 text-sm">
            <input type="checkbox" checked={state.taxOnServiceCharge} onChange={(e) => set({ taxOnServiceCharge: e.target.checked })} className="h-6 w-6" />
            Tax applies on service charge
          </label>
          <div className="flex gap-3">
            <Button type="button" className="flex-1 bg-transparent text-inherit ring-1 ring-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800" onClick={() => set({ step: 1 })}>Back</Button>
            <Button type="submit" className="flex-1" disabled={!step2Ok}>Next</Button>
          </div>
        </form>
      )}

      {state.step === 3 && (
        <form onSubmit={(e) => { e.preventDefault(); if (step3Ok) submit(false); }} className="flex flex-col gap-4" noValidate>
          <label className="flex flex-col gap-1.5 text-sm font-medium">Brand colour
            <input type="color" value={colorOk ? state.primaryColor : "#0f766e"} onChange={(e) => set({ primaryColor: e.target.value })} className="h-12 w-full rounded-lg border border-neutral-400" />
          </label>
          <Field name="logoUrl" label="Logo URL (optional)" type="url" value={state.logoUrl} hint="Must start with https://" errors={logoOk ? err("branding.logoUrl") : ["Logo URL must start with https://"]} onChange={(e) => set({ logoUrl: e.target.value })} />
          <div aria-label="Preview" className="flex items-center gap-3 rounded-lg border border-neutral-300 p-4 dark:border-neutral-700">
            {state.logoUrl && logoOk && (
              // eslint-disable-next-line @next/next/no-img-element -- user-supplied remote preview
              <img src={state.logoUrl} alt="" width={40} height={40} className="h-10 w-10 object-contain" />
            )}
            <span className="font-semibold break-words" style={{ color: colorOk ? state.primaryColor : undefined }}>{state.name || "Your restaurant"}</span>
            <span className="ml-auto rounded px-3 py-1 text-sm text-white" style={{ backgroundColor: colorOk ? state.primaryColor : "#0f766e" }}>Order now</span>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button type="button" className="bg-transparent text-inherit ring-1 ring-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800" onClick={() => set({ step: 2 })} disabled={pending}>Back</Button>
            <Button type="button" className="bg-transparent text-inherit ring-1 ring-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800" onClick={() => submit(true)} pending={pending}>Skip</Button>
            <Button type="submit" className="flex-1" pending={pending} disabled={!step3Ok}>{pending ? "Creating…" : "Finish"}</Button>
          </div>
        </form>
      )}
    </div>
  );
}
