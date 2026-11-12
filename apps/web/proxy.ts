import { NextResponse, type NextRequest } from "next/server";
import { hostSeparation, isMarketingPath, isStorefrontPath, parseLocalePath, type HostSeparation } from "@/i18n/config";
import { isShieldedPath, shieldRequest } from "@/lib/arcjet";
import { publicEnv } from "@/lib/env";
import { parseTenantOverride, resolveHost, tenantPath, vercelPreviewHosts, type Surface } from "@/lib/routing/host";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * Next 16 Proxy (formerly middleware). Optimistic only: tenant host routing + session refresh.
 * Authorization lives in the DAL (lib/auth) and RLS, never here. Arcjet shield (lib/arcjet) covers public + auth routes only.
 */
const STATIC_ASSET = /\.(?:svg|png|jpe?g|gif|webp|avif|ico|css|js|map|txt|xml|woff2?)$/i;

/** Same host, new path. Cross-host targets are built from configuration (HostSeparation), never from the request. */
function redirectTo(origin: string, request: NextRequest, pathname = request.nextUrl.pathname): NextResponse {
  const target = new URL(origin);
  target.pathname = pathname;
  target.search = request.nextUrl.search;
  return NextResponse.redirect(target, 307);
}

/**
 * Keeps each surface on its own host when the app and the marketing site are separated (see hostSeparation):
 *   root domain: marketing pages only; anything else (login, onboarding, dashboard, POS, admin) goes to the app host.
 *   app host:    everything except marketing; marketing pages go to the root domain, and its own "/" goes to the login.
 *   both:        /s/* (the storefront) is reachable only through a tenant host, so it is a 404 here.
 * Returns null to carry on with the normal flow. This is routing, not authorization: no decision here is about who may see what.
 */
function separateSurfaces(surface: Surface, request: NextRequest, separation: HostSeparation): NextResponse | null {
  if (surface.kind !== "frontend" && surface.kind !== "app") return null;
  const { pathname } = request.nextUrl;
  if (isStorefrontPath(pathname)) return new NextResponse("Not found", { status: 404 });
  const marketing = isMarketingPath(pathname);
  if (surface.kind === "frontend") return marketing ? null : redirectTo(separation.appOrigin, request);
  if (!marketing) return null;
  // The app host has no home page of its own: "/" goes to the login, which sends a signed-in user to their dashboard.
  const { locale, path } = parseLocalePath(pathname);
  if (path === "/") return redirectTo(separation.appOrigin, request, locale === "en" ? "/en/login" : "/login");
  return redirectTo(separation.rootOrigin, request);
}

export async function proxy(request: NextRequest) {
  if (STATIC_ASSET.test(request.nextUrl.pathname)) return NextResponse.next();
  const allowLocalhost = process.env.NODE_ENV !== "production";
  // Only the Host header is trusted. X-Forwarded-Host is client-controllable and ignored.
  // On a Vercel preview deployment (VERCEL_ENV=preview only) its own *.vercel.app hosts are the app, so PR previews are
  // usable. The allow-list comes from Vercel's system env vars, not from a header. Production: empty, so unknown hosts 404.
  const surface = resolveHost(request.headers.get("host"), publicEnv.NEXT_PUBLIC_ROOT_DOMAIN, {
    allowLocalhost,
    extraAppHosts: vercelPreviewHosts(process.env),
  });
  const { pathname } = request.nextUrl;

  // Separate hosts (production): redirect a request that arrived on the wrong surface BEFORE spending Arcjet on it.
  // Skipped on preview deployments and whenever hostSeparation() is null (staging on *.vercel.app, local dev).
  const separation = hostSeparation(publicEnv);
  if (separation && vercelPreviewHosts(process.env).length === 0) {
    const redirected = separateSurfaces(surface, request, separation);
    if (redirected) return redirected;
  }

  // Arcjet shield on public and auth surfaces (tenant hosts, marketing, auth). Never on the DOKU webhook
  // (excluded by the matcher below) and never on the authenticated app/admin areas.
  if (surface.kind === "tenant" || isShieldedPath(pathname)) {
    const denied = await shieldRequest(request);
    if (denied) return denied as NextResponse;
  }

  if (surface.kind === "tenant") {
    // Public storefront: no session refresh (guest ordering, cache friendly).
    const url = request.nextUrl.clone();
    url.pathname = tenantPath(surface.slug, pathname);
    return NextResponse.rewrite(url);
  }

  if (surface.kind === "reserved") {
    // e.g. admin.restomate.app, api.restomate.app: not a tenant, no site here.
    return new NextResponse("Not found", { status: 404 });
  }

  if (surface.kind === "custom" && !allowLocalhost) {
    // Unknown Host in production: custom domains do not exist until M7 (custom_domains). Never serve the app under it.
    return new NextResponse("Not found", { status: 404 });
  }

  // Dev-only path fallback: http://localhost:3000/?__tenant=demo
  if (allowLocalhost && surface.kind === "frontend") {
    const slug = parseTenantOverride(request.nextUrl.searchParams.get("__tenant"));
    if (slug) {
      const url = request.nextUrl.clone();
      url.pathname = tenantPath(slug, pathname);
      url.searchParams.delete("__tenant");
      return NextResponse.rewrite(url);
    }
  }

  // frontend, app (and unknown hosts in dev only): refresh the session.
  return updateSession(request);
}

export const config = {
  // Skips the DOKU webhook (signature-verified, no session), scheduled jobs (authenticated by their own secret),
  // Next internals and the favicon.
  matcher: ["/((?!api/webhooks/doku|api/cron|_next/static|_next/image|favicon\\.ico).*)"],
};
