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
