import type { ActionResult } from "@/components/auth/types";
import type { OnboardingInput } from "@/lib/onboarding/schemas";
import type { SlugStatus } from "@/lib/onboarding/actions";

export type { OnboardingInput, SlugStatus };
export type Timezone = OnboardingInput["location"]["timezone"] & string;
export type Currency = OnboardingInput["location"]["currency"] & string;

/** Server actions only (functions passed from a server component must be "use server" actions). */
export type OnboardingActions = {
  checkSlug: (slug: string) => Promise<{ status: SlugStatus }>;
  createOrganization: (input: OnboardingInput) => Promise<ActionResult>;
};

/** The allowed values come from lib/onboarding/schemas (passed in by the page so zod stays off the client). */
export type OnboardingOptions = { timezones: readonly Timezone[]; currencies: readonly Currency[] };

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
