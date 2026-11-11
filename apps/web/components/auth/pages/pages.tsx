import type { Metadata } from "next";
import { Suspense } from "react";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { LanguageSwitcher } from "@/components/auth/LanguageSwitcher";
import { LoginForm } from "@/components/auth/LoginForm";
import { redirectIfSignedIn } from "@/components/auth/redirect-if-signed-in";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { SignupClosed } from "@/components/auth/SignupClosed";
import { SignupForm } from "@/components/auth/SignupForm";
import { passwordHint } from "@/components/auth/password-hint";
import { requestPasswordReset, signIn, signUp, updatePassword } from "@/lib/auth/actions";
import { sanitizeNext } from "@/lib/auth/redirect";
import { getPublicPlatformFlags } from "@/lib/public/platform-flags";
import { alternatesFor, type Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";

/**
 * One page component per auth screen, shared by the unprefixed (id) and /en route files. The route files only pick
 * the locale, so the two trees cannot drift.
 */
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** `next` reaches the hidden input only after the shared sanitiser; the action re-validates it. */
const nextParam = (v: string | string[] | undefined) => (typeof v === "string" ? sanitizeNext(v, "") || undefined : undefined);
const skeleton = (h: string) => <div className={`${h} animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-800`} />;

export async function authMetadata(locale: Locale, page: "login" | "signup" | "forgot" | "reset", path: string): Promise<Metadata> {
  const t = (await getDictionary(locale)).auth[page];
  return { title: t.title, alternates: alternatesFor(locale, path) };
}

type Auth = Awaited<ReturnType<typeof getDictionary>>["auth"];

// Session and searchParams are read only inside these Suspense-wrapped children (Next 16 rule).
async function LoginContent({ locale, a, searchParams }: { locale: Locale; a: Auth; searchParams: SearchParams }) {
  const sp = await searchParams;
  await redirectIfSignedIn(sp.next);
  const { signupEnabled } = await getPublicPlatformFlags();
  const code = typeof sp.error === "string" ? sp.error : undefined;
  const next = nextParam(sp.next);
  return (
    <>
      <LoginForm action={signIn} next={next} initialError={code === "link_expired" ? a.login.linkExpired : undefined} t={a.login} locale={locale} signupOpen={signupEnabled} />
      <LanguageSwitcher locale={locale} path="/login" next={next} t={a.switcher} />
    </>
  );
}

export async function LoginPage({ locale, searchParams }: { locale: Locale; searchParams: SearchParams }) {
  const a = (await getDictionary(locale)).auth;
  return (
    <>
      <h1 className="text-xl font-semibold">{a.login.heading}</h1>
      <Suspense fallback={skeleton("h-64")}><LoginContent locale={locale} a={a} searchParams={searchParams} /></Suspense>
    </>
  );
}

async function SignupContent({ locale, a, searchParams }: { locale: Locale; a: Auth; searchParams: SearchParams }) {
  const sp = await searchParams;
  await redirectIfSignedIn(sp.next);
  const next = nextParam(sp.next);
  const { signupEnabled } = await getPublicPlatformFlags();
  if (!signupEnabled) {
    return (
      <>
        <SignupClosed t={a.signupClosed} locale={locale} />
        <LanguageSwitcher locale={locale} path="/signup" t={a.switcher} />
      </>
    );
  }
  return (
    <>
      <SignupForm action={signUp} passwordHint={passwordHint(a.passwordHint)} next={next} t={a.signup} locale={locale} />
      <LanguageSwitcher locale={locale} path="/signup" next={next} t={a.switcher} />
    </>
  );
}

export async function SignupPage({ locale, searchParams }: { locale: Locale; searchParams: SearchParams }) {
  const a = (await getDictionary(locale)).auth;
  return (
    <>
      <h1 className="text-xl font-semibold">{a.signup.heading}</h1>
      <Suspense fallback={skeleton("h-72")}><SignupContent locale={locale} a={a} searchParams={searchParams} /></Suspense>
    </>
  );
}

export async function ForgotPasswordPage({ locale }: { locale: Locale }) {
  const a = (await getDictionary(locale)).auth;
  return (
    <>
      <h1 className="text-xl font-semibold">{a.forgot.heading}</h1>
      <p className="text-sm">{a.forgot.intro}</p>
      <ForgotPasswordForm action={requestPasswordReset} t={a.forgot} locale={locale} />
      <LanguageSwitcher locale={locale} path="/forgot-password" t={a.switcher} />
    </>
  );
}

export async function ResetPasswordPage({ locale }: { locale: Locale }) {
  const a = (await getDictionary(locale)).auth;
  return (
    <>
      <h1 className="text-xl font-semibold">{a.reset.heading}</h1>
      <ResetPasswordForm action={updatePassword} passwordHint={passwordHint(a.passwordHint)} t={a.reset} />
      <LanguageSwitcher locale={locale} path="/reset-password" t={a.switcher} />
    </>
  );
}
