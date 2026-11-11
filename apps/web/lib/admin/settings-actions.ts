"use server";

import { updateTag } from "next/cache";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/auth/dal";
import { EVENTS } from "@/lib/posthog/events";
import { captureServer } from "@/lib/posthog/server";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/auth/schemas";
import {
  formToObject,
  maintenanceBannerFormSchema,
  ownedOrgCapFormSchema,
  parseTaxPresetsForm,
  settingsFieldErrors,
  signupFormSchema,
  taxPresetsSchema,
  type SettingKey,
} from "./platform-settings-schemas";

const FLAGS_TAG = "platform-flags";

function failure(error: { code?: string; message: string }): ActionResult {
  if (error.code === "42501") return { ok: false, code: "FORBIDDEN", formError: "You don't have access to do that." };
  if (error.message.includes("INVALID_SETTING")) return { ok: false, formError: "That value isn't allowed." };
  console.error(`[admin] platform setting write failed: ${error.message}`);
  return { ok: false, formError: "Could not save the setting. Try again." };
}

function invalid(error: z.ZodError): ActionResult {
  return { ok: false, ...settingsFieldErrors(error) };
}

/** RPC -> on a REAL change only: refresh the flags cache and send { key } to PostHog. */
async function save(key: SettingKey, value: unknown, adminId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_update_platform_setting", { key, value: value as never });
  if (error) return failure(error);
  if (data === true) {
    updateTag(FLAGS_TAG);
    captureServer(EVENTS.platformSettingUpdated, { distinctId: adminId, properties: { key } });
  }
  return { ok: true };
}

/** Open or close new signups. Existing users can still sign in. */
export async function updateSignup(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  const parsed = signupFormSchema.safeParse(formToObject(formData));
  if (!parsed.success) return invalid(parsed.error);
  return save("signup", parsed.data, admin.id);
}

/** Maintenance banner. The message is plain text (no < or >), at most 200 characters. */
export async function updateMaintenanceBanner(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  const parsed = maintenanceBannerFormSchema.safeParse(formToObject(formData));
  if (!parsed.success) return invalid(parsed.error);
  return save("maintenance_banner", parsed.data, admin.id);
}

/** Tax presets (integer basis points). Presets only: existing locations are never changed. */
export async function updateTaxPresets(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  const form = parseTaxPresetsForm(formData);
  if (!form.ok) return { ok: false, fieldErrors: form.fieldErrors, ...(form.formError ? { formError: form.formError } : {}) };
  const parsed = taxPresetsSchema.safeParse(form.value);
  if (!parsed.success) return invalid(parsed.error);
  return save("tax_presets", parsed.data, admin.id);
}

/** How many organizations one user may own (1–100). */
export async function updateOwnedOrgCap(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  const parsed = ownedOrgCapFormSchema.safeParse(formToObject(formData));
  if (!parsed.success) return invalid(parsed.error);
  return save("owned_org_cap", parsed.data, admin.id);
}
