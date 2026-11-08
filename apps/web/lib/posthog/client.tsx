"use client";

import posthog from "posthog-js";
import { useEffect } from "react";
import { sanitizeEvent } from "./sanitize";

/**
 * posthog-js init options (exported so tests can assert them). We send explicit events only:
 * autocapture and session recording are off, and any text/attributes that could still be captured are masked.
 */
export const POSTHOG_OPTIONS = {
  person_profiles: "identified_only",
  capture_pageview: "history_change",
  autocapture: false,
  capture_dead_clicks: false,
  capture_heatmaps: false,
  disable_session_recording: true,
  mask_all_text: true,
  mask_all_element_attributes: true,
  // Allowlisted query params only; masks /invite/{token} and /t/{token} in every URL/path property.
  before_send: (e) => sanitizeEvent(e),
} satisfies Partial<import("posthog-js").PostHogConfig>;

let initialised = false;
function init() {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (initialised || !key || typeof window === "undefined") return;
  initialised = true;
  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com",
    ...POSTHOG_OPTIONS,
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
