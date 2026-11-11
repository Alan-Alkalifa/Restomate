"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import type { AuthDictionary } from "@/i18n/types";
import { localePath, type Locale } from "@/i18n/config";
import { fmt } from "@/i18n/config";
import type { AuthAction } from "./types";
import { errorsFor, formErrorOf, useFocusOnError } from "./use-form-focus";

const RESEND_DELAY_S = 60;

function ResendHint({ onRetry, t }: { onRetry: () => void; t: AuthDictionary["signup"] }) {
  const [secondsLeft, setSecondsLeft] = useState(RESEND_DELAY_S);
  useEffect(() => {
    const t = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  return secondsLeft > 0 ? (
    <span>{fmt(t.retryIn, { seconds: secondsLeft })}</span>
  ) : (
    <button type="button" className="underline" onClick={onRetry}>
      {t.retry}
    </button>
  );
}

export function SignupForm({ action, next, passwordHint, t, locale }: { action: AuthAction; next?: string; passwordHint: string; t: AuthDictionary["signup"]; locale: Locale }) {
  const [state, formAction, pending] = useActionState(action, null);
  const formRef = useFocusOnError(state);
  const [dismissed, setDismissed] = useState<typeof state>(null);
  const sent = state?.ok === true && dismissed !== state;

  if (sent) {
    return (
      <div className="flex flex-col gap-4">
        <FormAlert tone="info" message={t.checkEmail} />
        <p className="text-sm">
          {t.noEmail}{" "}
          <ResendHint onRetry={() => setDismissed(state)} t={t} />
        </p>
      </div>
    );
  }

  return (
    <form ref={formRef} action={formAction} noValidate className="flex flex-col gap-4">
      {next && <input type="hidden" name="next" value={next} />}
      <FormAlert message={formErrorOf(state)} />
      <Field name="fullName" label={t.fullName} autoComplete="name" required errors={errorsFor(state, "fullName")} />
      <Field name="email" label={t.email} type="email" autoComplete="email" required errors={errorsFor(state, "email")} />
      <Field name="password" label={t.password} type="password" autoComplete="new-password" required hint={passwordHint} errors={errorsFor(state, "password")} />
      <Button type="submit" pending={pending}>
        {pending ? t.pending : t.submit}
      </Button>
      <p className="text-sm">
        {t.haveAccount} <Link href={localePath(locale, "/login")} className="underline">{t.signIn}</Link>
      </p>
    </form>
  );
}
