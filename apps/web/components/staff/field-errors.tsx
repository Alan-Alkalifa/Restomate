"use client";

import { createContext, useContext } from "react";
import type { StaffActionResult } from "./types";

type Errors = Record<string, string[]>;

/** Field errors of the last action result, provided by ActionDialog to the fields inside it. */
export const FieldErrorsContext = createContext<Errors>({});

export function fieldErrorsOf(r: StaffActionResult | null): Errors {
  return r && !r.ok && r.fieldErrors ? r.fieldErrors : {};
}

const LABELS: Record<string, string> = {
  email: "Email",
  roleId: "Role",
  allLocations: "Locations",
  locationIds: "Locations",
  memberId: "Team member",
  invitationId: "Invitation",
};

/**
 * Errors for fields that have no visible input in this dialog (hidden ids, or a field the dialog does not render),
 * so they become a summary alert instead of failing silently.
 */
export function unclaimedFieldErrors(r: StaffActionResult | null, claimed: readonly string[]): string[] {
  const out: string[] = [];
  for (const [name, msgs] of Object.entries(fieldErrorsOf(r))) {
    if (claimed.includes(name) || !msgs?.length) continue;
    const label = LABELS[name];
    out.push(label ? `${label}: ${msgs.join(" ")}` : msgs.join(" "));
  }
  return out;
}

/** Inline error for one or more field names; render it right below the field. */
export function FieldError({ name, id }: { name: string | readonly string[]; id?: string }) {
  const all = useContext(FieldErrorsContext);
  const names = typeof name === "string" ? [name] : name;
  const msgs = names.flatMap((n) => all[n] ?? []);
  if (!msgs.length) return null;
  return <p id={id} data-field-error className="text-sm text-red-700 dark:text-red-400">{msgs.join(" ")}</p>;
}
