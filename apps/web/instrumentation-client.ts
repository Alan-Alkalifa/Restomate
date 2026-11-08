import posthog from "posthog-js";
import { createClient as createSupabaseClient } from "@/lib/supabase/client";

const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;

if (!posthogKey || !posthogHost) {
  if (process.env.NODE_ENV !== "production") {
    const missingVariable = posthogKey ? "NEXT_PUBLIC_POSTHOG_HOST" : "NEXT_PUBLIC_POSTHOG_KEY";
    throw new Error(
      `${missingVariable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missingVariable} is configured`,
    );
  }
} else {
  posthog.init(posthogKey, {
    api_host: posthogHost,
    defaults: "2026-01-30",
    capture_exceptions: true,
    debug: process.env.NODE_ENV === "development",
  });

  let distinctId: string | undefined;
  const supabase = createSupabaseClient();

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
      distinctId = undefined;
      posthog.reset();
      return;
    }

    if ((event === "INITIAL_SESSION" || event === "SIGNED_IN" || event === "USER_UPDATED") && session?.user) {
      if (distinctId && distinctId !== session.user.id) posthog.reset();

      distinctId = session.user.id;
      posthog.identify(distinctId, {
        email: session.user.email,
      });
    }
  });
}
