"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import type { AuthAction } from "./types";
import { errorsFor, formErrorOf, useFocusOnError } from "./use-form-focus";

export function ResetPasswordForm({ action, passwordHint }: { action: AuthAction; passwordHint: string }) {
  const [serverState, formAction, pending] = useActionState(action, null);
  const [mismatch, setMismatch] = useState(false);
  const formRef = useFocusOnError(serverState);

  // Client check is only a hint; the server action is authoritative.
  const guard: React.FormEventHandler<HTMLFormElement> = (e) => {
    const fd = new FormData(e.currentTarget);
    if (fd.get("password") !== fd.get("confirmPassword")) {
      e.preventDefault();
      setMismatch(true);
      requestAnimationFrame(() =>
        formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
    } else {
      setMismatch(false);
    }
  };

  if (serverState?.ok) {
    return (
      <div className="flex flex-col gap-4">
        <FormAlert tone="info" message="Your password has been updated." />
        <Link href="/" className="underline">Continue</Link>
      </div>
    );
  }

  return (
    <form ref={formRef} action={formAction} onSubmit={guard} noValidate className="flex flex-col gap-4">
      <FormAlert message={formErrorOf(serverState)} />
      <Field name="password" label="New password" type="password" autoComplete="new-password" required hint={passwordHint} errors={errorsFor(serverState, "password")} />
      <Field
        name="confirmPassword"
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        required
        errors={mismatch ? ["Passwords do not match."] : errorsFor(serverState, "confirmPassword")}
      />
      <Button type="submit" pending={pending}>
        {pending ? "Saving…" : "Set new password"}
      </Button>
    </form>
  );
}
