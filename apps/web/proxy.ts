import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";
import { parseTenantOverride, resolveHost, tenantPath } from "@/lib/routing/host";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * Next 16 Proxy (formerly middleware). Optimistic only: tenant host routing + session refresh.
 * Authorization lives in the DAL (lib/auth) and RLS, never here. Arcjet is added in MF-T08.
 */
const STATIC_ASSET = /\.(?:svg|png|jpe?g|gif|webp|avif|ico|css|js|map|txt|xml|woff2?)$/i;

export async function proxy(request: NextRequest) {
  if (STATIC_ASSET.test(request.nextUrl.pathname)) return NextResponse.next();
  const allowLocalhost = process.env.NODE_ENV !== "production";
  // Only the Host header is trusted. X-Forwarded-Host is client-controllable and ignored.
  const surface = resolveHost(request.headers.get("host"), publicEnv.NEXT_PUBLIC_ROOT_DOMAIN, { allowLocalhost });
  const { pathname } = request.nextUrl;

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
  // Skips the DOKU webhook (signature-verified, no session), Next internals and the favicon.
  matcher: ["/((?!api/webhooks/doku|_next/static|_next/image|favicon\\.ico).*)"],
};
