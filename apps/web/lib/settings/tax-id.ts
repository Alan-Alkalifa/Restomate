/**
 * Location tax id (NPWP). Stored as 15 or 16 digits (the old NPWP, or the new NIK-based one) or null. Input may carry
 * dots, dashes and spaces; they are stripped here and never stored. Pure and client-safe.
 */
export const TAX_ID_PATTERN = /^[0-9]{15,16}$/;

export type TaxIdResult = { ok: true; value: string | null } | { ok: false; message: string };

/** Normalize what a person typed: empty -> null, digits with optional separators -> digits, anything else -> error. */
export function normalizeTaxId(input: string | null | undefined): TaxIdResult {
  const raw = String(input ?? "").trim();
  if (raw === "") return { ok: true, value: null };
  if (!/^[0-9.\-\s]+$/.test(raw)) return { ok: false, message: "Use digits only (dots, dashes and spaces are fine)." };
  const digits = raw.replace(/[.\-\s]/g, "");
  if (!TAX_ID_PATTERN.test(digits)) return { ok: false, message: "An NPWP has 15 or 16 digits." };
  return { ok: true, value: digits };
}

/**
 * Display format. 15 digits: 12.345.678.9-012.345 (the classic NPWP layout). 16 digits: groups of four.
 * Anything that is not 15 or 16 digits is returned unchanged.
 */
export function formatTaxId(value: string | null | undefined): string {
  const v = String(value ?? "");
  if (/^[0-9]{15}$/.test(v)) return `${v.slice(0, 2)}.${v.slice(2, 5)}.${v.slice(5, 8)}.${v[8]}-${v.slice(9, 12)}.${v.slice(12, 15)}`;
  if (/^[0-9]{16}$/.test(v)) return v.replace(/(.{4})(?=.)/g, "$1 ");
  return v;
}
