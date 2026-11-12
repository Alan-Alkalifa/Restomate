"use client";

import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import { hiddenFieldErrors, menuErrorMessage } from "./errors";
import type { ActionResult, BoundMenuAction } from "./types";
import { useOnline } from "./use-online";

const TRIGGER = "min-h-12 min-w-12 rounded-lg px-3 text-sm font-medium ring-1 ring-neutral-400 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-neutral-800";

type Props = {
  triggerLabel: string;
  triggerAriaLabel?: string;
  primary?: boolean;
  title: string;
  description?: string;
  action: BoundMenuAction;
  /** Ids from server data only. Never an organization id. */
  hidden?: Record<string, string>;
  submitLabel: string;
  /** Client-side validation: false disables Save (the reason must be visible in the form). */
  canSubmit?: boolean;
  onOpen?: () => void;
  wide?: boolean;
  /** Form fields; receives the last result so fields can show their own errors. */
  children: (state: ActionResult | null) => React.ReactNode;
};

/**
 * Trigger + native <dialog>. The form is mounted only while open, so each opening starts fresh. Submits via onSubmit
 * (not <form action>) so React never resets what the user typed when the server rejects. Field errors without a
 * visible field are listed in the summary alert, so nothing fails silently (#67).
 */
export function MenuDialog(props: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const titleId = `dlg-${props.title.replace(/\W+/g, "-")}`;
  return (
    <>
      <button
        type="button"
        aria-label={props.triggerAriaLabel}
        onClick={() => {
          props.onOpen?.();
          setOpen(true);
          ref.current?.showModal();
        }}
        className={props.primary ? "min-h-12 rounded-lg bg-teal-700 px-4 text-base font-semibold text-white hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700" : TRIGGER}
      >
        {props.triggerLabel}
      </button>
      <dialog ref={ref} aria-labelledby={titleId} onClose={() => setOpen(false)} className={`m-auto max-h-[90vh] overflow-y-auto rounded-xl p-6 backdrop:bg-black/50 ${props.wide ? "w-[min(40rem,94vw)]" : "w-[min(30rem,94vw)]"}`}>
        {open && <Body {...props} titleId={titleId} close={() => ref.current?.close()} />}
      </dialog>
    </>
  );
}

function Body({ titleId, close, ...p }: Props & { titleId: string; close: () => void }) {
  const router = useRouter();
  const online = useOnline();
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(p.action, null);
  const formRef = useRef<HTMLFormElement>(null);
  const [summary, setSummary] = useState<string[]>([]);
  const done = useRef(false);
  const ok = state?.ok === true;
  useEffect(() => {
    if (!ok || done.current) return;
    done.current = true;
    router.refresh();
    close();
  }, [ok, router, close]);
  useEffect(() => {
    const next = hiddenFieldErrors(state, formRef.current);
    setSummary((cur) => (cur.join("|") === next.join("|") ? cur : next));
    if (state && !state.ok) {
      const t = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? formRef.current?.querySelector<HTMLElement>("[data-form-alert]");
      t?.focus();
    }
  }, [state]);
  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (pending || !online || p.canSubmit === false) return;
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
      className="flex flex-col gap-4"
    >
      <h2 id={titleId} className="text-lg font-semibold break-words">{p.title}</h2>
      {p.description && <p className="text-sm">{p.description}</p>}
      {Object.entries(p.hidden ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <FormAlert message={[menuErrorMessage(state), ...summary].filter(Boolean).join(" ") || undefined} />
      {!online && <p role="status" className="text-sm text-amber-800 dark:text-amber-300">You&apos;re offline. Reconnect to save.</p>}
      {p.children(state)}
      <div className="flex justify-end gap-3">
        <button type="button" onClick={close} disabled={pending} className="min-h-12 rounded-lg px-4 ring-1 ring-neutral-400">Cancel</button>
        <Button type="submit" pending={pending} disabled={!online || p.canSubmit === false}>{pending ? "Saving…" : p.submitLabel}</Button>
      </div>
    </form>
  );
}
