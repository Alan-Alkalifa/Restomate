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

export function LoginForm({
  action,
  next,
  initialError,
  t,
  locale,
  signupOpen = true,
}: {
  action: AuthAction;
  next?: string;
  initialError?: string;
  t: AuthDictionary["login"];
  locale: Locale;
  /** Cosmetic only: the signUp action refuses when sign-ups are closed. */
  signupOpen?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const formRef = useFocusOnError(state);
  return (
    <form ref={formRef} action={formAction} noValidate className="flex flex-col gap-4">
      {next && <input type="hidden" name="next" value={next} />}
      <FormAlert message={formErrorOf(state) ?? initialError} />
      <Field name="email" label={t.email} type="email" autoComplete="email" required errors={errorsFor(state, "email")} />
      <Field name="password" label={t.password} type="password" autoComplete="current-password" required errors={errorsFor(state, "password")} />
      <Button type="submit" pending={pending}>
        {pending ? t.pending : t.submit}
      </Button>
      <p className="flex flex-wrap justify-between gap-2 text-sm">
        <Link href={localePath(locale, "/forgot-password")} className="underline">{t.forgot}</Link>
        {signupOpen ? (
          <span>
            {t.noAccount} <Link href={localePath(locale, "/signup")} className="underline">{t.createOne}</Link>
          </span>
        ) : null}
      </p>
    </form>
  );
}
