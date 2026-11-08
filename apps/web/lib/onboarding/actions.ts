"use server";

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { ajAuth, ajProbe, protect } from "@/lib/arcjet";
import { memberTag, orgTag } from "@/lib/auth/tags";
import { requireUser } from "@/lib/auth/dal";
import type { ActionResult } from "@/lib/auth/schemas";
import { EVENTS } from "@/lib/posthog/events";
import { captureServer } from "@/lib/posthog/server";
import { createClient } from "@/lib/supabase/server";
import { mapCreateOrganizationError } from "./errors";
import { dottedFieldErrors, onboardingSchema, type OnboardingInput } from "./schemas";
import { isValidSlug } from "./slug";

export type SlugStatus = "available" | "taken" | "reserved" | "invalid";

/** Probe endpoint (leaks existence, so rate limited). Signed-out callers are fine: the wizard sits after signup. */
export async function checkSlug(slug: string): Promise<{ status: SlugStatus }> {
  const value = typeof slug === "string" ? slug.trim().toLowerCase() : "";
  if (!isValidSlug(value)) return { status: "invalid" };
  const decision = await protect(ajProbe);
  if (!decision.allowed) return { status: "invalid" };

  const supabase = await createClient();
  const { data: reserved } = await supabase.from("reserved_slugs").select("slug").eq("slug", value).maybeSingle();
  if (reserved) return { status: "reserved" };
  const { data: available, error } = await supabase.rpc("is_slug_available", { slug: value });
  if (error) return { status: "invalid" };
  return { status: available ? "available" : "taken" };
}

/**
 * Create the organization, its first location and the owner membership in ONE RPC, then redirect to /{slug}.
 * Returns only failures. The client never supplies organization_id, role or package: the RPC derives them.
 */
export async function createOrganization(input: OnboardingInput): Promise<ActionResult> {
  const user = await requireUser("/onboarding");

  const decision = await protect(ajAuth);
  if (!decision.allowed) {
    return { ok: false, code: "RATE_LIMITED", formError: "Too many attempts. Please wait a moment and try again." };
  }

  const parsed = onboardingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: dottedFieldErrors(parsed.error) };
  const { name, slug, location, branding } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_organization", {
    name,
    slug,
    location: {
      name: location.name,
      address: location.address,
      city: location.city,
      phone: location.phone,
      timezone: location.timezone,
      currency: location.currency,
      tax_rate_bps: location.taxRateBps,
      service_charge_bps: location.serviceChargeBps,
      tax_on_service_charge: location.taxOnServiceCharge,
    },
    branding: branding ? { logo_url: branding.logoUrl, primary_color: branding.primaryColor } : null,
  });
  if (error) return mapCreateOrganizationError(error.message);

  const created = data as { organization_id?: string; slug?: string } | null;
  const orgId = created?.organization_id;
  if (orgId) {
    updateTag(memberTag(user.id, orgId));
    updateTag(orgTag(orgId));
    captureServer(EVENTS.onboardingCompleted, { distinctId: user.id, organizationId: orgId });
    captureServer(EVENTS.trialStarted, { distinctId: user.id, organizationId: orgId });
  }
  redirect(`/${created?.slug ?? slug}`);
}
