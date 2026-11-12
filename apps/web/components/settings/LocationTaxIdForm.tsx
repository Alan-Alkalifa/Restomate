"use client";

import { useActionState, useState } from "react";
import { errorsFor, useFocusOnError } from "@/components/auth/use-form-focus";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { fmt } from "@/i18n/config";
import type { SettingsDictionary } from "@/i18n/types";
import type { ActionResult } from "@/lib/auth/schemas";
import { displayTaxId, localizeTaxIdError, previewTaxId } from "./tax-id-form";

/** A bound Server Action: orgSlug and locationId are applied on the server. The only field the client sends is `taxId`. */
export type TaxIdAction = (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;

/**
 * One location's NPWP (tax id). Editable only with `canEdit` (locations.manage); everyone else gets the formatted value,
 * read-only, and NO form at all. The server enforces the permission regardless (a refused save says so; it never looks like
 * success). Typing may include dots, dashes and spaces; empty clears. The preview says exactly what Save will store
 * ("Saves as 12.345.678.9-012.345") before anything is posted, and a value the server would refuse is not posted.
 */
export function LocationTaxIdForm({ locationName, taxId, canEdit, action, t }: {
  locationName: string; taxId: string | null; canEdit: boolean; action: TaxIdAction; t: SettingsDictionary["taxId"];
}) {
  const [saved, setSaved] = useState<string | null>(taxId);
  const [draft, setDraft] = useState(displayTaxId(taxId));
  const [outcome, setOutcome] = useState<"saved" | "cleared" | null>(null);
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(async (prev, fd) => {
    try {
      const result = await action(prev, fd);
      if (result.ok) {
        const p = previewTaxId(String(fd.get("taxId") ?? ""), saved);
        const next = p.kind === "set" ? p.digits : p.kind === "clear" ? null : saved;
        setSaved(next);
        setDraft(displayTaxId(next)); // show the stored form, whatever separators were typed
        setOutcome(next === null ? "cleared" : "saved");
      } else {
        setOutcome(null);
      }
      return result;
    } catch {
      setOutcome(null);
      return { ok: false, formError: t.errors.failed }; // dropped request: nothing was saved, try again
    }
  }, null);
  const formRef = useFocusOnError(state);

  const heading = <h3 className="text-base font-semibold">{t.label}</h3>;
  if (!canEdit) {
    return (
      <div className="flex flex-col gap-1">
        {heading}
        <p className="text-base tabular-nums">{displayTaxId(saved) || <span className="text-neutral-600 dark:text-neutral-400">{t.notSet}</span>}</p>
        <p className="text-xs text-neutral-600 dark:text-neutral-400">{t.readOnly}</p>
      </div>
    );
  }

  const preview = previewTaxId(draft, saved);
  const serverError = state && !state.ok ? state : null;
  const fieldErrors = errorsFor(state, "taxId")?.map((m) => localizeTaxIdError(m, t.errors));
  const localError = preview.kind === "invalid" && draft.trim() !== "" ? [preview.reason === "chars" ? t.errors.chars : t.errors.length] : undefined;
  const formError = serverError && !serverError.fieldErrors?.taxId ? (serverError.code === "FORBIDDEN" ? t.errors.forbidden : (serverError.formError ?? t.errors.failed)) : undefined;
  const canSave = !pending && (preview.kind === "set" || preview.kind === "clear");

  return (
    <form ref={formRef} action={formAction} noValidate className="flex flex-col gap-2" aria-label={`${t.label}: ${locationName}`}>
      {heading}
      <FormAlert message={formError} />
      <Field
        name="taxId" label={t.label} value={draft} onChange={(e) => { setDraft(e.target.value); setOutcome(null); }}
        inputMode="numeric" autoComplete="off" maxLength={40} placeholder={t.placeholder} hint={t.hint}
        errors={localError ?? fieldErrors}
      />
      {/* Always mounted so assistive technology announces the change when the text appears. */}
      <p role="status" aria-live="polite" className="min-h-5 text-sm">
        {preview.kind === "set" ? fmt(t.previewSet, { value: preview.formatted })
          : preview.kind === "clear" ? t.previewClear
          : outcome === "saved" ? t.saved : outcome === "cleared" ? t.cleared : ""}
      </p>
      <Button type="submit" pending={pending} disabled={!canSave} className="self-start">{pending ? t.saving : t.save}</Button>
    </form>
  );
}
