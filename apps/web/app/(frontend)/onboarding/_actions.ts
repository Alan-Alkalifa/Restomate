"use server";

/**
 * TEMPORARY SEAM until MF-T15 (lib/onboarding) merges. Replace with re-exports of
 * checkSlug, createOrganization (suggestSlug is pure: import it
 * from lib/onboarding/slug in the wizard in place of components/onboarding/slug.ts) and requireUser.
 */
import type { ActionResult } from "@/components/auth/types";
import type { OnboardingInput, SlugStatus } from "@/components/onboarding/types";

export async function requireUser(): Promise<void> {}

export async function checkSlug(slug: string): Promise<{ status: SlugStatus }> {
  void slug;
  return { status: "invalid" };
}

export async function createOrganization(input: OnboardingInput): Promise<ActionResult> {
  void input;
  return { ok: false, formError: "Onboarding is not available yet." };
}
