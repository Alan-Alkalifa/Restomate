"use server";

import { redirect } from "next/navigation";
import { publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "./dal";
import { sanitizeNext } from "./redirect";
import {
  fieldErrorsOf,
  formDataToObject,
  requestPasswordResetSchema,
  signInSchema,
  signUpSchema,
  updatePasswordSchema,
  type ActionResult,
} from "./schemas";
import { guard, track, type GuardReason } from "./seams";

/*
 * Auth Server Actions (`useActionState` shape: (prev, formData) => ActionResult). Rules:
 *  - `next` is always passed through sanitizeNext (same-site relative paths only).
 *  - Provider errors are never echoed; they are mapped to friendly messages.
 *  - signUp and requestPasswordReset return the same response whether or not the email exists.
 *  - redirect() throws, so it is always called outside try/catch.
 */

const GENERIC_ERROR = "Something went wrong. Please try again.";
/** A password change needs a sign-in via an emailed link (recovery / OTP) no older than this. */
const RECENT_LINK_WINDOW_SECONDS = 10 * 60;

function blocked(reason: GuardReason): ActionResult {
  return {
    ok: false,
    code: "RATE_LIMITED",
    formError:
      reason === "EMAIL_INVALID"
        ? "Please use a valid, non-disposable email address."
        : "Too many attempts. Please wait a moment and try again.",
  };
}

function confirmUrl(next: string): string {
  return `${publicEnv.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/auth/confirm?next=${encodeURIComponent(next)}`;
}

/** Sign in with email + password, then go to the validated `next` (default "/"). */
export async function signIn(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = signInSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };
  const { email, password, next } = parsed.data;

  const decision = await guard("auth", { email });
  if (!decision.allowed) return blocked(decision.reason);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.code === "email_not_confirmed") {
      return { ok: false, formError: "Please confirm your email address first. Check your inbox for the link." };
    }
    if (error.status === 429 || error.code === "over_request_rate_limit") return blocked("RATE_LIMITED");
    // Same message for a wrong password and an unknown email: no account enumeration.
    return { ok: false, formError: "Invalid email or password." };
  }
  redirect(sanitizeNext(next, "/"));
}

/**
 * Create an account. Always answers `{ ok: true }` ("check your email") when the input is valid, whether or not the
 * address already has an account. After confirming, the user lands on the validated `next` (default /onboarding).
 */
export async function signUp(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = signUpSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };
  const { fullName, email, password, next } = parsed.data;

  const decision = await guard("signup", { email });
  if (!decision.allowed) return blocked(decision.reason);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName }, emailRedirectTo: confirmUrl(sanitizeNext(next, "/onboarding")) },
  });
  if (error) {
    if (error.code === "weak_password") {
      return { ok: false, fieldErrors: { password: ["Choose a stronger password."] } };
    }
    if (error.status === 429 || error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit") {
      return blocked("RATE_LIMITED");
    }
    if (error.code === "user_already_exists" || error.code === "email_exists") return { ok: true }; // no enumeration
    return { ok: false, formError: GENERIC_ERROR };
  }

  track("signup_started", { distinctId: data.user?.id ?? crypto.randomUUID() });
  return { ok: true };
}

/** Send a reset link. Always `{ ok: true }` for valid input (no enumeration), even if sending fails. */
export async function requestPasswordReset(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = requestPasswordResetSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };

  const decision = await guard("auth", { email: parsed.data.email });
  if (!decision.allowed) return blocked(decision.reason);

  const supabase = await createClient();
  // Provider errors (including the per-address cooldown, which only exists for real accounts) are swallowed so the
  // response never reveals whether the address is registered.
  await supabase.auth.resetPasswordForEmail(parsed.data.email, { redirectTo: confirmUrl("/reset-password") });
  return { ok: true };
}

/** Set a new password. Requires the recovery session created by /auth/confirm (or any signed-in session). */
export async function updatePassword(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = updatePasswordSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };

  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, formError: "Your reset link has expired. Request a new one." };
  }

  const supabase = await createClient();
  // A stolen ordinary session must not be able to change the password: require a recent email-link sign-in.
  const { data: claimsData } = await supabase.auth.getClaims();
  const amr = (claimsData?.claims?.amr ?? []) as { method?: string; timestamp?: number }[];
  const now = Math.floor(Date.now() / 1000);
  const recent = amr.some(
    (a) => (a.method === "recovery" || a.method === "otp") && typeof a.timestamp === "number" && now - a.timestamp <= RECENT_LINK_WINDOW_SECONDS,
  );
  if (!recent) {
    return { ok: false, formError: "Your reset link has expired. Request a new one." };
  }
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "same_password") {
      return { ok: false, fieldErrors: { password: ["Choose a password you have not used before."] } };
    }
    if (error.code === "weak_password") {
      return { ok: false, fieldErrors: { password: ["Choose a stronger password."] } };
    }
    return { ok: false, formError: GENERIC_ERROR };
  }
  return { ok: true };
}

/** Clear the session and go to /login. */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
