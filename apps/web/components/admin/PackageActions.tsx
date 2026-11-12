"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef } from "react";
import type { AuthAction } from "@/components/auth/types";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { failureMessage } from "./package-form-utils";

const secondary = "min-h-12 rounded-lg px-3 text-sm font-medium ring-1 ring-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800";

export function ArchiveDialog({ action, packageId, name, restore }: { action: AuthAction; packageId: string; name: string; restore: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, null);
  const ok = state?.ok === true;
  useEffect(() => {
    if (ok) {
      ref.current?.close();
      router.refresh();
    }
  }, [ok, router]);
  const verb = restore ? "Restore" : "Archive";
  return (
    <>
      <button type="button" onClick={() => ref.current?.showModal()} className={secondary}>{verb}</button>
      <dialog ref={ref} aria-labelledby={`arch-${packageId}`} className="m-auto w-[min(28rem,92vw)] rounded-xl p-6 backdrop:bg-black/50">
        <form action={formAction} className="flex flex-col gap-4">
          <h2 id={`arch-${packageId}`} className="text-lg font-semibold break-words">{verb} {name}?</h2>
          <p className="text-sm text-neutral-700 dark:text-neutral-300">
            {restore
              ? "The plan becomes available again."
              : "The plan can no longer be chosen by new tenants. Existing subscriptions keep it. You can restore it later."}
          </p>
          <input type="hidden" name="packageId" value={packageId} />
          <input type="hidden" name="archived" value={String(!restore)} />
          <FormAlert message={failureMessage(state)} />
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => ref.current?.close()} disabled={pending} className="min-h-12 rounded-lg px-4 ring-1 ring-neutral-400">Cancel</button>
            <Button type="submit" pending={pending} className={restore ? undefined : "bg-red-700 hover:bg-red-800"}>{pending ? "Saving…" : verb}</Button>
          </div>
        </form>
      </dialog>
    </>
  );
}

export function SetDefaultButton({ action, packageId }: { action: AuthAction; packageId: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, null);
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="packageId" value={packageId} />
      <button type="submit" disabled={pending} aria-busy={pending || undefined} className={`${secondary} disabled:opacity-60`}>
        {pending ? "Saving…" : "Set as default"}
      </button>
      <FormAlert message={failureMessage(state)} />
    </form>
  );
}
