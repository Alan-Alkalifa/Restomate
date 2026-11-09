"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { isPlanLimit, staffErrorMessage } from "./errors";
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
  return (
    <>
      <button type="button" onClick={() => ref.current?.showModal()} className="min-h-12 rounded-lg px-3 text-sm font-medium ring-1 ring-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800">
        {label}
      </button>
      <dialog ref={ref} aria-labelledby={`dlg-${title}`} className="m-auto w-[min(30rem,92vw)] rounded-xl p-6 backdrop:bg-black/50">
        <form action={formAction} className="flex flex-col gap-4">
          <h2 id={`dlg-${title}`} className="text-lg font-semibold break-words">{title}</h2>
          {description && <p className="text-sm">{description}</p>}
          {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <FormAlert message={staffErrorMessage(state)} />
          {isPlanLimit(state) && upgradeHref && <a href={upgradeHref} className="text-sm underline">View plans</a>}
          {children}
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
