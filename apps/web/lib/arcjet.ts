import "server-only";

import { serverEnv } from "@/lib/env.server";
import arcjet, {
  detectBot,
  request as arcjetRequest,
  shield,
  slidingWindow,
  validateEmail,
  type ArcjetDecision,
  type ArcjetNextRequest,
} from "@arcjet/next";

/**
 * The ONLY place Arcjet is configured (CLAUDE.md "Security (Arcjet)"). One shared base instance
 * (shield only: safe for every page view, crawlers included); each preset adds bot detection, its own
 * rate limit (and email validation for signup).
 *
 * - Mode: DRY_RUN outside production (decisions are logged, never enforced), LIVE in production.
 * - ARCJET_KEY missing outside production: `protect()` returns `{ allowed: true }` and logs once, so
 *   local dev and CI run without the key. In production the key is read through the validated env
 *   (`serverEnv`), which throws when it is missing: a misconfiguration fails fast instead of silently
 *   running unprotected.
 * - Arcjet fails open on its own errors by design; an errored decision is treated as allowed.
 * - Never exclude-by-accident: the DOKU webhook is skipped in proxy.ts and never calls protect().
 */

export type ProtectReason = "RATE_LIMITED" | "BOT" | "SHIELD" | "EMAIL_INVALID";
export type ProtectResult = { allowed: true } | { allowed: false; reason: ProtectReason };

export type ArcjetPreset = {
  readonly name: "auth" | "signup" | "publicForm" | "probe";
  /** Sliding-window rate limit per client IP. */
  readonly limit: { readonly interval: string; readonly max: number };
  /** Validate `opts.email` (disposable / invalid / no MX). */
  readonly validatesEmail: boolean;
};

/** login / password reset */
export const ajAuth: ArcjetPreset = { name: "auth", limit: { interval: "1m", max: 10 }, validatesEmail: false };
/** signup: stricter, plus email validation */
export const ajSignup: ArcjetPreset = { name: "signup", limit: { interval: "10m", max: 5 }, validatesEmail: true };
/** storefront / reservation / feedback forms */
export const ajPublicForm: ArcjetPreset = { name: "publicForm", limit: { interval: "1m", max: 20 }, validatesEmail: false };
/** probe endpoints (checkSlug, getInvitationPreview): they leak existence, but checkSlug runs per debounced keystroke, so 20/min (not tighter than auth) */
export const ajProbe: ArcjetPreset = { name: "probe", limit: { interval: "1m", max: 20 }, validatesEmail: false };

const mode = () => (process.env.NODE_ENV === "production" ? "LIVE" : "DRY_RUN") as "LIVE" | "DRY_RUN";

type Protectable = { protect(req: ArcjetNextRequest, props?: Record<string, unknown>): Promise<ArcjetDecision> };
type WithRule = Protectable & { withRule(rule: unknown): WithRule };

let warned = false;
function warnOnce(msg: string) {
  if (warned) return;
  warned = true;
  console[process.env.NODE_ENV === "production" ? "error" : "warn"](`[arcjet] ${msg}`);
}

let baseInstance: WithRule | null | undefined;
/** Shared base: shield only. null when ARCJET_KEY is unset. */
function base(): WithRule | null {
  if (baseInstance !== undefined) return baseInstance;
  // Production: validated env (throws if ARCJET_KEY is missing). Elsewhere: optional, so dev needs no other vars.
  const key = process.env.NODE_ENV === "production" ? serverEnv.ARCJET_KEY : process.env.ARCJET_KEY;
  if (!key) {
    warnOnce("ARCJET_KEY is not set; requests are not protected by Arcjet.");
    return (baseInstance = null);
  }
  baseInstance = arcjet({
    key,
    rules: [shield({ mode: mode() })],
  }) as unknown as WithRule;
  return baseInstance;
}

const presetInstances = new Map<ArcjetPreset["name"], Protectable>();
function instanceFor(preset: ArcjetPreset): Protectable | null {
  const cached = presetInstances.get(preset.name);
  if (cached) return cached;
  const b = base();
  if (!b) return null;
  let inst = b
    .withRule(detectBot({ mode: mode(), allow: [] }))
    .withRule(slidingWindow({ mode: mode(), interval: preset.limit.interval, max: preset.limit.max }));
  if (preset.validatesEmail) {
    inst = inst.withRule(validateEmail({ mode: mode(), deny: ["DISPOSABLE", "INVALID", "NO_MX_RECORDS"] }));
  }
  presetInstances.set(preset.name, inst);
  return inst;
}

function reasonOf(decision: ArcjetDecision): ProtectReason {
  const r = decision.reason;
  if (r.isRateLimit()) return "RATE_LIMITED";
  if (r.isBot()) return "BOT";
  if (r.isEmail()) return "EMAIL_INVALID";
  return "SHIELD";
}

export function mapDecision(decision: ArcjetDecision): ProtectResult {
  if (decision.isErrored()) return { allowed: true }; // Arcjet fails open
  if (decision.isDenied()) return { allowed: false, reason: reasonOf(decision) };
  return { allowed: true };
}

/**
 * Protect a Server Action / route handler. Reads the current request's headers via next/headers
 * (must run inside a request scope). `opts.email` is only used by `ajSignup`.
 */
export async function protect(preset: ArcjetPreset, opts: { email?: string } = {}): Promise<ProtectResult> {
  const inst = instanceFor(preset);
  if (!inst) return { allowed: true };
  try {
    const req = await arcjetRequest();
    const props = preset.validatesEmail ? { email: opts.email ?? "" } : undefined;
    return mapDecision(await inst.protect(req, props));
  } catch {
    return { allowed: true }; // never break the request path because of the security layer
  }
}

/** Public + auth surfaces the proxy shields. Authenticated app areas (/[org], /admin) are not listed. */
const SHIELDED_PREFIXES = ["/login", "/signup", "/forgot-password", "/reset-password", "/invite", "/onboarding", "/auth", "/pricing", "/s"];

export function isShieldedPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return SHIELDED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Proxy-level shield: the shared base only (no bot rule, no rate limit), so crawlers and normal page
 * views are unaffected. Returns a 403 response when denied, else null. The DOKU webhook never reaches
 * this (excluded by the proxy matcher).
 */
export async function shieldRequest(req: ArcjetNextRequest): Promise<Response | null> {
  const b = base();
  if (!b) return null;
  try {
    const decision = await b.protect(req);
    if (!decision.isErrored() && decision.isDenied()) return new Response("Forbidden", { status: 403 });
  } catch {
    /* fail open */
  }
  return null;
}
