"use client";

import { useActionState, useRef } from "react";
import type { ActionResult, AuthAction } from "@/components/auth/types";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";

export const RESET_SUCCESS = "If the address exists, a reset email is on its way.";

const MESSAGES: Record<string, string> = {
  RATE_LIMITED: "Too many attempts. Try again later.",
  NOT_FOUND: "That owner no longer exists.",
  FORBIDDEN: "You don't have access to do that.",
};

export function resetFailureMessage(state: ActionResult | null): string | undefined {
  if (!state || state.ok) return undefined;
  if (state.formError) return state.formError;
  if (state.code && MESSAGES[state.code]) return MESSAGES[state.code];
  return state.fieldErrors ? "Could not send the reset email. Reload and try again." : "Could not send the reset email. Try again.";
}

export function OwnerResetDialog({ action, orgId, userId, ownerName }: { action: AuthAction; orgId: string; userId: string; ownerName: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action, null);
  const ok = state?.ok === true;
  const titleId = `reset-${userId}`;
  return (
    <>
      <button type="button" onClick={() => ref.current?.showModal()} className="min-h-12 rounded-lg px-3 text-sm font-medium ring-1 ring-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800">
        Send password reset
      </button>
      <dialog ref={ref} aria-labelledby={titleId} className="m-auto w-[min(28rem,92vw)] rounded-xl p-6 backdrop:bg-black/50">
        <form action={formAction} className="flex flex-col gap-4">
          <h2 id={titleId} className="text-lg font-semibold break-words">Send a password reset to {ownerName}?</h2>
          <p className="text-sm text-neutral-700 dark:text-neutral-300">They get an email with a link to choose a new password. This is recorded in the audit trail.</p>
          {/* Only these two fields are posted; the server checks that the user is an active owner of the organization. */}
          <input type="hidden" name="orgId" value={orgId} />
          <input type="hidden" name="userId" value={userId} />
          <FormAlert message={ok ? RESET_SUCCESS : resetFailureMessage(state)} tone={ok ? "info" : "error"} />
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => ref.current?.close()} disabled={pending} className="min-h-12 rounded-lg px-4 ring-1 ring-neutral-400">{ok ? "Close" : "Cancel"}</button>
            {ok ? null : <Button type="submit" pending={pending}>{pending ? "Sending…" : "Send reset email"}</Button>}
          </div>
        </form>
      </dialog>
    </>
  );
}
