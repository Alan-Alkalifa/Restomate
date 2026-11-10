import { sanitizeNext } from "@/lib/auth/redirect";
import { locales, localePath, type Locale } from "@/i18n/config";
import type { AuthDictionary } from "@/i18n/types";

/**
 * id ⇄ en link row for the auth pages. Keeps the page path and a sanitised `next` (never an arbitrary URL).
 * `path` is the unprefixed path, e.g. "/login".
 *
 * A plain <a>, not next/link, on purpose: /login and /en/login live under different root layouts (each renders its own
 * <html lang>), and a client-side transition between them can leave the old document's `lang` in place. A real
 * navigation always loads the new document, so <html lang> is correct.
 */
export function LanguageSwitcher({ locale, path, next, t }: { locale: Locale; path: string; next?: string; t: AuthDictionary["switcher"] }) {
  const safeNext = next ? sanitizeNext(next, "") : "";
  const qs = safeNext ? `?next=${encodeURIComponent(safeNext)}` : "";
  return (
    <nav aria-label={t.label} className="flex flex-wrap items-center gap-2 text-sm">
      <span aria-hidden>{t.label}:</span>
      {locales.map((l) =>
        l === locale ? (
          <span key={l} lang={l} aria-current="true" className="flex min-h-12 items-center px-2 font-semibold">{t[l]}</span>
        ) : (
          <a key={l} href={`${localePath(l, path)}${qs}`} lang={l} hrefLang={l} className="flex min-h-12 items-center px-2 underline">{t[l]}</a>
        ),
      )}
    </nav>
  );
}
