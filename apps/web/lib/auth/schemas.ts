import { z } from "zod";

/** Machine-readable reasons a form action can fail (the UI maps these to friendly states). */
export type ActionErrorCode =
  | "PLAN_LIMIT"
  | "LAST_OWNER"
  | "SYSTEM_ROLE"
  | "ALREADY_INVITED"
  | "INVALID_INVITATION"
  | "DUPLICATE_NAME"
  | "AREA_NOT_EMPTY"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "INVALID_INPUT"
  | "ITEM_UNAVAILABLE"
  | "MODIFIER_INVALID"
  | "VARIANT_REQUIRED"
  | "TABLE_NOT_FOUND"
  | "ORDER_CLOSED"
  | "ALREADY_VOID"
  | "ALREADY_REMOVED"
  | "INVALID_TRANSITION"
  | "DISCOUNT_EXCEEDS_SUBTOTAL"
  | "CLIENT_REF_CONFLICT"
  | "BILL_EXISTS"
  | "BILL_VOID"
  | "BILL_HAS_PAYMENTS"
  | "ORDER_NOT_BILLABLE"
  | "TAX_RATE_MISMATCH"
  | "INVALID_SPLIT"
  | "METHOD_NOT_ALLOWED"
  | "PAYMENT_EXCEEDS_OUTSTANDING"
  | "TENDERED_TOO_LOW"
  | "NO_OPEN_SESSION"
  | "SESSION_ALREADY_OPEN"
  | "SESSION_CLOSED"
  | "REFUND_EXCEEDS_PAID"
  | "SIGNUP_DISABLED"
  | "DUPLICATE_CODE"
  | "NOT_FOUND"
  | "PACKAGE_IN_USE"
  | "DEFAULT_PACKAGE"
  | "PACKAGE_INACTIVE";

/** Result shape of every form action (the `useActionState` state). */
export type ActionResult =
  | { ok: true; data?: Record<string, string | number | boolean> }
  | { ok: false; fieldErrors?: Record<string, string[]>; formError?: string; code?: ActionErrorCode; details?: { itemIds?: string[]; groupId?: string } };

export const PASSWORD_MIN = 10;
/** bcrypt ignores bytes beyond 72 (bytes, not characters), so longer passwords would silently weaken. */
export const PASSWORD_MAX = 72;
const utf8Bytes = (v: string) => new TextEncoder().encode(v).length;

const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Enter your email address.")
  .max(254, "That email address is too long.")
  .pipe(z.email("Enter a valid email address."));

const password = z
  .string()
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`)
  .refine((v) => utf8Bytes(v) <= PASSWORD_MAX, `That password is too long. Use at most ${PASSWORD_MAX} bytes (fewer if it has emoji or accents).`);

/** Hidden `next` field: kept as raw text here and validated with `sanitizeNext` in the action. */
const next = z.string().max(2048).optional();

/**
 * Optional hidden `locale` field, posted by the form when it was submitted from an /en page. It only picks the language
 * of the page the emailed link lands on (`lang=en` on the confirm link), so a missing or unknown value falls back to the
 * default (Bahasa, "id") instead of failing the action.
 */
export const LOCALES = ["id", "en"] as const;
export type Locale = (typeof LOCALES)[number];
const locale = z.enum(LOCALES).catch("id");

export const signInSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password.").max(PASSWORD_MAX * 4),
  next,
});

export const signUpSchema = z.object({
  fullName: z.string().trim().min(1, "Enter your name.").max(100, "That name is too long."),
  email,
  password,
  next,
  locale,
});

export const requestPasswordResetSchema = z.object({ email, locale });

export const updatePasswordSchema = z
  .object({ password, confirmPassword: z.string().optional() })
  .refine((v) => v.confirmPassword === undefined || v.confirmPassword === v.password, {
    path: ["confirmPassword"],
    message: "The passwords do not match.",
  });

export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;

/** FormData -> plain object of string values (files and missing fields become undefined). */
export function formDataToObject(formData: FormData): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of formData.entries()) out[key] = typeof value === "string" ? value : undefined;
  return out;
}

/** Zod issues -> `{ field: [messages] }` for display next to each input. */
export function fieldErrorsOf(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    (out[key] ??= []).push(issue.message);
  }
  return out;
}
