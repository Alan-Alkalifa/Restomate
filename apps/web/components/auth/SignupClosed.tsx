import Link from "next/link";
import { localePath, type Locale } from "@/i18n/config";
import type { AuthDictionary } from "@/i18n/types";

/** Cosmetic: the signUp action and the database trigger refuse when sign-ups are closed. */
export function SignupClosed({ t, locale }: { t: AuthDictionary["signupClosed"]; locale: Locale }) {
  return (
    <div role="status" className="flex flex-col gap-3 rounded-lg border border-neutral-300 p-4 dark:border-neutral-700">
      <p className="font-medium">{t.message}</p>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        {t.haveAccount} <Link href={localePath(locale, "/login")} className="underline">{t.signIn}</Link>.
      </p>
    </div>
  );
}
