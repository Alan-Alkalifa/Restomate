/**
 * Locale helpers (no server-only: used by client components too).
 * Routing: the default locale (id) lives at unprefixed URLs, English under /en.
 */
export const locales = ["id", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "id";

export const isLocale = (v: unknown): v is Locale => typeof v === "string" && (locales as readonly string[]).includes(v);
export const otherLocale = (l: Locale): Locale => (l === "id" ? "en" : "id");

/** "/login" → "/login" (id) or "/en/login" (en). "/" → "/" or "/en". Query strings pass through. */
export function localePath(locale: Locale, path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (locale === defaultLocale) return p;
  return p === "/" ? "/en" : `/en${p}`;
}

/** Splits a pathname into its locale and the unprefixed path: "/en/login" → { en, "/login" }; "/login" → { id, "/login" }. */
export function parseLocalePath(pathname: string): { locale: Locale; path: string } {
  if (pathname === "/en") return { locale: "en", path: "/" };
  if (pathname.startsWith("/en/")) return { locale: "en", path: pathname.slice(3) };
  return { locale: defaultLocale, path: pathname };
}

/**
 * Locale for a redirect, from (1) an explicit `lang` hint, (2) the `next` path prefix, else the default.
 * Both inputs come from the URL, so only the two known values are ever returned.
 */
export function localeFromHints(lang: string | null | undefined, next: string | null | undefined): Locale {
  if (isLocale(lang)) return lang;
  if (typeof next === "string") return parseLocalePath(next).locale;
  return defaultLocale;
}

/** Absolute base for canonical/hreflang URLs. Never throws (the build must not need runtime env). */
export function metadataBase(): URL | undefined {
  try {
    return process.env.NEXT_PUBLIC_APP_URL ? new URL(process.env.NEXT_PUBLIC_APP_URL) : undefined;
  } catch {
    return undefined;
  }
}

/** Metadata `alternates` for a public page: its own canonical plus hreflang for both locales (x-default = id). */
export function alternatesFor(locale: Locale, path: string) {
  return {
    canonical: localePath(locale, path),
    languages: { id: localePath("id", path), en: localePath("en", path), "x-default": localePath("id", path) },
  };
}

/** Replaces {name} placeholders. Unknown placeholders are left as they are. */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
