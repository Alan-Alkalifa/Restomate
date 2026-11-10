/**
 * Host -> surface resolution (pure, unit-tested). Used by proxy.ts.
 *
 *   restomate.app, www.restomate.app   -> frontend
 *   app.restomate.app                  -> app (restaurant admin + super admin)
 *   {slug}.restomate.app               -> tenant (storefront)
 *   admin|api|mail|... reserved        -> reserved (never a tenant)
 *   anything else                      -> custom (verified custom domains, resolved later)
 *
 * Local dev (`allowLocalhost`): `localhost` = frontend, `app.localhost` = app, `demo.localhost` = tenant.
 * Vercel previews (`extraAppHosts`, from `vercelPreviewHosts`): this deployment's own *.vercel.app hosts = app.
 *
 * Only the `Host` header is trusted by callers; never X-Forwarded-Host (client-controllable).
 */

export type Surface =
  | { kind: "frontend" }
  | { kind: "app" }
  | { kind: "tenant"; slug: string }
  | { kind: "reserved"; label: string }
  | { kind: "custom"; host: string };

/** Subdomains that are never tenants. `demo` is deliberately absent: it is the seeded Demo Restaurant. */
export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  "www",
  "app",
  "admin",
  "api",
  "mail",
  "smtp",
  "static",
  "assets",
  "cdn",
  "status",
  "docs",
  "help",
  "support",
]);

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Lowercase, drop port and trailing dot. Returns "" for unusable input. */
export function normalizeHost(rawHost: string | null | undefined): string {
  if (!rawHost) return "";
  let host = rawHost.trim().toLowerCase();
  if (host.startsWith("[")) return ""; // IPv6 literal: not a site host
  host = host.replace(/:\d+$/, "").replace(/\.$/, "");
  return host;
}

/**
 * The hosts of THIS Vercel preview deployment, to be served as the app (B1-T23). Empty unless VERCEL_ENV is exactly
 * "preview", so production and local behaviour never change. The values come from Vercel's system environment variables
 * (VERCEL_URL: the deployment URL; VERCEL_BRANCH_URL: the branch alias), never from a request header. Each must be a
 * plain hostname under .vercel.app (no scheme, no path, no port); anything else is ignored.
 */
export function vercelPreviewHosts(env: Record<string, string | undefined>): string[] {
  if (env.VERCEL_ENV !== "preview") return [];
  const hosts: string[] = [];
  for (const raw of [env.VERCEL_URL, env.VERCEL_BRANCH_URL]) {
    const host = normalizeHost(raw);
    if (host && host === raw?.trim().toLowerCase() && /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.vercel\.app$/.test(host)) {
      hosts.push(host);
    }
  }
  return hosts;
}

export function resolveHost(
  rawHost: string | null | undefined,
  rootDomain: string,
  options: { allowLocalhost?: boolean; extraAppHosts?: readonly string[] } = {},
): Surface {
  const host = normalizeHost(rawHost);
  const root = normalizeHost(rootDomain);
  if (!host) return { kind: "custom", host: "" };
  // Exact match only (never a suffix match), against hosts the server itself supplied.
  if (options.extraAppHosts?.some((h) => normalizeHost(h) === host)) return { kind: "app" };

  const roots = options.allowLocalhost ? [root, "localhost"] : [root];
  for (const base of roots) {
    if (host === base) return { kind: "frontend" };
    if (!host.endsWith(`.${base}`)) continue;

    const label = host.slice(0, -(base.length + 1));
    if (label.includes(".")) return { kind: "custom", host }; // nested subdomain: not ours to route
    if (label === "www") return { kind: "frontend" };
    if (label === "app") return { kind: "app" };
    if (RESERVED_SUBDOMAINS.has(label)) return { kind: "reserved", label };
    if (!SLUG.test(label)) return { kind: "custom", host };
    return { kind: "tenant", slug: label };
  }
  return { kind: "custom", host };
}

/** Tenant slug from the dev-only `?__tenant=` fallback; same slug rules, never a reserved label. */
export function parseTenantOverride(value: string | null | undefined): string | null {
  const slug = value?.trim().toLowerCase() ?? "";
  return SLUG.test(slug) && !RESERVED_SUBDOMAINS.has(slug) ? slug : null;
}

/** Path rewrite for a tenant request: "/" -> "/s/demo", "/menu" -> "/s/demo/menu". */
export function tenantPath(slug: string, pathname: string): string {
  const rest = pathname === "/" ? "" : pathname;
  return `/s/${slug}${rest}`;
}
