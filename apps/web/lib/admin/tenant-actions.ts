"use server";

import { z } from "zod";
import { ajAuth, protect } from "@/lib/arcjet";
import { requirePlatformAdmin } from "@/lib/auth/dal";
import { publicEnv } from "@/lib/env";
import { EVENTS } from "@/lib/posthog/events";
import { captureServer } from "@/lib/posthog/server";
import { createAnonClient } from "@/lib/supabase/anon";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/auth/schemas";

const RATE_LIMITED: ActionResult = { ok: false, code: "RATE_LIMITED", formError: "Too many attempts. Try again later." };

const resetSchema = z.strictObject({ orgId: z.uuid(), userId: z.uuid() });

// Same link target as /forgot-password (auth/actions.ts).
const confirmUrl = (next: string) => `${publicEnv.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/auth/confirm?next=${encodeURIComponent(next)}`;

function failure(error: { code?: string; message: string }): ActionResult {
  if (error.code === "42501") return { ok: false, code: "FORBIDDEN", formError: "You don't have access to do that." };
  if (error.message.includes("RATE_LIMITED")) return RATE_LIMITED;
  if (error.message.includes("NOT_AN_OWNER")) return { ok: false, code: "NOT_FOUND", formError: "That owner no longer exists." };
  console.error(`[admin] owner password reset failed: ${error.message}`); // message only, never an address
  return { ok: false, formError: "Could not send the reset email. Try again." };
}

/**
 * Email a password-reset link to an active owner of a tenant. Platform admins only.
 * Order: admin check -> Zod -> Arcjet -> RPC (verifies the active owner, per-admin 5/hour cap, one audit row without
 * an email, returns the address to this server only) -> Supabase recovery mail through the cookie-less anon client
 * (no service role). `ok: true` means "we asked Supabase to send it"; delivery is never reported.
 */
export async function sendOwnerPasswordReset(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();

  const fields: Record<string, unknown> = {};
  for (const key of new Set(formData.keys())) {
    if (!key.startsWith("$ACTION")) fields[key] = formData.get(key); // React form-action bookkeeping is skipped; anything else is checked
  }
  const parsed = resetSchema.safeParse(fields);
  if (!parsed.success) {
    const flat = z.flattenError(parsed.error);
    return {
      ok: false,
      fieldErrors: flat.fieldErrors as Record<string, string[]>,
      ...(flat.formErrors.length > 0 ? { formError: flat.formErrors.join(" ") } : {}),
    };
  }
  const { orgId, userId } = parsed.data;

  const decision = await protect(ajAuth); // no email is passed to Arcjet
  if (!decision.allowed) return RATE_LIMITED;

  const supabase = await createClient();
  const { data: email, error } = await supabase.rpc("admin_prepare_owner_password_reset", { org_id: orgId, user_id: userId });
  if (error) return failure(error);
  if (typeof email !== "string" || email === "") return failure({ message: "no address returned" });

  // Provider errors (including the per-address cooldown) are swallowed: the result never reveals delivery.
  try {
    const { error: sendError } = await createAnonClient().auth.resetPasswordForEmail(email, { redirectTo: confirmUrl("/reset-password") });
    if (sendError) console.error(`[admin] recovery mail not accepted: ${sendError.message}`);
  } catch (e) {
    console.error(`[admin] recovery mail failed: ${e instanceof Error ? e.message : "unknown"}`);
  }

  captureServer(EVENTS.tenantPasswordResetSent, { distinctId: admin.id, properties: { orgId } });
  return { ok: true };
}
