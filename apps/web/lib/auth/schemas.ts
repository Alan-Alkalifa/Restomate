import { z } from "zod";

/** Machine-readable reasons a form action can fail (the UI maps these to friendly states). */
export type ActionErrorCode =
  | "PLAN_LIMIT"
  | "LAST_OWNER"
  | "SYSTEM_ROLE"
  | "ALREADY_INVITED"
  | "INVALID_INVITATION"
  | "FORBIDDEN"
  | "RATE_LIMITED";

/** Result shape of every form action (the `useActionState` state). */
export type ActionResult =
  | { ok: true }
  | { ok: false; fieldErrors?: Record<string, string[]>; formError?: string; code?: ActionErrorCode };

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
});

export const requestPasswordResetSchema = z.object({ email });

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
