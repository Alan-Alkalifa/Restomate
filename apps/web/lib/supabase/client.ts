import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@restomate/db";
import { publicEnv } from "@/lib/env";

/** Browser Supabase client (anon key, RLS applies). */
export function createClient() {
  return createBrowserClient<Database>(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.supabasePublishableKey);
}
