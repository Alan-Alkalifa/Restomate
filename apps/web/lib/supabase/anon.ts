import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { publicEnv } from "@/lib/env";

/**
 * Cookie-less anon Supabase client for public reads. It never touches request
 * cookies/headers, so it is safe inside `'use cache'` scopes. Publishable (client) key only, never service role.
 * TODO(MF-T35): type with the generated `Database` generic.
 */
export function createAnonClient(): SupabaseClient {
  return createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
