import { currencyExponent, formatMoney } from "@/lib/money";
import type { ActionResult } from "@/components/auth/types";

/** Plain digits, or 1–3 digits followed by 3-digit groups that all use the same separator (. or ,). */
function parseWhole(text: string): string | null {
  if (/^\d+$/.test(text)) return text;
  const m = /^(\d{1,3})((?:([.,])\d{3})(?:\3\d{3})*)$/.exec(text);
  return m ? m[1] + m[2].replace(/[.,]/g, "") : null;
}

const stripZeros = (d: string) => d.replace(/^0+(?=\d)/, "");

/**
 * Converts what the admin typed (Rp 250.000, or 12.50 for USD) into digits-only minor units for the
 * server to parse and validate. Only plain digits or correct 3-digit thousand groups are converted
 * (a trailing ,00 / .00 is dropped for whole-unit currencies). Anything ambiguous is returned raw so
 * the server answers with a field error instead of saving a wrong amount. The server stays the authority.
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
    const whole = parseWhole(raw.replace(/[.,]00$/, ""));
    return whole === null ? raw : stripZeros(whole);
  }
  const m = /^(.*?)(?:[.,](\d{1,2}))?$/.exec(raw);
  const whole = m ? parseWhole(m[1]) : null;
  if (!m || whole === null) return raw;
  return stripZeros(whole + (m[2] ?? "").padEnd(exp, "0"));
}

/** "Rp 25.000" for what will be saved, or null when the text cannot be read as an amount. */
export function previewMoney(input: string, currency: string): string | null {
  const minor = toMinorUnitsString(input, currency);
  if (!/^\d+$/.test(minor) || !Number.isSafeInteger(Number(minor))) return null;
  try {
    return formatMoney(Number(minor), currency);
  } catch {
    return null;
  }
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
