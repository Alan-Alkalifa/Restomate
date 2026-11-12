"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import type { AuthDictionary } from "@/i18n/types";
import { localePath, type Locale } from "@/i18n/config";
import type { AuthAction } from "./types";
import { errorsFor, formErrorOf, useFocusOnError } from "./use-form-focus";

export function ForgotPasswordForm({ action, t, locale }: { action: AuthAction; t: AuthDictionary["forgot"]; locale: Locale }) {
  const [state, formAction, pending] = useActionState(action, null);
  const formRef = useFocusOnError(state);

  // Same confirmation for every valid submission, so it never reveals whether an account exists.
  if (state?.ok) {
    return (
      <div className="flex flex-col gap-4">
        <FormAlert tone="info" message={t.sent} />
        <Link href={localePath(locale, "/login")} className="text-sm underline">{t.back}</Link>
      </div>
    );
  }

  return (
    <form ref={formRef} action={formAction} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="locale" value={locale} />
      <FormAlert message={formErrorOf(state)} />
      <Field name="email" label={t.email} type="email" autoComplete="email" required errors={errorsFor(state, "email")} />
      <Button type="submit" pending={pending}>
        {pending ? t.pending : t.submit}
      </Button>
      <Link href={localePath(locale, "/login")} className="text-sm underline">{t.back}</Link>
    </form>
  );
}
