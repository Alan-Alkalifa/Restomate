export { getPublicPackages } from "@/lib/public/packages";

/**
 * TEMPORARY SEAM until lib/money (#31) merges. Replace with:
 *   export { formatMoney } from "@/lib/money";
 */
export function formatMoney(amount: number, currency: string, locale?: string): string {
  void locale;
  return `${currency} ${amount}`;
}
