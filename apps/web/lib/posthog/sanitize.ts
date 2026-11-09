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
// Lookbehind: one start per run of local-part characters (otherwise a long run without "@" is rescanned from every position).
const TEXT_EMAIL = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const TEXT_JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g;
const TEXT_PHONE = /\+?\d[\d\s().-]{6,}\d/g;
// One start per run of word characters (lookbehind instead of \b, which also matched after every "-" and made
// "a-a-a-…" quadratic).
const TEXT_OPAQUE = /(?<![A-Za-z0-9_-])(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}(?![A-Za-z0-9_-])/g;

/** Key names whose value is a secret. Matched as a substring of the key, so `user_password` and `X-Api-Key` count too. */
const SENSITIVE_KEY =
  /password|passwd|pwd|secret|token|api[_-]?key|apikey|authorization|credential|service[_-]?role|private[_-]?key|session[_-]?id|\bcookie\b/i;

/**
 * Head of a `key=value`, `key: value`, `"key":"value"` (also backslash-escaped, as in JSON inside a message) or URL
 * query pair: groups 1 quote, 2 key, 3 separator. Linear: the key is at most 64 characters and only starts at a word
 * boundary. The value is read only for secret-looking keys, by TEXT_VALUE.
 */
const TEXT_HEAD = /(?<![\w.-])(\\{0,3}["']?)([A-Za-z][\w.-]{0,63})\1(\s{0,3}[:=]\s{0,3})(?!\[token\])/g;

/** Value after the head (sticky, so it only matches right there): groups 1 opening quote, 2 quoted value, 3 auth scheme. */
const TEXT_VALUE = /(?:(\\{0,3}["'])((?:(?!\1)[^\r\n]){0,2000})\1|((?:Bearer|Basic|Token)\s+)?[^\s&,;"'<>)\]}]{1,2000})/y;

/** `Cookie:` / `Set-Cookie:` header lines hold several `a=1; b=2` pairs: mask up to the end of the line or quote. */
const TEXT_COOKIE_HEADER = /\b((?:set-)?cookie\s{0,3}:\s{0,3})[^\r\n"']{1,2000}/gi;

const MASK = "[token]";

function maskPairs(input: string): string {
  const text = input.replace(TEXT_COOKIE_HEADER, (_m, head: string) => `${head}${MASK}`);
  // Manual scan (not String.replace) so a harmless key does not swallow a secret in its value: we only read the
  // value of secret-looking keys and always resume right behind the separator, which keeps the pass linear.
  const heads = new RegExp(TEXT_HEAD.source, TEXT_HEAD.flags);
  const value = new RegExp(TEXT_VALUE.source, TEXT_VALUE.flags);
  let out = "";
  let last = 0;
  for (let m = heads.exec(text); m; m = heads.exec(text)) {
    const [head, , key] = m;
    if (!SENSITIVE_KEY.test(key)) continue;
    value.lastIndex = m.index + head.length;
    const v = value.exec(text);
    if (!v) continue;
    // Keep the key, separator and quoting so the message still reads naturally; only the value is replaced.
    out += text.slice(last, m.index) + head + (v[1] !== undefined ? `${v[1]}${MASK}${v[1]}` : `${v[3] ?? ""}${MASK}`);
    last = m.index + head.length + v[0].length;
    heads.lastIndex = last;
  }
  return out + text.slice(last);
}

/**
 * Scrub free text (exception messages, stack traces): values of secret-looking keys (`password=x`, `"token": "x"`,
 * `Authorization: Bearer x`, `?api_key=x`) are masked first, then URLs go through sanitizeUrl, then emails, JWTs,
 * phone-like digit runs and long opaque tokens are redacted, and /invite|t/{x} paths are masked.
 */
export function sanitizeText(input: string): string {
  return maskPairs(input)
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
