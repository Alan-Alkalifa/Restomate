/**
 * Money helpers. Pure module, no I/O.
 *
 * Representation: amounts are integer minor units held in a JS `number`, guarded by
 * `Number.isSafeInteger` (max ~9e15, far above any restaurant bill). IDR has exponent 0, so
 * Rp 25.000 is `25000`; USD has exponent 2, so $25.50 is `2550`. Floats are never accepted.
 * Rates are integer basis points (1000 = 10%). Intermediate products use BigInt so
 * `amount * bps` can never lose precision.
 *
 * Rounding: every percentage step rounds ONCE, at that step, on an exact integer ratio.
 * Default `half-up` (x.5 rounds up, amounts are non-negative); `half-even` (banker's) is opt-in.
 */

export type RoundingMode = "half-up" | "half-even";

const EXPONENTS: Readonly<Record<string, number>> = {
  IDR: 0,
  USD: 2,
  SGD: 2,
  EUR: 2,
  MYR: 2,
  JPY: 0,
};

const BPS_DENOMINATOR = BigInt(10_000);
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);

export function currencyExponent(currency: string): number {
  const exp = EXPONENTS[currency];
  if (exp === undefined) throw new RangeError(`Unsupported currency: ${currency}`);
  return exp;
}

/** Throws unless `value` is a non-negative safe integer. */
export function assertMinorUnits(value: number, label = "amount"): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer (minor units), got ${value}`);
  }
}

function assertBps(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    throw new RangeError(`${label} must be an integer basis-point value between 0 and 10000, got ${value}`);
  }
}

/** round(numerator / denominator) for non-negative bigints, per the rounding mode. */
function divRound(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  const quotient = numerator / denominator;
  const twiceRemainder = (numerator % denominator) * TWO;
  if (twiceRemainder > denominator) return quotient + ONE;
  if (twiceRemainder < denominator) return quotient;
  // exact half
  if (mode === "half-up") return quotient + ONE;
  return quotient % TWO === ZERO ? quotient : quotient + ONE;
}

/** amount * bps / 10000, rounded. */
export function applyBps(amount: number, bps: number, rounding: RoundingMode = "half-up"): number {
  assertMinorUnits(amount);
  assertBps(bps, "bps");
  return Number(divRound(BigInt(amount) * BigInt(bps), BPS_DENOMINATOR, rounding));
}

/**
 * Format for display. IDR 25000 -> "Rp 25.000" (id-ID); USD 2550 with en-US -> "$25.50".
 * Intl emits a non-breaking space after "Rp"; it is normalised to a plain space so output is
 * identical across Node/ICU versions and safe to compare in tests.
 */
export function formatMoney(amount: number, currency: string, locale = "id-ID"): string {
  assertMinorUnits(amount);
  const exp = currencyExponent(currency);
  const digits = String(amount).padStart(exp + 1, "0");
  const decimal = exp === 0 ? digits : `${digits.slice(0, -exp)}.${digits.slice(-exp)}`;
  const out = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  }).format(decimal as unknown as number); // Intl accepts exact decimal strings; avoids float conversion
  return out.replace(/[  ]/g, " ");
}

export type ParseMoneyResult = { ok: true; value: number } | { ok: false; message: string };

/** Largest absolute amount accepted from user input, in minor units (matches the menu price bounds). */
export const MAX_MONEY_INPUT = 1_000_000_000_000;

const CURRENCY_PREFIX = /^(?:rp\.?|idr|usd|sgd|eur|myr|jpy|s\$|us\$|rm|\$|€|¥)/i;

/**
 * Parse what a person typed into integer minor units. String parsing only, never floats.
 *  - Spaces and non-breaking spaces are ignored; one leading currency marker ("Rp", "Rp.", "IDR", "$", ...) is dropped.
 *  - Exponent 0 (IDR): digits, optionally grouped by "." or "," in threes ("35.000", "1,250,000"). Decimals are rejected.
 *  - Exponent 2 (USD...): one decimal separator ("." or ",") followed by at most 2 digits; the other character may group
 *    thousands ("1,234.56", "1.234,56"). A single separator is always a decimal separator, so "1,234" is rejected
 *    rather than guessed; repeated same-character grouping ("1,234,567") is accepted.
 *  - A leading "-" is accepted only with `allowNegative`. |value| must be <= MAX_MONEY_INPUT.
 * Pure and client-safe: components may import it.
 */
export function parseMoneyInput(text: string, currency: string, opts: { allowNegative?: boolean } = {}): ParseMoneyResult {
  const fail = (message: string): ParseMoneyResult => ({ ok: false, message });
  let exp: number;
  try { exp = currencyExponent(currency); } catch { return fail("This currency is not supported."); }

  let t = String(text ?? "").replace(/[\s\u00a0\u202f]+/g, "");
  if (t === "") return fail("Enter an amount.");
  let negative = false;
  if (t.startsWith("-")) { negative = true; t = t.slice(1); }
  t = t.replace(CURRENCY_PREFIX, "");
  if (t.startsWith("-")) { if (negative) return fail("Enter a valid amount."); negative = true; t = t.slice(1); }
  if (t === "") return fail("Enter an amount.");
  if (!/^[0-9.,]+$/.test(t) || !/^\d/.test(t) || /[.,]$/.test(t)) return fail("Enter a valid amount, using digits only.");
  if (negative && !opts.allowNegative) return fail("Negative amounts are not allowed.");

  const group = (s: string, sep: string) => new RegExp(`^\\d{1,3}(?:\\${sep}\\d{3})*$`).test(s);
  let whole: string;
  let frac = "";
  if (/^\d+$/.test(t)) {
    whole = t;
  } else {
    const seps = t.match(/[.,]/g) ?? [];
    const last = Math.max(t.lastIndexOf("."), t.lastIndexOf(","));
    const sep = t[last]!;
    const head = t.slice(0, last);
    const tail = t.slice(last + 1);
    const allSame = seps.every((c) => c === sep);
    if (allSame && group(t, sep) && (exp === 0 || seps.length >= 2)) {
      whole = t.replace(/[.,]/g, ""); // grouping only
    } else if (exp === 0) {
      return fail(/^\d+$/.test(tail) && tail.length <= 2 && !head.includes(sep) ? "Enter a whole amount without decimals." : "Enter a valid amount.");
    } else {
      const other = sep === "." ? "," : ".";
      // head: digits, optionally grouped in threes with the *other* character; it must not contain the decimal separator
      const headOk = head !== "" && !head.includes(sep) && (/^\d+$/.test(head) || group(head, other));
      if (!headOk || !/^\d+$/.test(tail)) return fail("Enter a valid amount.");
      if (tail.length > exp) return fail(`Use at most ${exp} decimal places.`);
      whole = head.split(other).join("");
      frac = tail;
    }
  }
  whole = whole.replace(/^0+(?=\d)/, "");
  if (whole.length + exp > 15) return fail("That amount is too large.");
  const value = Number(whole + frac.padEnd(exp, "0")) * (negative ? -1 : 1);
  if (!Number.isSafeInteger(value) || Math.abs(value) > MAX_MONEY_INPUT) return fail("That amount is too large.");
  return { ok: true, value: value === 0 ? 0 : value };
}

export interface BillInput {
  subtotal: number;
  /** basis points, 500 = 5% */
  serviceChargeBps: number;
  /** basis points, 1000 = 10% (PB1) */
  taxRateBps: number;
  /** true: tax on subtotal + service charge (default); false: tax on subtotal only */
  taxOnServiceCharge?: boolean;
  rounding?: RoundingMode;
}

export interface BillTotals {
  subtotal: number;
  serviceCharge: number;
  tax: number;
  total: number;
}

/** Service charge first, then tax. total = subtotal + serviceCharge + tax always. */
export function calculateBill(input: BillInput): BillTotals {
  const { subtotal, serviceChargeBps, taxRateBps, taxOnServiceCharge = true, rounding = "half-up" } = input;
  assertMinorUnits(subtotal, "subtotal");
  const serviceCharge = applyBps(subtotal, serviceChargeBps, rounding);
  const taxBase = taxOnServiceCharge ? subtotal + serviceCharge : subtotal;
  const tax = applyBps(taxBase, taxRateBps, rounding);
  const total = subtotal + serviceCharge + tax;
  assertMinorUnits(total, "total");
  return { subtotal, serviceCharge, tax, total };
}

/** Split `amount` into `parts` integer shares that always sum to `amount`; remainder goes one unit each to the first parts. */
export function allocate(amount: number, parts: number): number[] {
  assertMinorUnits(amount);
  if (!Number.isSafeInteger(parts) || parts < 1) {
    throw new RangeError(`parts must be a positive integer, got ${parts}`);
  }
  const base = Math.floor(amount / parts);
  const remainder = amount - base * parts;
  return Array.from({ length: parts }, (_, i) => (i < remainder ? base + 1 : base));
}
