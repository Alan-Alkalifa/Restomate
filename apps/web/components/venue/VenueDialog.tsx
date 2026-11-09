"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { useFocusOnError } from "@/components/auth/use-form-focus";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { isPlanLimit, venueErrorMessage } from "./errors";
import type { ActionResult, BoundVenueAction } from "./types";

const TRIGGER = "min-h-12 min-w-12 rounded-lg px-3 text-sm font-medium ring-1 ring-neutral-400 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-neutral-800";

type Props = {
  triggerLabel: string;
  /** Spoken name for the trigger when the visible text is not enough ("Rename Terrace"). */
  triggerAriaLabel?: string;
  primary?: boolean;
  title: string;
  description?: string;
  action: BoundVenueAction;
  /** Ids from server data only. Never an organization id. */
  hidden?: Record<string, string>;
  submitLabel: string;
  destructive?: boolean;
  offline?: boolean;
  disabled?: boolean;
  upgradeHref?: string;
  onSuccess?: () => void;
  /** Form fields; receives the last result so fields can show their own errors. */
  children?: (state: ActionResult | null) => React.ReactNode;
};

/**
 * Trigger button + native <dialog>. The form is mounted only while the dialog is open, so every opening starts with
 * fresh state (no stale error, no double-submit leftovers). Refreshes the route from the server on success.
 */
export function VenueDialog(props: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const titleId = `dlg-${props.title.replace(/\W+/g, "-")}`;
  return (
    <>
      <button
        type="button"
        disabled={props.disabled}
        aria-label={props.triggerAriaLabel}
        onClick={() => {
          setOpen(true);
          ref.current?.showModal();
        }}
        className={props.primary ? "min-h-12 rounded-lg bg-teal-700 px-4 text-base font-semibold text-white hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:cursor-not-allowed disabled:opacity-60" : TRIGGER}
      >
        {props.triggerLabel}
      </button>
      <dialog ref={ref} aria-labelledby={titleId} onClose={() => setOpen(false)} className="m-auto w-[min(30rem,92vw)] rounded-xl p-6 backdrop:bg-black/50">
        {open && <DialogBody {...props} titleId={titleId} close={() => ref.current?.close()} />}
      </dialog>
    </>
  );
}

function DialogBody({ titleId, close, ...p }: Props & { titleId: string; close: () => void }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(p.action, null);
  const formRef = useFocusOnError(state);
  const done = useRef(false);
  const ok = state?.ok === true;
  const { onSuccess } = p;
  useEffect(() => {
    if (!ok || done.current) return;
    done.current = true;
    onSuccess?.();
    router.refresh();
    close();
  }, [ok, onSuccess, router, close]);
  return (
    <form ref={formRef} action={formAction} noValidate className="flex flex-col gap-4">
      <h2 id={titleId} className="text-lg font-semibold break-words">{p.title}</h2>
      {p.description && <p className="text-sm">{p.description}</p>}
      {Object.entries(p.hidden ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <FormAlert message={venueErrorMessage(state)} />
      {isPlanLimit(state) && p.upgradeHref && (
        <Link href={p.upgradeHref} className="flex min-h-12 items-center text-sm font-medium underline">View plans</Link>
      )}
      {p.offline && <p role="status" className="text-sm text-amber-800 dark:text-amber-300">You&apos;re offline. Reconnect to save.</p>}
      {p.children?.(state)}
      <div className="flex justify-end gap-3">
        <button type="button" onClick={close} disabled={pending} className="min-h-12 rounded-lg px-4 ring-1 ring-neutral-400">Cancel</button>
        <Button type="submit" pending={pending} disabled={p.offline} className={p.destructive ? "bg-red-700 hover:bg-red-800" : undefined}>
          {pending ? "Saving…" : p.submitLabel}
        </Button>
      </div>
    </form>
  );
}
