"use client";

import { useActionState, useState } from "react";
import type { ActionResult, AuthAction } from "@/components/auth/types";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { PlatformBanner } from "@/components/ui/PlatformBanner";
import {
  BANNER_MESSAGE_MAX, OWNED_ORG_CAP_RANGE, TAX_PRESETS_MAX,
  type BannerLevel, type PlatformSettings, type TaxPreset,
} from "@/lib/admin/platform-settings-schemas";
import { bpsToPercent, capInRange, capToPostValue, parsePercentToBps, previewPercent } from "./settings-utils";

const card = "flex max-w-2xl flex-col gap-4 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800";
const muted = "text-xs text-neutral-600 dark:text-neutral-400";
const input = "min-h-12 rounded-lg border border-neutral-400 bg-transparent px-3 text-base aria-[invalid=true]:border-red-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700";

const MESSAGES: Record<string, string> = {
  SIGNUP_DISABLED: "Sign-ups are closed right now.",
  FORBIDDEN: "You don't have access to do that.",
  RATE_LIMITED: "Too many attempts. Try again later.",
};

export function settingsFailure(state: ActionResult | null): string | undefined {
  if (!state || state.ok) return undefined;
  if (state.formError) return state.formError;
  if (state.code && MESSAGES[state.code]) return MESSAGES[state.code];
  return state.fieldErrors ? "Check the highlighted fields." : "Could not save the setting. Try again.";
}

const fieldErrs = (s: ActionResult | null, name: string) => (s && !s.ok ? s.fieldErrors?.[name] : undefined);

function Status({ state }: { state: ActionResult | null }) {
  return state?.ok ? <FormAlert tone="info" message="Saved." /> : <FormAlert message={settingsFailure(state)} />;
}

function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <div>
      <label className="flex min-h-12 items-center gap-3">
        <input type="checkbox" className="size-6" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
      {hint ? <p className={muted}>{hint}</p> : null}
    </div>
  );
}

export function SignupForm({ action, initial }: { action: AuthAction; initial: PlatformSettings["signup"] }) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className={card} aria-labelledby="set-signup">
      <h2 id="set-signup" className="text-lg font-semibold">Sign-ups</h2>
      <Toggle label="Allow new sign-ups" checked={enabled} onChange={setEnabled}
        hint="When off, nobody can create an account or a restaurant. Existing users can still sign in." />
      <input type="hidden" name="enabled" value={String(enabled)} />
      <Status state={state} />
      <div><Button type="submit" pending={pending}>{pending ? "Saving…" : "Save"}</Button></div>
    </form>
  );
}

export function BannerForm({ action, initial }: { action: AuthAction; initial: PlatformSettings["maintenanceBanner"] }) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [message, setMessage] = useState(initial.message);
  const [level, setLevel] = useState<BannerLevel>(initial.level);
  const [state, formAction, pending] = useActionState(action, null);
  const left = BANNER_MESSAGE_MAX - message.length;
  const markup = /[<>]/.test(message);
  return (
    <form action={formAction} className={card} aria-labelledby="set-banner">
      <h2 id="set-banner" className="text-lg font-semibold">Maintenance banner</h2>
      <Toggle label="Show the banner" checked={enabled} onChange={setEnabled} />
      <input type="hidden" name="enabled" value={String(enabled)} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="banner-message" className="text-sm font-medium">Message</label>
        <textarea id="banner-message" name="message" rows={3} maxLength={BANNER_MESSAGE_MAX} value={message} onChange={(e) => setMessage(e.target.value)}
          aria-invalid={fieldErrs(state, "message")?.length || markup ? true : undefined} aria-describedby="banner-message-help"
          className={`${input} min-h-24 py-2`} />
        <p id="banner-message-help" className={muted}>
          Plain text only, no &lt; or &gt;. <span aria-live="polite">{left} characters left</span>
        </p>
        {markup ? <p className="text-sm text-red-700 dark:text-red-400">Remove &lt; and &gt;. The banner is plain text.</p> : null}
        {fieldErrs(state, "message")?.length ? <p className="text-sm text-red-700 dark:text-red-400">{fieldErrs(state, "message")!.join(" ")}</p> : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="banner-level" className="text-sm font-medium">Level</label>
        <select id="banner-level" name="level" value={level} onChange={(e) => setLevel(e.target.value as BannerLevel)} className={input}>
          <option value="info">Info</option>
          <option value="warning">Warning</option>
        </select>
        {fieldErrs(state, "level")?.length ? <p className="text-sm text-red-700 dark:text-red-400">{fieldErrs(state, "level")!.join(" ")}</p> : null}
      </div>
      <div>
        <p className="mb-1 text-sm font-medium">Preview</p>
        <div className="overflow-hidden rounded-lg border border-neutral-300 dark:border-neutral-700">
          {message.trim() === "" ? <p className="p-3 text-sm text-neutral-600 dark:text-neutral-400">Nothing to show yet.</p>
            : <PlatformBanner banner={{ enabled: true, message: message.trim(), level }} />}
        </div>
      </div>
      <Status state={state} />
      <div><Button type="submit" pending={pending}>{pending ? "Saving…" : "Save"}</Button></div>
    </form>
  );
}

type Row = { code: string; label: string; tax: string; service: string; onService: boolean };
const toRow = (p: TaxPreset): Row => ({ code: p.code, label: p.label, tax: bpsToPercent(p.taxRateBps), service: bpsToPercent(p.serviceChargeBps), onService: p.taxOnServiceCharge });

/** Unreadable percent text is sent through as the raw string so the server rejects it with a field error; never guessed. */
function serialize(rows: Row[]): string {
  return JSON.stringify(rows.map((r) => ({
    code: r.code.trim(),
    label: r.label.trim(),
    taxRateBps: parsePercentToBps(r.tax) ?? r.tax,
    serviceChargeBps: parsePercentToBps(r.service) ?? r.service,
    taxOnServiceCharge: r.onService,
  })));
}

