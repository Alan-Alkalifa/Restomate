"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import type { AuthAction } from "./types";
import { errorsFor, formErrorOf, useFocusOnError } from "./use-form-focus";

export function ForgotPasswordForm({ action }: { action: AuthAction }) {
  const [state, formAction, pending] = useActionState(action, null);
  const formRef = useFocusOnError(state);

  // Same confirmation for every valid submission, so it never reveals whether an account exists.
  if (state?.ok) {
    return (
      <div className="flex flex-col gap-4">
        <FormAlert tone="info" message="If an account exists for that email, we sent a link to reset your password." />
        <Link href="/login" className="text-sm underline">Back to sign in</Link>
      </div>
    );
  }

  return (
    <form ref={formRef} action={formAction} noValidate className="flex flex-col gap-4">
      <FormAlert message={formErrorOf(state)} />
      <Field name="email" label="Email" type="email" autoComplete="email" required errors={errorsFor(state, "email")} />
      <Button type="submit" pending={pending}>
        {pending ? "Sending…" : "Send reset link"}
      </Button>
      <Link href="/login" className="text-sm underline">Back to sign in</Link>
    </form>
  );
}
