import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@restomate/db";
import { publicEnv } from "@/lib/env";

/**
 * Refreshes the Supabase session cookies for a request (used by proxy.ts).
 * Optimistic only: it never decides authorization. Pass `rewriteTo` to refresh the session on a
 * rewritten response.
 */
export async function updateSession(request: NextRequest, rewriteTo?: URL): Promise<NextResponse> {
  const make = () => (rewriteTo ? NextResponse.rewrite(rewriteTo, { request }) : NextResponse.next({ request }));
  let response = make();

  const supabase = createServerClient<Database>(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.supabasePublishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = make();
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        // Responses that set auth cookies must not be cached by a CDN.
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  // Validates the JWT and refreshes it when needed. Do not put logic between client creation and this call.
  await supabase.auth.getClaims();
  return response;
}