export function TaxPresetsForm({ action, initial }: { action: AuthAction; initial: PlatformSettings["taxPresets"] }) {
  const [rows, setRows] = useState<Row[]>(() => initial.presets.map(toRow));
  const [defaultCode, setDefaultCode] = useState(initial.defaultCode);
  const [state, formAction, pending] = useActionState(action, null);
  const update = (i: number, patch: Partial<Row>) => setRows((p) => p.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const codes = rows.map((r) => r.code.trim());
  const defaultIdx = codes.indexOf(defaultCode);
  return (
    <form action={formAction} className={card} aria-labelledby="set-tax">
      <h2 id="set-tax" className="text-lg font-semibold">Tax presets</h2>
      <p className={muted}>Presets are copied when a location is created. Changing them never changes an existing location.</p>
      <ul className="flex flex-col gap-4">
        {rows.map((r, i) => {
          const taxP = r.tax.trim() === "" ? null : previewPercent(r.tax);
          const svcP = r.service.trim() === "" ? null : previewPercent(r.service);
          return (
            <li key={i} className="flex flex-col gap-3 rounded-lg p-3 ring-1 ring-neutral-300 dark:ring-neutral-700">
              {/* The visible inputs have no name: only the hidden `presets` JSON and `defaultCode` are submitted. */}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm font-medium">Code
                  <input value={r.code} onChange={(e) => update(i, { code: e.target.value })} autoComplete="off" maxLength={30} className={input} />
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium">Label
                  <input value={r.label} onChange={(e) => update(i, { label: e.target.value })} autoComplete="off" maxLength={60} className={input} />
                </label>
                {([["tax", "Tax rate (%)", taxP], ["service", "Service charge (%)", svcP]] as const).map(([k, label, p]) => (
                  <label key={k} className="flex flex-col gap-1 text-sm font-medium">{label}
                    <input inputMode="decimal" autoComplete="off" value={r[k]} onChange={(e) => update(i, { [k]: e.target.value })}
                      aria-invalid={r[k].trim() !== "" && p === null ? true : undefined} className={input} />
                    <span className="text-xs font-normal text-neutral-600 dark:text-neutral-400" aria-live="polite">
                      {r[k].trim() === "" ? "e.g. 10 or 5.5" : p ? `Saves as ${p}` : "Can't read this rate. Use 0–100 with up to two decimals."}
                    </span>
                  </label>
                ))}
              </div>
              <label className="flex min-h-12 items-center gap-3 text-sm">
                <input type="checkbox" className="size-6" checked={r.onService} onChange={(e) => update(i, { onService: e.target.checked })} />
                Tax is computed on subtotal + service charge
              </label>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex min-h-12 items-center gap-3 text-sm">
                  <input type="radio" name="defaultCode" value={codes[i]} className="size-6" checked={i === defaultIdx}
                    onChange={() => setDefaultCode(codes[i])} />
                  Default preset
                </label>
                <button type="button" disabled={rows.length <= 1}
                  onClick={() => { setRows((p) => p.filter((_, j) => j !== i)); if (i === defaultIdx) setDefaultCode(codes.find((_, j) => j !== i) ?? ""); }}
                  className="min-h-12 rounded-lg px-3 text-sm ring-1 ring-neutral-400 disabled:opacity-50">Remove</button>
              </div>
            </li>
          );
        })}
      </ul>
      <input type="hidden" name="presets" value={serialize(rows)} />
      {fieldErrs(state, "presets")?.length ? <p className="text-sm text-red-700 dark:text-red-400">{fieldErrs(state, "presets")!.join(" ")}</p> : null}
      {fieldErrs(state, "defaultCode")?.length ? <p className="text-sm text-red-700 dark:text-red-400">{fieldErrs(state, "defaultCode")!.join(" ")}</p> : null}
      <div>
        <button type="button" disabled={rows.length >= TAX_PRESETS_MAX}
          onClick={() => setRows((p) => [...p, { code: "", label: "", tax: "10", service: "0", onService: true }])}
          className="min-h-12 rounded-lg px-4 text-sm ring-1 ring-neutral-400 disabled:opacity-50">Add preset</button>
        <p className={muted}>{rows.length} of {TAX_PRESETS_MAX}</p>
      </div>
      <Status state={state} />
      <div><Button type="submit" pending={pending}>{pending ? "Saving…" : "Save"}</Button></div>
    </form>
  );
}

export function OwnedOrgCapForm({ action, initial }: { action: AuthAction; initial: PlatformSettings["ownedOrgCap"] }) {
  const [max, setMax] = useState(String(initial.max));
  const [state, formAction, pending] = useActionState(action, null);
  const ok = capInRange(max);
  return (
    <form action={formAction} className={card} aria-labelledby="set-cap">
      <h2 id="set-cap" className="text-lg font-semibold">Restaurants per owner</h2>
      <Field name="max" label={`Maximum (${OWNED_ORG_CAP_RANGE.min}–${OWNED_ORG_CAP_RANGE.max})`} inputMode="numeric" autoComplete="off" value={max}
        onChange={(e) => setMax(e.target.value)} errors={fieldErrs(state, "max")} required
        hint={max.trim() === "" ? "Digits only." : ok ? `Saves as ${capToPostValue(max)}` : `Enter a whole number from ${OWNED_ORG_CAP_RANGE.min} to ${OWNED_ORG_CAP_RANGE.max}.`} />
      <Status state={state} />
      <div><Button type="submit" pending={pending}>{pending ? "Saving…" : "Save"}</Button></div>
    </form>
  );
}
