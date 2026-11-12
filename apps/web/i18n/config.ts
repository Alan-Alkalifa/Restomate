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

/**
 * The public marketing pages (unprefixed paths; `/en/...` is the same set). On separated hosts these, and only these,
 * live on the root domain; everything else (auth, onboarding, dashboard, POS, admin) lives on the app host.
 * A new marketing page must be added here, or it is redirected to the app host.
 */
export const MARKETING_PATHS: ReadonlySet<string> = new Set(["/", "/features", "/pricing", "/signup"]);

export function isMarketingPath(pathname: string): boolean {
  const { path } = parseLocalePath(pathname);
  return MARKETING_PATHS.has(path.length > 1 ? path.replace(/\/+$/, "") : path);
}

/** Storefront pages live under /s/{tenant}; they are reached only through a tenant host, never directly. */
export function isStorefrontPath(pathname: string): boolean {
  return pathname === "/s" || pathname.startsWith("/s/");
}

export type HostSeparation = { appOrigin: string; rootOrigin: string };

/**
 * Whether the app and the marketing site live on separate hosts, and where. Separated only when NEXT_PUBLIC_ROOT_DOMAIN
 * is a real domain (not unset, not localhost, not a *.vercel.app host) AND the app host is a proper subdomain of it
 * (app.restomate.app under restomate.app). Anything else, including staging on a *.vercel.app host, previews and local
 * development, returns null: today's single-host behaviour, no redirects. The origins come from configuration, never from
 * a request, so a redirect can only ever point at the app host or the root domain.
 */
export function hostSeparation(env: Record<string, string | undefined> = process.env): HostSeparation | null {
  const root = env.NEXT_PUBLIC_ROOT_DOMAIN?.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  if (!root || root === "localhost" || root.endsWith(".localhost") || root.endsWith(".vercel.app") || !env.NEXT_PUBLIC_APP_URL) return null;
  let app: URL;
  try { app = new URL(env.NEXT_PUBLIC_APP_URL); } catch { return null; }
  if (!app.hostname.endsWith(`.${root}`)) return null; // also rules out app host === root host
  const port = app.port ? `:${app.port}` : "";
  return { appOrigin: app.origin, rootOrigin: `${app.protocol}//${root}${port}` };
}

/**
 * Metadata `alternates` for a public page: its own canonical plus hreflang for both locales (x-default = id).
 * Marketing pages get absolute URLs on the root domain when hosts are separated; every other page stays relative and
 * resolves against metadataBase (the app host), so app and auth canonicals do not move.
 */
export function alternatesFor(locale: Locale, path: string) {
  const separation = hostSeparation();
  const url = (l: Locale) =>
    separation && isMarketingPath(path) ? new URL(localePath(l, path), separation.rootOrigin).href : localePath(l, path);
  return {
    canonical: url(locale),
    languages: { id: url("id"), en: url("en"), "x-default": url("id") },
  };
}

const TENANT_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * The storefront's own host, e.g. https://demo.restomate.app. Null when hosts are not separated (staging, local) or the
 * slug is not a valid host label. Built from configuration only.
 */
export function tenantOrigin(slug: string, separation: HostSeparation | null = hostSeparation()): string | null {
  const s = slug.trim().toLowerCase();
  if (!separation || !TENANT_SLUG.test(s)) return null;
  const url = new URL(separation.rootOrigin);
  url.hostname = `${s}.${url.hostname}`;
  return url.origin;
}

/**
 * Metadata `alternates` for a storefront page of tenant `slug` (`path` is the storefront-relative path, e.g. "/" or "/menu").
 * Hosts separated: absolute URLs on the tenant host (https://{slug}.{root}/..., /en/... for English, x-default = id).
 * Otherwise (staging on one host, local): relative /s/{slug}/... URLs, which resolve against metadataBase. These match
 * what the proxy serves: a tenant host rewrites "/en/menu" to "/s/{slug}/en/menu".
 */
export function storefrontAlternates(locale: Locale, slug: string, path = "/") {
  const s = slug.trim().toLowerCase();
  if (!TENANT_SLUG.test(s)) throw new RangeError("invalid tenant slug"); // callers pass a slug the storefront lookup already validated
  const origin = tenantOrigin(s);
  const url = (l: Locale) => {
    const lp = localePath(l, path);
    if (origin) return new URL(lp, origin).href;
    return `/s/${s}${lp === "/" ? "" : lp}`;
  };
  return { canonical: url(locale), languages: { id: url("id"), en: url("en"), "x-default": url("id") } };
}

/** Replaces {name} placeholders. Unknown placeholders are left as they are. */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
