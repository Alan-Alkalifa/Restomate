import { formatTaxId, normalizeTaxId } from "@/lib/settings/tax-id";

/*
 * Pure logic for the NPWP field: what the person typed -> what would be saved. It mirrors the server's rules
 * (lib/settings/tax-id.ts: digits with optional dots/dashes/spaces, 15 or 16 digits, empty clears) only to give instant
 * feedback; the server action validates again and is the authority. Client-safe, unit tested.
 */
export type TaxIdPreview =
  | { kind: "unchanged" }
  | { kind: "clear" }
  | { kind: "set"; digits: string; formatted: string }
  | { kind: "invalid"; reason: "chars" | "length" };

/** Digits of what is saved, for comparison (the stored value is already digits). */
const digitsOf = (v: string | null | undefined): string | null => (v && /^[0-9]+$/.test(v) ? v : null);

/**
 * `saved` is the stored value (15/16 digits or null). The preview says what pressing Save would do: nothing, clear it,
 * set it (with the formatted result, like "Saves as 12.345.678.9-012.345") or why it cannot be saved.
 */
export function previewTaxId(draft: string, saved: string | null): TaxIdPreview {
  const raw = draft.trim();
  const current = digitsOf(saved);
  if (raw === "") return current === null ? { kind: "unchanged" } : { kind: "clear" };
  if (!/^[0-9.\-\s]+$/.test(raw)) return { kind: "invalid", reason: "chars" };
  const n = normalizeTaxId(raw);
  if (!n.ok || n.value === null) return { kind: "invalid", reason: "length" };
  return n.value === current ? { kind: "unchanged" } : { kind: "set", digits: n.value, formatted: formatTaxId(n.value) };
}

/** What the input shows for a stored value: the formatted NPWP, or empty. */
export const displayTaxId = (saved: string | null): string => formatTaxId(saved);

export type TaxIdMessages = { chars: string; length: string; tooLong: string };

/**
 * The server answers in English (its field errors are fixed strings). Known ones are shown in the page's language; anything
 * else is shown exactly as the server sent it, never swallowed.
 */
export function localizeTaxIdError(serverMessage: string, t: TaxIdMessages): string {
  if (serverMessage === "An NPWP has 15 or 16 digits.") return t.length;
  if (serverMessage === "Use digits only (dots, dashes and spaces are fine).") return t.chars;
  if (serverMessage === "That is too long.") return t.tooLong;
  return serverMessage;
}
