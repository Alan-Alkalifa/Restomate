/** Mirrors the MF-T20 contract; replace with re-exports from lib once it lands. */
export type PublicPackage = {
  code: string;
  name: string;
  description: string | null;
  currency: string;
  priceMonthly: number;
  priceYearly: number;
  trialDays: number;
  limits: Record<string, number | null>;
  features: string[];
  isDefault: boolean;
};
