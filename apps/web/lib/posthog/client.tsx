"use client";

import posthog from "posthog-js";
import { useEffect } from "react";
import { sanitizeEvent } from "./sanitize";

let initialised = false;
function init() {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (initialised || !key || typeof window === "undefined") return;
  initialised = true;
  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
    person_profiles: "identified_only",
    capture_pageview: "history_change",
    // Scrubs /invite/{token} and token_hash/token/code/next from every captured URL.
    before_send: (e) => sanitizeEvent(e),
  });
}

/** Initialises PostHog once (no-op without NEXT_PUBLIC_POSTHOG_KEY). Mount in the root layout. */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(init, []);
  return <>{children}</>;
}

/** Identify by user id ONLY (never email/name) and set the organization group. Render inside the dashboard. */
export function PostHogIdentify({ userId, organizationId }: { userId: string; organizationId?: string }) {
  useEffect(() => {
    init();
    if (!initialised) return;
    posthog.identify(userId);
    if (organizationId) posthog.group("organization", organizationId);
  }, [userId, organizationId]);
  return null;
}
