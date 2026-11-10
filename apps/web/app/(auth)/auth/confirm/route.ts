import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { sanitizeNext } from "@/lib/auth/redirect";
import { track } from "@/lib/auth/seams";
import { localeFromHints, localePath } from "@/i18n/config";
import { publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

const OTP_TYPES = ["signup", "recovery", "invite", "magiclink", "email", "email_change"] as const;
const paramsSchema = z.object({
  token_hash: z.string().min(1).max(512),
  type: z.enum(OTP_TYPES),
});

/**
 * Email link landing (confirmation, recovery, ...): verifies the one-time token, sets the session cookies and
 * redirects to the validated `next`. Failure (missing, expired or already used token) goes to /login?error=link_expired.
 * Redirects are always built on our own app URL with a sanitized relative path, never an arbitrary `next`.
 */
export async function GET(request: NextRequest) {
  const base = publicEnv.NEXT_PUBLIC_APP_URL;
  const params = request.nextUrl.searchParams;
  const parsed = paramsSchema.safeParse({ token_hash: params.get("token_hash"), type: params.get("type") });
  // Land in the language the user started in: an explicit `lang` hint, else the locale prefix of `next`, else id.
  const locale = localeFromHints(params.get("lang"), params.get("next"));
  const fail = () => NextResponse.redirect(new URL(localePath(locale, "/login?error=link_expired"), base));
  if (!parsed.success) return fail();

  const { token_hash, type } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ type, token_hash });
  if (error) return fail();

  if (type === "signup" && data.user) track("signup_completed", { distinctId: data.user.id });

  // Only pages that exist in both languages are localized (onboarding and the home page are not translated yet).
  const fallback = type === "signup" ? "/onboarding" : type === "recovery" ? localePath(locale, "/reset-password") : "/";
  return NextResponse.redirect(new URL(sanitizeNext(params.get("next"), fallback), base));
}
