import "server-only";

import { ajAuth, ajSignup, protect, type ProtectReason } from "@/lib/arcjet";
import { EVENTS } from "@/lib/posthog/events";
import { captureServer } from "@/lib/posthog/server";

/** Thin adapter between the auth actions and the shared security / analytics layers (lib/arcjet.ts, lib/posthog). */
export type GuardReason = ProtectReason;
export type GuardResult = { allowed: true } | { allowed: false; reason: GuardReason };

export function guard(kind: "auth" | "signup", opts: { email?: string } = {}): Promise<GuardResult> {
  return protect(kind === "signup" ? ajSignup : ajAuth, opts);
}

export function track(event: "signup_started" | "signup_completed", opts: { distinctId: string }): void {
  captureServer(event === "signup_started" ? EVENTS.signupStarted : EVENTS.signupCompleted, { distinctId: opts.distinctId });
}
