import "server-only";
import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env.server";

/**
 * Service-role client: BYPASSES RLS. Server code only (webhooks, background jobs, public storefront
 * order intake). Always scope queries by tenant explicitly. Never import from a client component.
 * TODO(MF-T35): add the `Database` generic.
 */
export function createAdminClient() {
  return createClient(serverEnv.NEXT_PUBLIC_SUPABASE_URL, serverEnv.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
