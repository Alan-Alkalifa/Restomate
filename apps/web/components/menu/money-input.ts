import { currencyExponent } from "@/lib/money";

/**
 * SEAM: replace with `parseMoneyInput` from "@/lib/money" once DAVIN adds it. String handling only, no floats.
 * Typed text -> integer minor units. For IDR (exponent 0) the whole-rupiah value IS the minor-unit value.
 */
export const MAX_MINOR = 1_000_000_000_000;

export type MoneyParse = { ok: true; value: number } | { ok: false; message: string };

export function parseMoneyInput(text: string, currency: string, opts: { allowNegative?: boolean } = {}): MoneyParse {
  const exp = currencyExponent(currency);
  let s = text.trim().replace(/^(rp\.?|idr)\s*/i, "").replace(/\s/g, "");
  if (!s) return { ok: false, message: "Enter an amount." };
  let neg = false;
  if (s[0] === "-" || s[0] === "−") {
    neg = true;
    s = s.slice(1);
  }
  if (neg && !opts.allowNegative) return { ok: false, message: "Enter 0 or more." };
  const shape = exp === 0 ? /^(\d{1,3}(?:[.,]\d{3})+|\d+)$/ : new RegExp(`^(\\d{1,3}(?:[.,]\\d{3})+|\\d+)(?:[.,](\\d{1,${exp}}))?$`);
  const m = shape.exec(s);
  if (!m) return { ok: false, message: exp === 0 ? "Enter a whole amount, like 35000." : `Enter an amount with at most ${exp} decimals.` };
  const digits = m[1].replace(/[.,]/g, "") + (exp > 0 ? (m[2] ?? "").padEnd(exp, "0") : "");
  const trimmed = digits.replace(/^0+(?=\d)/, "");
  if (trimmed.length > 13) return { ok: false, message: "That amount is too large." };
  const value = Number(trimmed);
  if (value > MAX_MINOR) return { ok: false, message: "That amount is too large." };
  return { ok: true, value: neg && value !== 0 ? -value : value };
}

/** Minor units -> the plain text shown in an input (digits only for IDR). */
export function formatMoneyInput(minor: number, currency: string): string {
  const exp = currencyExponent(currency);
  const neg = minor < 0;
  const digits = String(Math.abs(minor)).padStart(exp + 1, "0");
  const body = exp === 0 ? digits : `${digits.slice(0, -exp)}.${digits.slice(-exp)}`;
  return neg ? `-${body}` : body;
}
