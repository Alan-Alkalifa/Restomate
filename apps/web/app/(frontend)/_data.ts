/**
 * TEMPORARY SEAM until MF-T20 / MF-T09 merge. Replace with:
 *   export { getPublicPackages } from "@/lib/public/packages";
 *   export { formatMoney } from "@/lib/money";
 * (adapt to DAVIN's final paths).
 */
import type { PublicPackage } from "@/components/frontend/types";

export async function getPublicPackages(): Promise<PublicPackage[]> {
  return [];
}

export function formatMoney(amount: number, currency: string, locale?: string): string {
  void locale;
  return `${currency} ${amount}`;
}
