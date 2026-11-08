import "server-only";
import { Resend } from "resend";
import { serverEnv } from "../env.server";

let cached: Resend | undefined;

/** Lazily-created Resend SDK client. Throws only if RESEND_API_KEY is missing (callers go through `send`, which catches). */
export function getResend(): Resend {
  if (cached) return cached;
  const key = serverEnv.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  cached = new Resend(key);
  return cached;
}

/** Test hook. */
export function resetResendForTests(): void {
  cached = undefined;
}
