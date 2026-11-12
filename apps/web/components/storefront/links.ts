import { resolveHost } from "@/lib/routing/host";

/*
 * The storefront is reachable two ways: on the tenant's own host ("demo.restomate.app/", the proxy rewrites it to
 * /s/demo) and by path ("/s/demo", used on localhost and *.vercel.app, where there is no wildcard DNS). Links must be
 * built for the way the guest actually arrived, or "English" would point at the wrong place.
 */
export type StorefrontBase = { base: string; tenant: string };

/** "" on a tenant host, "/s/{slug}" otherwise. Only the Host header is used (never a forwarded one). */
export function storefrontBase(host: string | null, tenant: string, env: { rootDomain: string; allowLocalhost: boolean; previewHosts?: readonly string[] }): string {
  const surface = resolveHost(host, env.rootDomain, { allowLocalhost: env.allowLocalhost, extraAppHosts: env.previewHosts });
  return surface.kind === "tenant" && surface.slug === tenant ? "" : `/s/${tenant}`;
}

/** "/", "/en", "/s/demo", "/s/demo/en", with an optional query. The default language has no prefix. */
export function storefrontHref(base: string, locale: "id" | "en", query: Record<string, string | undefined> = {}): string {
  const path = `${base}${locale === "en" ? "/en" : ""}` || "/";
  const qs = Object.entries(query).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v as string)}`).join("&");
  return qs ? `${path}?${qs}` : path;
}
