/**
 * Scrubbing for everything that leaves for PostHog. Allowlist based: a new query param is dropped by default.
 */

/** Query params that may be sent: utm_* and ref. Everything else (email, phone, token_hash, next, ...) is dropped. */
const ALLOWED_PARAM = /^(utm_[a-z0-9_]+|ref)$/i;

/** Path segments whose next segment is a secret/capability token: /invite/{token}, /t/{qr_token} (also /s/{tenant}/t/{token}). */
const TOKEN_PATH = /\/(invite|t)\/[^/]+/gi;

/** Property keys that hold a URL or path. */
const URL_KEY = /url|pathname|referrer|href/i;

/** Values PostHog itself uses instead of a URL. */
const PASS_THROUGH = new Set(["$direct"]);

/**
 * Scrub a URL (absolute or path-only) before it reaches PostHog:
 *  - `/invite/{x}` -> `/invite/[token]`, `/t/{x}` -> `/t/[token]` (anywhere in the path)
 *  - only utm_* and ref query params survive
 *  - userinfo and the fragment are dropped
 * Absolute stays absolute, a path stays a path. Anything that is neither returns "[invalid-url]".
 */
export function sanitizeUrl(input: string): string {
  if (PASS_THROUGH.has(input)) return input;
  const absolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(input);
  if (!absolute && !input.startsWith("/")) return "[invalid-url]";
  let url: URL;
  try {
    url = new URL(input, "http://placeholder.invalid");
  } catch {
    return "[invalid-url]";
  }
  url.pathname = url.pathname.replace(TOKEN_PATH, (_m, seg: string) => `/${seg.toLowerCase()}/[token]`);
  for (const key of [...url.searchParams.keys()]) {
    if (!ALLOWED_PARAM.test(key)) url.searchParams.delete(key);
  }
  url.hash = "";
  url.username = "";
  url.password = "";
  return absolute ? url.toString() : `${url.pathname}${url.search}`;
}

/** Sanitise every URL-like property (key matches /url|pathname|referrer|href/i), recursing into plain objects such as $set. */
export function sanitizeProperties<T extends Record<string, unknown>>(props: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (typeof v === "string" && URL_KEY.test(k)) out[k] = v ? sanitizeUrl(v) : v;
    else if (v && typeof v === "object" && !Array.isArray(v)) out[k] = sanitizeProperties(v as Record<string, unknown>);
    else out[k] = v;
  }
  return out as T;
}

/** PostHog `before_send`. */
export function sanitizeEvent<E extends { properties?: Record<string, unknown> } | null>(event: E): E {
  if (!event?.properties) return event;
  const next = { ...event, properties: sanitizeProperties(event.properties) };
  // $set / $set_once live on the event itself in some SDK versions.
  const rec = next as Record<string, unknown>;
  for (const k of ["$set", "$set_once"]) {
    const v = rec[k];
    if (v && typeof v === "object") rec[k] = sanitizeProperties(v as Record<string, unknown>);
  }
  return next;
}
