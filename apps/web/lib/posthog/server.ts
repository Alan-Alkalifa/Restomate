import "server-only";

import { after } from "next/server";
import { PostHog } from "posthog-node";
import { EVENT_NAMES, type EventName, type EventProperties } from "./events";

/** Property keys that look like PII are dropped, whatever the caller passes. */
const PII_KEY = /(e-?mail|name|phone|token|password|secret|address)/i;

export function scrubProperties(props: EventProperties | undefined): EventProperties {
  return Object.fromEntries(Object.entries(props ?? {}).filter(([k]) => !PII_KEY.test(k)));
}

let client: PostHog | null | undefined;
function getClient(): PostHog | null {
  if (client !== undefined) return client;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  client = key
    ? new PostHog(key, { host: process.env.NEXT_PUBLIC_POSTHOG_HOST || undefined, flushAt: 1, flushInterval: 0 })
    : null; // analytics is optional: no key -> no-op
  return client;
}

/**
 * Capture a server-side event. Never throws, no-op without keys, flushes after the response via
 * `after()`. distinctId is the user id; the organization is a PostHog group. No PII in properties.
 */
export function captureServer(
  event: EventName,
  opts: { distinctId: string; organizationId?: string; properties?: EventProperties },
): void {
  try {
    const ph = getClient();
    if (!ph || !EVENT_NAMES.includes(event)) return;
    ph.capture({
      distinctId: opts.distinctId,
      event,
      properties: scrubProperties(opts.properties),
      ...(opts.organizationId ? { groups: { organization: opts.organizationId } } : {}),
    });
    after(async () => {
      try {
        await ph.flush();
      } catch {
        /* analytics must never fail a request */
      }
    });
  } catch {
    /* swallow */
  }
}
