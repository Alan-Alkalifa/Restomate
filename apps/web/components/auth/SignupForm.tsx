"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import type { AuthAction } from "./types";
import { errorsFor, formErrorOf, useFocusOnError } from "./use-form-focus";

const RESEND_DELAY_S = 60;

function ResendHint({ onRetry }: { onRetry: () => void }) {
  const [secondsLeft, setSecondsLeft] = useState(RESEND_DELAY_S);
  useEffect(() => {
    const t = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);
  return secondsLeft > 0 ? (
    <span>You can try again in {secondsLeft}s.</span>
  ) : (
    <button type="button" className="underline" onClick={onRetry}>
      Use a different email or try again
    </button>
  );
}

export function SignupForm({ action, next }: { action: AuthAction; next?: string }) {
  const [state, formAction, pending] = useActionState(action, null);
  const formRef = useFocusOnError(state);
  const [dismissed, setDismissed] = useState<typeof state>(null);
  const sent = state?.ok === true && dismissed !== state;

  if (sent) {
    return (
      <div className="flex flex-col gap-4">
        <FormAlert tone="info" message="Check your email. We sent a link to confirm your account." />
        <p className="text-sm">
          Didn&apos;t get it? Check your spam folder.{" "}
          <ResendHint onRetry={() => setDismissed(state)} />
        </p>
      </div>
    );
  }

  return (
    <form ref={formRef} action={formAction} noValidate className="flex flex-col gap-4">
      {next && <input type="hidden" name="next" value={next} />}
      <FormAlert message={formErrorOf(state)} />
      <Field name="fullName" label="Full name" autoComplete="name" required errors={errorsFor(state, "fullName")} />
      <Field name="email" label="Email" type="email" autoComplete="email" required errors={errorsFor(state, "email")} />
      <Field name="password" label="Password" type="password" autoComplete="new-password" minLength={8} required hint="At least 8 characters." errors={errorsFor(state, "password")} />
      <Button type="submit" pending={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
      <p className="text-sm">
        Already have an account? <Link href="/login" className="underline">Sign in</Link>
      </p>
    </form>
  );
}
