/**
 * Percent text -> integer basis points using string maths only (no floats).
 * "10" -> 1000, "5.5" -> 550, "0.1" -> 10, "" -> 0. Max 2 decimals, 0..100%.
 */
export function percentToBps(input: string): { ok: true; bps: number } | { ok: false; error: string } {
  const v = input.trim().replace(",", ".");
  if (v === "") return { ok: true, bps: 0 };
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(v);
  if (!m) return { ok: false, error: "Enter a percentage with up to 2 decimals, e.g. 10 or 5.5." };
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  if (bps > 10000) return { ok: false, error: "Must be between 0 and 100." };
  return { ok: true, bps };
}

/** Integer bps -> display percent ("1000" -> "10", 550 -> "5.5"). */
export function bpsToPercent(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = String(bps % 100).padStart(2, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}
