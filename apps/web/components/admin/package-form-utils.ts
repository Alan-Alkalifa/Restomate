import { currencyExponent } from "@/lib/money";
import type { ActionResult } from "@/components/auth/types";

/**
 * Converts what the admin typed (Rp 250.000, or 12.50 for USD) into digits-only minor units for the
 * server to parse and validate. Returns the raw text when it cannot be read, so the server rejects it
 * with a field error. The result is never trusted: the server is the authority.
 */
export function toMinorUnitsString(input: string, currency: string): string {
  const raw = input.trim();
  if (raw === "") return "";
  let exp: number;
  try {
    exp = currencyExponent(currency);
  } catch {
    return raw;
  }
  if (exp === 0) {
    // Dots, commas and spaces are thousand separators for whole-unit currencies.
    const digits = raw.replace(/[.,\s]/g, "");
    return /^\d+$/.test(digits) ? digits.replace(/^0+(?=\d)/, "") : raw;
  }
  const m = /^(\d[\d.,\s]*?)(?:[.,](\d{1,2}))?$/.exec(raw);
  if (!m) return raw;
  const whole = m[1].replace(/[.,\s]/g, "");
  const frac = (m[2] ?? "").padEnd(exp, "0");
  if (!/^\d+$/.test(whole)) return raw;
  return `${whole}${frac}`.replace(/^0+(?=\d)/, "");
}

/** Prefill for the edit form: minor units back to what an admin would type. */
export function fromMinorUnits(minor: number, currency: string): string {
  let exp: number;
  try {
    exp = currencyExponent(currency);
  } catch {
    return String(minor);
  }
  if (exp === 0) return String(minor);
  const s = String(minor).padStart(exp + 1, "0");
  return `${s.slice(0, -exp)}.${s.slice(-exp)}`;
}

const CODE_MESSAGES: Record<string, string> = {
  DUPLICATE_CODE: "A plan with that code already exists.",
  NOT_FOUND: "That plan no longer exists.",
  PACKAGE_IN_USE: "Plans with subscriptions can't change currency.",
  DEFAULT_PACKAGE: "Set another plan as the default before archiving this one.",
  PACKAGE_INACTIVE: "Restore the plan before making it the default.",
  FORBIDDEN: "You don't have access to do that.",
};

/** Form-level message for a failed action; falls back per the contract's error table. */
export function failureMessage(result: ActionResult | null): string | undefined {
  if (!result || result.ok) return undefined;
  if (result.formError) return result.formError;
  if (result.code && CODE_MESSAGES[result.code]) return CODE_MESSAGES[result.code];
  return result.fieldErrors ? "Check the highlighted fields." : "Could not save the plan. Try again.";
}
