import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Cookie-less anon Supabase client for public reads. It never touches request
 * cookies/headers, so it is safe inside `'use cache'` scopes. Anon key only, never service role.
 * TODO(MF-T35): type with the generated `Database` generic.
 */
export function createAnonClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
