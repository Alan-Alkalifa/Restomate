"use server";

import { requireOrgContext, requirePermission } from "@/lib/auth/dal";
import type { ActionResult } from "@/lib/auth/schemas";
import { canTransitionKot } from "@/components/kitchen/kitchen-model";
import { FIXTURE_START, itemStatus, ticketStatus } from "./_store";

/*
 * TEMPORARY SEAM until #123 (MSC-T04, lib/orders) merges. Delete this file and bind the real `updateKotStatus`,
 * `bumpKot` and `setKotItemStatus` from "@/lib/orders/actions" in page.tsx (same `OrderAction` shape: orgSlug and
 * locationId first, then `prev`, `formData`). The real ones call the update_kot_status / set_kot_item_status RPCs.
 * This version keeps statuses in memory (./_store.ts, one dev server process) so the screen is drivable. It still does
 * the checks that matter: org membership, kitchen.update, a location the caller can access, and the KOT machine.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// (INVALID_INPUT / INVALID_TRANSITION codes arrive with #123's ActionErrorCode additions; the seam sends only a message.)
const INVALID: ActionResult = { ok: false, formError: "That request was not valid." };
const STUCK: ActionResult = { ok: false, formError: "That ticket cannot move to that status." };

async function authorize(orgSlug: string, locationId: string): Promise<ActionResult | null> {
  const ctx = await requireOrgContext(orgSlug);
  await requirePermission(ctx.org.id, "kitchen.update");
  if (!ctx.locations.some((l) => l.id === locationId)) return { ok: false, code: "FORBIDDEN", formError: "That ticket could not be found in this location." };
  return null;
}

export async function updateKotStatus(orgSlug: string, locationId: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const denied = await authorize(orgSlug, locationId);
  if (denied) return denied;
  const id = String(formData.get("ticketId") ?? "");
  const to = String(formData.get("status") ?? "");
  if (!UUID.test(id) || (to !== "in_progress" && to !== "ready")) return INVALID;
  const from = ticketStatus.get(id) ?? FIXTURE_START.get(id);
  if (!from || !canTransitionKot(from, to)) return STUCK;
  ticketStatus.set(id, to);
  return { ok: true };
}

export async function bumpKot(orgSlug: string, locationId: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const denied = await authorize(orgSlug, locationId);
  if (denied) return denied;
  const id = String(formData.get("ticketId") ?? "");
  if (!UUID.test(id)) return INVALID;
  const from = ticketStatus.get(id) ?? FIXTURE_START.get(id);
  if (!from || !canTransitionKot(from, "bumped")) return STUCK;
  ticketStatus.set(id, "bumped");
  return { ok: true };
}

export async function setKotItemStatus(orgSlug: string, locationId: string, _prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const denied = await authorize(orgSlug, locationId);
  if (denied) return denied;
  const id = String(formData.get("ticketItemId") ?? "");
  const to = String(formData.get("status") ?? "");
  if (!UUID.test(id) || (to !== "pending" && to !== "ready")) return INVALID;
  itemStatus.set(id, to);
  return { ok: true };
}
