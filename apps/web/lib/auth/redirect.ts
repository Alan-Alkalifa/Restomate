/**
 * Accepts only same-site relative paths ("/foo?x=1"). Rejects absolute URLs, protocol-relative ("//evil.com"),
 * backslash tricks and control characters, so `?next=` can never become an open redirect.
 */
export function sanitizeNext(next: string | null | undefined, fallback = "/"): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 2048) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(next)) return fallback;
  return next;
}
