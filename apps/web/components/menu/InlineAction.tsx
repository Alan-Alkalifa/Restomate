"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { FormAlert } from "@/components/ui/form-alert";
import { allFieldErrors, menuErrorMessage } from "./errors";
import type { ActionResult, BoundMenuAction } from "./types";
import { useOnline } from "./use-online";

const BTN = "min-h-12 min-w-12 rounded-lg px-3 text-sm font-medium ring-1 ring-neutral-400 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-neutral-800";

/** A one-button action (toggle, move up/down). Ids and values are hidden fields; a rejection is shown under the button. */
export function InlineAction({
  action,
  fields,
  label,
  ariaLabel,
  disabled,
  pressed,
}: {
  action: BoundMenuAction;
  /** Repeated values are allowed: `{ itemIds: ["a", "b"] }` posts itemIds twice. */
  fields: Record<string, string | string[]>;
  label: string;
  ariaLabel?: string;
  disabled?: boolean;
  pressed?: boolean;
}) {
  const router = useRouter();
  const online = useOnline();
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(action, null);
  const ok = state?.ok === true;
  useEffect(() => {
    if (ok) router.refresh();
  }, [state, ok, router]);
  const message = [menuErrorMessage(state), ...allFieldErrors(state)].filter(Boolean).join(" ") || undefined;
  return (
    <form action={formAction} className="flex flex-col gap-1">
      {Object.entries(fields).flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((x, i) => <input key={`${k}-${i}`} type="hidden" name={k} value={x} />))}
      <button type="submit" aria-label={ariaLabel} aria-pressed={pressed} aria-busy={pending || undefined} disabled={disabled || pending || !online} className={BTN}>
        {pending ? "…" : label}
      </button>
      <FormAlert message={message} />
    </form>
  );
}
