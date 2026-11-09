"use server";
// TEMPORARY SEAM (MSS-T09): stands in for MSS-T08. Saves nothing. Replaced by the real module.
import type { ActionResult } from "@/lib/auth/schemas";

const unavailable = async (): Promise<ActionResult> => ({ ok: false, formError: "Could not save the setting. Try again." });

export async function updateSignup(): Promise<ActionResult> {
  return unavailable();
}
export async function updateMaintenanceBanner(): Promise<ActionResult> {
  return unavailable();
}
export async function updateTaxPresets(): Promise<ActionResult> {
  return unavailable();
}
export async function updateOwnedOrgCap(): Promise<ActionResult> {
  return unavailable();
}
