"use client";

import posthog from "posthog-js";

/*
 * Anonymous storefront funnel (CLAUDE.md "Analytics"). NO PII: only public identifiers (tenant slug, location id, item id)
 * and counts. Never a name, phone, note, cart contents text or token. PostHog is initialised app-wide with
 * person_profiles "identified_only", so a guest never gets a person profile.
 *
 * NOTE: these names should also be listed in lib/posthog/events.ts (DAVIN's file) so the list there stays complete.
 */
export const STOREFRONT_EVENTS = {
  menuViewed: "storefront_menu_viewed",
  itemAdded: "storefront_item_added",
  checkoutStarted: "storefront_checkout_started",
} as const;

type Props = Record<string, string | number | boolean | null>;

/** Fire-and-forget. A no-op when PostHog is not configured/loaded; analytics must never break the page. */
export function track(event: (typeof STOREFRONT_EVENTS)[keyof typeof STOREFRONT_EVENTS], props: Props): void {
  try {
    // Deferred one tick: this runs in a child effect, before the provider's init effect has run on the first render.
    setTimeout(() => { try { if (posthog.__loaded) posthog.capture(event, props); } catch { /* ignore */ } }, 0);
  } catch { /* ignore */ }
}
