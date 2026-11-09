"use server";

import { updateTag } from "next/cache";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/auth/dal";
import { orgTag } from "@/lib/auth/tags";
import { EVENTS } from "@/lib/posthog/events";
import { captureServer } from "@/lib/posthog/server";
import { createClient } from "@/lib/supabase/server";
import { callAdminListTenants, toRpcArgs } from "./tenants";
import type { ActionResult } from "@/lib/auth/schemas";

// Same character class as admin_set_org_status in SQL: \s, NBSP, Unicode spaces and zero-width characters.
const WS = "[\\s\\u00a0\\u1680\\u2000-\\u200f\\u2028\\u2029\\u202f\\u205f\\u2060\\u3000\\ufeff]";
const stripEdges = (s: string) => s.replace(new RegExp(`^${WS}+|${WS}+$`, "gu"), "");
const visibleLength = (s: string) => s.replace(new RegExp(`${WS}+`, "gu"), "").length;

const setOrgStatusSchema = z.object({
  orgId: z.uuid(),
  status: z.enum(["active", "suspended"]),
  reason: z
    .string()
    .transform(stripEdges)
    .pipe(
      z
        .string()
        .max(500, "Keep it under 500 characters.")
        .refine((s) => visibleLength(s) >= 5, "Enter at least 5 characters."),
    ),
});

/**
 * Suspend or reactivate a tenant. Platform admins only.
 * The write goes through admin_set_org_status (security definer, re-checks is_platform_admin(), writes the
 * audit_logs row with the admin's user id and the reason in the same transaction). No service role.
 */
export async function setOrgStatus(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();

  const parsed = setOrgStatusSchema.safeParse({
    orgId: formData.get("orgId"),
    status: formData.get("status"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) {
    return { ok: false, fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  const { orgId, status, reason } = parsed.data;

  // Need the slug for the storefront cache tag; also confirms the org exists.
  const found = await callAdminListTenants(toRpcArgs({ orgId, pageSize: 1 }));
  const org = found.rows[0];
  if (!org) return { ok: false, formError: "Tenant not found." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_org_status", { org: orgId, status, reason });
  if (error) {
    console.error(`[admin] setOrgStatus failed: ${error.message}`);
    return { ok: false, formError: "Could not update the tenant. Try again." };
  }

  updateTag(orgTag(orgId));
  updateTag(`storefront:${org.slug}`);
  captureServer(EVENTS.orgStatusChanged, {
    distinctId: admin.id,
    organizationId: orgId,
    properties: { status },
  });
  return { ok: true };
}
