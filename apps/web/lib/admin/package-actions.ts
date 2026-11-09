"use server";

import { updateTag } from "next/cache";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/auth/dal";
import { EVENTS, type EventName } from "@/lib/posthog/events";
import { captureServer } from "@/lib/posthog/server";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/auth/schemas";
import {
  archiveSchema,
  packageInputSchema,
  planFormToObject,
  setDefaultSchema,
  toRpcInput,
  updatePackageSchema,
} from "./package-schemas";

const PACKAGES_TAG = "packages"; // same tag as getPublicPackages
const GENERIC = "Could not save the plan. Try again.";

type RpcError = { code?: string; message: string };

function failure(error: RpcError): ActionResult {
  const msg = error.message;
  if (error.code === "23505") {
    return { ok: false, code: "DUPLICATE_CODE", fieldErrors: { code: ["A plan with that code already exists."] }, formError: "A plan with that code already exists." };
  }
  if (error.code === "42501") return { ok: false, code: "FORBIDDEN", formError: "You don't have access to do that." };
  if (msg.includes("PACKAGE_NOT_FOUND")) return { ok: false, code: "NOT_FOUND", formError: "That plan no longer exists." };
  if (msg.includes("PACKAGE_IN_USE")) {
    const m = "Plans with subscriptions can't change currency.";
    return { ok: false, code: "PACKAGE_IN_USE", fieldErrors: { currency: [m] }, formError: m };
  }
  if (msg.includes("DEFAULT_PACKAGE")) {
    return { ok: false, code: "DEFAULT_PACKAGE", formError: "Set another plan as the default before archiving this one." };
  }
  if (msg.includes("PACKAGE_INACTIVE")) {
    return { ok: false, code: "PACKAGE_INACTIVE", formError: "Restore the plan before making it the default." };
  }
  console.error(`[admin] package write failed: ${msg}`);
  return { ok: false, formError: GENERIC };
}

function invalid(error: z.ZodError): ActionResult {
  return { ok: false, fieldErrors: z.flattenError(error).fieldErrors as Record<string, string[]> };
}

function afterWrite(event: EventName, adminId: string, code: string | null): void {
  updateTag(PACKAGES_TAG);
  captureServer(event, { distinctId: adminId, properties: code ? { code } : {} });
}

/** Create a plan. Platform admins only; audit row written by admin_create_package in the same transaction. */
export async function createPackage(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  const parsed = packageInputSchema.safeParse(planFormToObject(formData));
  if (!parsed.success) return invalid(parsed.error);
  const { code, ...rest } = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_create_package", { input: { code, ...toRpcInput(rest) } });
  if (error) return failure(error);

  afterWrite(EVENTS.packageCreated, admin.id, code);
  return { ok: true };
}

/** Update a plan's editable fields (not its code). No-op updates succeed without an audit row. */
export async function updatePackage(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  const parsed = updatePackageSchema.safeParse(planFormToObject(formData));
  if (!parsed.success) return invalid(parsed.error);
  const { packageId, ...rest } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_update_package", {
    package_id: packageId,
    input: toRpcInput(rest),
  });
  if (error) return failure(error);

  updateTag(PACKAGES_TAG);
  if (data === true) captureServer(EVENTS.packageUpdated, { distinctId: admin.id, properties: {} });
  return { ok: true };
}

/** Archive (archived=true) or restore (archived=false) a plan. The row is never deleted. */
export async function archivePackage(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  const parsed = archiveSchema.safeParse(planFormToObject(formData));
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_package_active", {
    package_id: parsed.data.packageId,
    active: !parsed.data.archived,
  });
  if (error) return failure(error);

  afterWrite(EVENTS.packageArchived, admin.id, null);
  return { ok: true };
}

/** Make a plan the single default. Atomic: the RPC locks the packages rows. */
export async function setDefaultPackage(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  const parsed = setDefaultSchema.safeParse(planFormToObject(formData));
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_default_package", { package_id: parsed.data.packageId });
  if (error) return failure(error);

  afterWrite(EVENTS.packageDefaultChanged, admin.id, null);
  return { ok: true };
}
