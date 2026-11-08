/** Query params that carry secrets or redirect targets: never sent to analytics. */
const STRIPPED_PARAMS = ["token_hash", "token", "code", "next", "access_token", "refresh_token"];

/**
 * Scrub a URL (absolute or relative) before it reaches PostHog:
 *  - `/invite/{token}` -> `/invite/[token]`
 *  - token_hash / token / code / next (and auth token) query params removed
 *  - the fragment is dropped (implicit-flow tokens live there)
 * Returns the input unchanged in shape (absolute stays absolute, relative stays relative).
 */
export function sanitizeUrl(input: string): string {
  const absolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(input);
  let url: URL;
  try {
    url = new URL(input, "http://placeholder.invalid");
  } catch {
    return "[invalid-url]";
  }
  url.pathname = url.pathname.replace(/^\/invite\/[^/]+/, "/invite/[token]");
  for (const p of STRIPPED_PARAMS) url.searchParams.delete(p);
  url.hash = "";
  return absolute ? url.toString() : `${url.pathname}${url.search}`;
}

const URL_PROPERTIES = ["$current_url", "$referrer", "$initial_current_url", "$initial_referrer"];
const PATH_PROPERTIES = ["$pathname", "$initial_pathname"];

/** PostHog `before_send`: sanitise every URL/path property on the event. */
export function sanitizeEvent<E extends { properties?: Record<string, unknown> } | null>(event: E): E {
  if (!event?.properties) return event;
  const props = { ...event.properties };
  for (const k of [...URL_PROPERTIES, ...PATH_PROPERTIES]) {
    if (typeof props[k] === "string" && props[k]) props[k] = sanitizeUrl(props[k] as string);
  }
  return { ...event, properties: props };
}
