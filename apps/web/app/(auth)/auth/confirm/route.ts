import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { sanitizeNext } from "@/lib/auth/redirect";
import { track } from "@/lib/auth/seams";
import { localeFromHints, localePath, parseLocalePath, type Locale } from "@/i18n/config";
import { publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

const OTP_TYPES = ["signup", "recovery", "invite", "magiclink", "email", "email_change"] as const;
const paramsSchema = z.object({
  token_hash: z.string().min(1).max(512),
  type: z.enum(OTP_TYPES),
});

// Pages that exist in both languages. Others (onboarding, the home page) are not translated yet, so they stay unprefixed.
const TRANSLATED_PATHS = new Set(["/login", "/signup", "/forgot-password", "/reset-password"]);

/** Puts an English user on the /en version of a translated page. `next` is already sanitized (same-site relative path). */
function localizeNext(next: string, locale: Locale): string {
  if (locale === "id") return next;
  const [pathAndQuery] = next.split("#", 1);
  const q = pathAndQuery.indexOf("?");
  const pathname = q === -1 ? pathAndQuery : pathAndQuery.slice(0, q);
  const parsed = parseLocalePath(pathname);
  if (parsed.locale === "en" || !TRANSLATED_PATHS.has(parsed.path)) return next;
  return localePath("en", next);
}

/**
 * Email link landing (confirmation, recovery, ...): verifies the one-time token, sets the session cookies and
 * redirects to the validated `next`. Failure (missing, expired or already used token) goes to /login?error=link_expired.
 * Redirects are always built on our own app URL with a sanitized relative path, never an arbitrary `next`.
 */
export async function GET(request: NextRequest) {
  // Read the request FIRST. With Cache Components Next tries to prerender GET handlers at build time and stops at the
  // first request access; touching env before that made a build without runtime variables fail on this route
  // ("Error occurred prerendering page /auth/confirm"). This route is inherently dynamic (query token, cookies).
  const params = request.nextUrl.searchParams;
  const base = publicEnv.NEXT_PUBLIC_APP_URL;
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
  // The language hint applies to `next` too: the reset mail always carries next=/reset-password. sanitizeNext stays the
  // open-redirect guard and runs first; localizing only ever prepends the fixed "/en" prefix.
  return NextResponse.redirect(new URL(localizeNext(sanitizeNext(params.get("next"), fallback), locale), base));
}
