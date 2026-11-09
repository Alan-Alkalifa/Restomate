"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef } from "react";
import type { ActionResult, AuthAction } from "@/components/auth/types";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";

export const MIN_REASON = 5;

export function StatusDialog({
  action,
  orgId,
  orgName,
  target,
}: {
  action: AuthAction;
  orgId: string;
  orgName: string;
  target: "suspended" | "active";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action, null);
  const suspending = target === "suspended";
  const ok = state?.ok === true;

  useEffect(() => {
    if (ok) {
      ref.current?.close();
      router.refresh();
    }
  }, [ok, router]);

  const reasonErrors = state && !state.ok ? state.fieldErrors?.reason : undefined;
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        className="min-h-12 rounded-lg px-3 text-sm font-medium ring-1 ring-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
      >
        {suspending ? "Suspend" : "Reactivate"}
      </button>
      <dialog ref={ref} aria-labelledby={`dlg-${orgId}`} className="m-auto w-[min(28rem,92vw)] rounded-xl p-6 backdrop:bg-black/50">
        <form action={formAction} className="flex flex-col gap-4">
          <h2 id={`dlg-${orgId}`} className="text-lg font-semibold break-words">
            {suspending ? "Suspend" : "Reactivate"} {orgName}?
          </h2>
          <input type="hidden" name="orgId" value={orgId} />
          <input type="hidden" name="status" value={target} />
          <FormAlert message={state && !state.ok ? state.formError : undefined} />
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Reason {suspending ? `(at least ${MIN_REASON} characters)` : "(optional)"}
            <textarea
              name="reason"
              rows={3}
              required={suspending}
              minLength={suspending ? MIN_REASON : undefined}
              aria-invalid={reasonErrors?.length ? true : undefined}
              className="rounded-lg border border-neutral-400 bg-transparent p-2 font-normal"
            />
            {reasonErrors?.length ? <span className="text-sm text-red-700 dark:text-red-400">{reasonErrors.join(" ")}</span> : null}
          </label>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => ref.current?.close()} disabled={pending} className="min-h-12 rounded-lg px-4 ring-1 ring-neutral-400">
              Cancel
            </button>
            <Button type="submit" pending={pending} className={suspending ? "bg-red-700 hover:bg-red-800" : undefined}>
              {pending ? "Saving…" : suspending ? "Suspend" : "Reactivate"}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
