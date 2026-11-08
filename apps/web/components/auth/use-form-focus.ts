"use client";

import { useEffect, useRef } from "react";
import type { ActionResult } from "./types";

/** After a failed submit, move focus to the first invalid field, else the form alert. */
export function useFocusOnError(state: ActionResult | null) {
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state || state.ok) return;
    const target =
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]') ??
      formRef.current?.querySelector<HTMLElement>("[data-form-alert]");
    target?.focus();
  }, [state]);
  return formRef;
}

export function errorsFor(state: ActionResult | null, name: string) {
  return state && !state.ok ? state.fieldErrors?.[name] : undefined;
}

export function formErrorOf(state: ActionResult | null) {
  return state && !state.ok ? state.formError : undefined;
}
