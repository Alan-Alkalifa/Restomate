import { z } from "zod";
import { SLUG_PATTERN } from "./slug";

export const ALLOWED_TIMEZONES = [
  "Asia/Jakarta",
  "Asia/Makassar",
  "Asia/Jayapura",
  "Asia/Singapore",
  "Asia/Kuala_Lumpur",
  "Asia/Bangkok",
  "Asia/Manila",
  "Asia/Tokyo",
  "Australia/Perth",
  "Australia/Sydney",
  "Europe/London",
  "UTC",
] as const;
export const CURRENCIES = ["IDR", "USD"] as const;

const optionalText = (max: number, label: string) =>
  z.string().trim().max(max, `${label} is too long.`).default("");

export const orgNameSchema = z.string().trim().min(2, "Enter at least 2 characters.").max(80, "Use at most 80 characters.");
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(SLUG_PATTERN, "Use 3–40 lowercase letters, numbers or hyphens; start and end with a letter or number.");

export const locationSchema = z.object({
  name: z.string().trim().min(1, "Enter a location name.").max(120, "Use at most 120 characters."),
  address: optionalText(300, "Address"),
  city: optionalText(120, "City"),
  phone: optionalText(32, "Phone number"),
  timezone: z.enum(ALLOWED_TIMEZONES, "Choose a timezone from the list.").default("Asia/Jakarta"),
  currency: z.enum(CURRENCIES, "Choose IDR or USD.").default("IDR"),
  taxRateBps: z.number().int("Use a whole number of basis points.").min(0, "Must be 0 or more.").max(2500, "Must be 2500 (25%) or less."),
  serviceChargeBps: z.number().int("Use a whole number of basis points.").min(0, "Must be 0 or more.").max(2500, "Must be 2500 (25%) or less."),
  taxOnServiceCharge: z.boolean(),
});

export const brandingSchema = z
  .object({
    primaryColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #1a2b3c.")
      .nullable(),
    logoUrl: z
      .string()
      .trim()
      .max(500, "The logo URL is too long.")
      .refine((v) => v.startsWith("https://"), "The logo URL must start with https://")
      .nullable(),
  })
  .nullable();

export const onboardingSchema = z.object({
  name: orgNameSchema,
  slug: slugSchema,
  location: locationSchema,
  branding: brandingSchema,
});

/** What the wizard sends. (Input type: defaults are optional for the caller.) */
export type OnboardingInput = z.input<typeof onboardingSchema>;
export type OnboardingData = z.output<typeof onboardingSchema>;

/** Zod issues -> `{ "location.taxRateBps": [messages] }` using dotted paths. */
export function dottedFieldErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join(".") : "form";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}
