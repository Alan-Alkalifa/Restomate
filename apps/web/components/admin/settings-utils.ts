import { OWNED_ORG_CAP_RANGE } from "@/lib/admin/platform-settings-schemas";

/**
 * Percent typed by the admin → integer basis points. Accepts only "10", "5.5", "12,25" (up to two decimals, one
 * "." or ","), 0–100. Anything else returns null: we never guess (e.g. "1.000" or "10%" is not converted), so the
 * server answers with a field error instead of saving a different rate.
 */
export function parsePercentToBps(input: string): number | null {
  const m = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(input.trim());
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || 0);
  return bps <= 10000 ? bps : null;
}

/** 1000 → "10", 550 → "5.5", 1225 → "12.25" (prefill for the form). */
export function bpsToPercent(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = String(bps % 100).padStart(2, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}

/** "Saves as 10%" text, or null when the input cannot be read. */
export function previewPercent(input: string): string | null {
  const bps = parsePercentToBps(input);
  return bps === null ? null : `${bpsToPercent(bps)}%`;
}

/** Digits only, within the contract's range; otherwise the raw text (the server rejects it). */
export function capToPostValue(input: string): string {
  const t = input.trim();
  if (!/^\d+$/.test(t)) return t;
  return String(Number(t));
}

export function capInRange(input: string): boolean {
  const t = input.trim();
  if (!/^\d+$/.test(t)) return false;
  const n = Number(t);
  return n >= OWNED_ORG_CAP_RANGE.min && n <= OWNED_ORG_CAP_RANGE.max;
}
