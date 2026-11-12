import { currencyExponent } from "@/lib/money";

/**
 * Parsing typed text into minor units lives in `parseMoneyInput` from "@/lib/money" (string handling only, no floats):
 * import it from there. This file only has the reverse, for filling an input.
 */

/** Minor units -> the plain text shown in an input (digits only for IDR). */
export function formatMoneyInput(minor: number, currency: string): string {
  const exp = currencyExponent(currency);
  const neg = minor < 0;
  const digits = String(Math.abs(minor)).padStart(exp + 1, "0");
  const body = exp === 0 ? digits : `${digits.slice(0, -exp)}.${digits.slice(-exp)}`;
  return neg ? `-${body}` : body;
}
