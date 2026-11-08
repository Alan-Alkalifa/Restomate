"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import type { AuthAction } from "./types";
import { errorsFor, formErrorOf, useFocusOnError } from "./use-form-focus";

export function LoginForm({
  action,
  next,
  initialError,
}: {
  action: AuthAction;
  next?: string;
  initialError?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const formRef = useFocusOnError(state);
  return (
    <form ref={formRef} action={formAction} noValidate className="flex flex-col gap-4">
      {next && <input type="hidden" name="next" value={next} />}
      <FormAlert message={formErrorOf(state) ?? initialError} />
      <Field name="email" label="Email" type="email" autoComplete="email" required errors={errorsFor(state, "email")} />
      <Field name="password" label="Password" type="password" autoComplete="current-password" required errors={errorsFor(state, "password")} />
      <Button type="submit" pending={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <p className="flex flex-wrap justify-between gap-2 text-sm">
        <Link href="/forgot-password" className="underline">Forgot password?</Link>
        <span>
          No account? <Link href="/signup" className="underline">Create one</Link>
        </span>
      </p>
    </form>
  );
}
