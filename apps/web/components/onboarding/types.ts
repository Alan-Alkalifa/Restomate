import type { ActionResult } from "@/components/auth/types";

/** Mirrors the MF-T15 contract; replace with lib/onboarding re-exports once it lands. */
export type SlugStatus = "available" | "taken" | "reserved" | "invalid";

export type OnboardingInput = {
  name: string;
  slug: string;
  location: {
    name: string;
    address: string;
    city: string;
    phone: string;
    timezone: string;
    currency: string;
    taxRateBps: number;
    serviceChargeBps: number;
    taxOnServiceCharge: boolean;
  };
  branding: { primaryColor: string | null; logoUrl: string | null } | null;
};

/** Server actions only (functions passed from a server component must be "use server" actions). */
export type OnboardingActions = {
  checkSlug: (slug: string) => Promise<{ status: SlugStatus }>;
  createOrganization: (input: OnboardingInput) => Promise<ActionResult>;
};

/** Raw wizard form state (percentages stay as text until submit). */
export type WizardState = {
  step: 1 | 2 | 3;
  name: string;
  slug: string;
  slugEdited: boolean;
  locationName: string;
  address: string;
  city: string;
  phone: string;
  timezone: string;
  currency: string;
  taxPercent: string;
  servicePercent: string;
  taxOnServiceCharge: boolean;
  primaryColor: string;
  logoUrl: string;
};

export const INITIAL_STATE: WizardState = {
  step: 1,
  name: "",
  slug: "",
  slugEdited: false,
  locationName: "",
  address: "",
  city: "",
  phone: "",
  timezone: "Asia/Jakarta",
  currency: "IDR",
  taxPercent: "10",
  servicePercent: "0",
  taxOnServiceCharge: true,
  primaryColor: "#0f766e",
  logoUrl: "",
};
