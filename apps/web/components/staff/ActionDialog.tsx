"use client";

import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { isPlanLimit, staffErrorMessage } from "./errors";
import { FieldErrorsContext, fieldErrorsOf, unclaimedFieldErrors } from "./field-errors";
import type { StaffAction, StaffActionResult } from "./types";

/** Generic confirm/edit dialog: native <dialog>, pending-disabled submit, refresh on success. */
export function ActionDialog({
  label,
  title,
  description,
  action,
  hidden = {},
  submitLabel,
  destructive,
  upgradeHref,
  fields = [],
  children,
}: {
  label: string;
  title: string;
  description?: string;
  action: StaffAction;
  hidden?: Record<string, string>;
  submitLabel: string;
  destructive?: boolean;
  upgradeHref?: string;
  /** Field names that render their own inline error inside `children`; any other field error goes in the summary alert. */
  fields?: readonly string[];
  children?: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [state, formAction, pending] = useActionState<StaffActionResult | null, FormData>(action, null);
  const ok = state?.ok === true;
  useEffect(() => {
    if (ok) {
      ref.current?.close();
      router.refresh();
    }
  }, [ok, router]);
  const summary = unclaimedFieldErrors(state, fields);
  const alert = [staffErrorMessage(state), ...summary].filter(Boolean).join(" ") || undefined;
  return (
    <>
      <button type="button" onClick={() => ref.current?.showModal()} className="min-h-12 rounded-lg px-3 text-sm font-medium ring-1 ring-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800">
        {label}
      </button>
      <dialog ref={ref} aria-labelledby={`dlg-${title}`} className="m-auto w-[min(30rem,92vw)] rounded-xl p-6 backdrop:bg-black/50">
        <form
          noValidate
          onSubmit={(e) => {
            // Submit through a transition instead of <form action>: React 19 resets uncontrolled inputs after an
            // action finishes, which would wipe what the user typed when the server returns an error.
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            startTransition(() => formAction(data));
          }}
          className="flex flex-col gap-4"
        >
          <h2 id={`dlg-${title}`} className="text-lg font-semibold break-words">{title}</h2>
          {description && <p className="text-sm">{description}</p>}
          {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <FormAlert message={alert} />
          {isPlanLimit(state) && upgradeHref && <a href={upgradeHref} className="text-sm underline">View plans</a>}
          <FieldErrorsContext value={fieldErrorsOf(state)}>{children}</FieldErrorsContext>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => ref.current?.close()} disabled={pending} className="min-h-12 rounded-lg px-4 ring-1 ring-neutral-400">Cancel</button>
            <Button type="submit" pending={pending} className={destructive ? "bg-red-700 hover:bg-red-800" : undefined}>
              {pending ? "Saving…" : submitLabel}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
