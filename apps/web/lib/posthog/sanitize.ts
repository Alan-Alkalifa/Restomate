/**
 * Scrubbing for everything that leaves for PostHog. Allowlist based: a new query param is dropped by default.
 */

/** Query params that may be sent: utm_* and ref. Everything else (email, phone, token_hash, next, ...) is dropped. */
const ALLOWED_PARAM = /^(utm_[a-z0-9_]+|ref)$/i;

/** Path segments whose next segment is a secret/capability token: /invite/{token}, /t/{qr_token} (also /s/{tenant}/t/{token}). */
const TOKEN_PATH = /\/(invite|t)\/+[^/]+/gi;

/** Property keys that hold exception data ($exception_list, $exception_message, ...). */
const EXCEPTION_KEY = /^\$exception/i;

/** Property keys that hold a URL or path. */
const URL_KEY = /url|pathname|referrer|href/i;

/** Values PostHog itself uses instead of a URL. */
const PASS_THROUGH = new Set(["$direct"]);

/** Decode %xx per segment so `/%74/abc` or `/invit%65/abc` cannot dodge the token rules (undecodable segments are kept as is). */
function decodeSegments(path: string): string {
  return path
    .split("/")
    .map((seg) => {
      try {
        return decodeURIComponent(seg);
      } catch {
        return seg;
      }
    })
    .join("/");
}

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
  url.pathname = decodeSegments(url.pathname).replace(TOKEN_PATH, (_m, seg: string) => `/${seg.toLowerCase()}/[token]`);
  for (const key of [...url.searchParams.keys()]) {
    if (!ALLOWED_PARAM.test(key)) url.searchParams.delete(key);
  }
  url.hash = "";
  url.username = "";
  url.password = "";
  return absolute ? url.toString() : `${url.pathname}${url.search}`;
}

const TEXT_URL = /https?:\/\/[^\s"'<>)\]]+/gi;
const TEXT_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const TEXT_JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
const TEXT_PHONE = /\+?\d[\d\s().-]{6,}\d/g;
const TEXT_OPAQUE = /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}\b/g;

/**
 * Scrub free text (exception messages, stack traces): URLs go through sanitizeUrl, then emails, JWTs,
 * phone-like digit runs and long opaque tokens are redacted, and /invite|t/{x} paths are masked.
 */
export function sanitizeText(input: string): string {
  return input
    .replace(TEXT_URL, (u) => sanitizeUrl(u))
    .replace(TOKEN_PATH, (_m, seg: string) => `/${seg.toLowerCase()}/[token]`)
    .replace(TEXT_EMAIL, "[email]")
    .replace(TEXT_JWT, "[token]")
    .replace(TEXT_PHONE, "[number]")
    .replace(TEXT_OPAQUE, "[token]");
}

/** Deep-scrub every string in an exception payload (message, type, stack frames, filenames). */
function scrubDeep(value: unknown): unknown {
  if (typeof value === "string") return sanitizeText(value);
  if (Array.isArray(value)) return value.map(scrubDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubDeep(v)]));
  }
  return value;
}

/** Sanitise every URL-like property (key matches /url|pathname|referrer|href/i), recursing into plain objects such as $set. */
export function sanitizeProperties<T extends Record<string, unknown>>(props: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (EXCEPTION_KEY.test(k)) out[k] = scrubDeep(v);
    else if (typeof v === "string" && URL_KEY.test(k)) out[k] = v ? sanitizeUrl(v) : v;
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
