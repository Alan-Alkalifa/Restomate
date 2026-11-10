"use server";

import { updateTag } from "next/cache";
import type { z } from "zod";
import { requireOrgContext, requirePermission, requireUser } from "@/lib/auth/dal";
import type { PermissionKey } from "@/lib/auth/permissions";
import type { ActionResult } from "@/lib/auth/schemas";
import { EVENTS, type EventName } from "@/lib/posthog/events";
import { captureServer } from "@/lib/posthog/server";
import { createClient } from "@/lib/supabase/server";
import { mapOrderError } from "./errors";
import {
  applyDiscountSchema, bumpKotSchema, cancelOrderSchema, fieldErrors, kotItemSchema, orderIdSchema, parseForm,
  removeDiscountSchema, sendRoundSchema, tableIdSchema, updateKotSchema, voidItemSchema,
} from "./schemas";
import { assertLocation, ordersTag } from "./shared";

/*
 * Order Server Actions (docs/contracts/orders.md). Every mutation: requireOrgContext(slug) -> permission -> the
 * location must be one the caller can access -> Zod -> the id must belong to THIS location (IDOR) -> the RPC (which
 * authorizes again and does the work in one transaction) -> updateTag -> PostHog (ids and counts only, no PII).
 * orgSlug and locationId are bound server-side; an organization id never comes from FormData. Prices are never read
 * from the client: the RPC recomputes them.
 */
type OrderAction = (orgSlug: string, locationId: string, prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;

const NOT_FOUND: ActionResult = { ok: false, code: "FORBIDDEN", formError: "That item could not be found in this location." };

/** `anyOf`: the caller needs at least one (the RPC makes the finer decision, e.g. creator self-void). */
async function authorize(orgSlug: string, locationId: string, anyOf: PermissionKey[]) {
  const ctx = await requireOrgContext(orgSlug);
  assertLocation(ctx, locationId);
  if (!anyOf.some((p) => ctx.permissions.includes(p))) await requirePermission(ctx.org.id, anyOf[0]);
  const user = await requireUser();
  const supabase = await createClient();
  return { user, supabase, orgId: ctx.org.id };
}

type Supabase = Awaited<ReturnType<typeof createClient>>;
type InLocationTable = "orders" | "order_items" | "order_discounts" | "kitchen_tickets" | "kitchen_ticket_items" | "tables";

const inLocation = async (s: Supabase, table: InLocationTable, orgId: string, loc: string, id: string) =>
  (await s.from(table).select("id").eq("id", id).eq("organization_id", orgId).eq("location_id", loc).maybeSingle()).data;

function done(user: { id: string }, orgId: string, locationId: string, event: EventName, data?: Record<string, string | number | boolean>): ActionResult {
  captureServer(event, { distinctId: user.id, organizationId: orgId });
  updateTag(ordersTag(locationId));
  return data ? { ok: true, data } : { ok: true };
}

function parse<S extends z.ZodType>(schema: S, formData: FormData) {
  const p = parseForm(schema, formData);
  return p.success ? { data: p.data as z.infer<S> } : { error: { ok: false, fieldErrors: fieldErrors(p.error) } as ActionResult };
}

export const sendRound: OrderAction = async (orgSlug, locationId, _prev, formData) => {
  const { user, supabase, orgId } = await authorize(orgSlug, locationId, ["orders.create", "pos.use"]);
  const p = parse(sendRoundSchema, formData);
  if (p.error) return p.error;
  const v = p.data;
  const { data, error } = await supabase.rpc("submit_order_round", {
    location_id: locationId,
    // takeaway sends an explicit null (the parameter has no default); generated types model it as string
    table_id: (v.tableId ?? null) as unknown as string,
    channel: v.channel,
    // snake_case keys the RPC expects; nothing else is forwarded (no price, name, total or ids beyond the catalogue's)
    lines: v.lines.map((l) => ({
      item_id: l.itemId, variant_id: l.variantId ?? null, modifier_ids: l.modifierIds, quantity: l.quantity, note: l.note ?? null,
    })),
    client_ref: v.clientRef,
    customer_name: v.customerName,
    guest_count: v.guestCount,
  });
  if (error) return mapOrderError(error);
  const r = data as { orderId: string; orderNumber: number; roundNo: number; replayed: boolean };
  if (!r.replayed) captureServer(r.roundNo === 1 ? EVENTS.orderPlaced : EVENTS.orderRoundSent, { distinctId: user.id, organizationId: orgId });
  updateTag(ordersTag(locationId));
  return { ok: true, data: { orderId: r.orderId, orderNumber: r.orderNumber, roundNo: r.roundNo } };
};

export const voidItem: OrderAction = async (orgSlug, locationId, _prev, formData) => {
  const { user, supabase, orgId } = await authorize(orgSlug, locationId, ["orders.void", "orders.create"]);
  const p = parse(voidItemSchema, formData);
  if (p.error) return p.error;
  if (!(await inLocation(supabase, "order_items", orgId, locationId, p.data.orderItemId))) return NOT_FOUND;
  const { error } = await supabase.rpc("void_order_item", { item_id: p.data.orderItemId, reason: p.data.reason });
  return error ? mapOrderError(error) : done(user, orgId, locationId, EVENTS.orderItemVoided);
};

export const cancelOrder: OrderAction = async (orgSlug, locationId, _prev, formData) => {
  const { user, supabase, orgId } = await authorize(orgSlug, locationId, ["orders.void"]);
  const p = parse(cancelOrderSchema, formData);
  if (p.error) return p.error;
  if (!(await inLocation(supabase, "orders", orgId, locationId, p.data.orderId))) return NOT_FOUND;
  const { error } = await supabase.rpc("cancel_order", { order_id: p.data.orderId, reason: p.data.reason });
  return error ? mapOrderError(error) : done(user, orgId, locationId, EVENTS.orderCancelled);
};

export const applyDiscount: OrderAction = async (orgSlug, locationId, _prev, formData) => {
  const { user, supabase, orgId } = await authorize(orgSlug, locationId, ["pos.discount"]);
  const p = parse(applyDiscountSchema, formData);
  if (p.error) return p.error;
  if (!(await inLocation(supabase, "orders", orgId, locationId, p.data.orderId))) return NOT_FOUND;
  const { error } = await supabase.rpc("apply_order_discount", { order_id: p.data.orderId, amount: p.data.amount, reason: p.data.reason });
  return error ? mapOrderError(error) : done(user, orgId, locationId, EVENTS.discountApplied);
};

export const removeDiscount: OrderAction = async (orgSlug, locationId, _prev, formData) => {
  const { user, supabase, orgId } = await authorize(orgSlug, locationId, ["pos.discount"]);
  const p = parse(removeDiscountSchema, formData);
  if (p.error) return p.error;
  if (!(await inLocation(supabase, "order_discounts", orgId, locationId, p.data.discountId))) return NOT_FOUND;
  const { error } = await supabase.rpc("remove_order_discount", { discount_id: p.data.discountId, reason: p.data.reason });
  return error ? mapOrderError(error) : done(user, orgId, locationId, EVENTS.discountRemoved);
};

export const markOrderServed: OrderAction = async (orgSlug, locationId, _prev, formData) => {
  const { user, supabase, orgId } = await authorize(orgSlug, locationId, ["orders.create"]);
  const p = parse(orderIdSchema, formData);
  if (p.error) return p.error;
  if (!(await inLocation(supabase, "orders", orgId, locationId, p.data.orderId))) return NOT_FOUND;
  const { error } = await supabase.rpc("set_order_status", { order_id: p.data.orderId, to_status: "served" });
  return error ? mapOrderError(error) : done(user, orgId, locationId, EVENTS.kotStatusChanged);
};

async function setKot(orgSlug: string, locationId: string, ticketId: string, status: "in_progress" | "ready" | "bumped"): Promise<ActionResult> {
  const { user, supabase, orgId } = await authorize(orgSlug, locationId, ["kitchen.update"]);
  if (!(await inLocation(supabase, "kitchen_tickets", orgId, locationId, ticketId))) return NOT_FOUND;
  const { error } = await supabase.rpc("update_kot_status", { ticket_id: ticketId, to_status: status });
  return error ? mapOrderError(error) : done(user, orgId, locationId, EVENTS.kotStatusChanged);
}

export const updateKotStatus: OrderAction = async (orgSlug, locationId, _prev, formData) => {
  const p = parse(updateKotSchema, formData);
  if (p.error) { await authorize(orgSlug, locationId, ["kitchen.update"]); return p.error; }
  return setKot(orgSlug, locationId, p.data.ticketId, p.data.status);
};

export const bumpKot: OrderAction = async (orgSlug, locationId, _prev, formData) => {
  const p = parse(bumpKotSchema, formData);
  if (p.error) { await authorize(orgSlug, locationId, ["kitchen.update"]); return p.error; }
  return setKot(orgSlug, locationId, p.data.ticketId, "bumped");
};

export const setKotItemStatus: OrderAction = async (orgSlug, locationId, _prev, formData) => {
  const { supabase, orgId } = await authorize(orgSlug, locationId, ["kitchen.update"]);
  const p = parse(kotItemSchema, formData);
  if (p.error) return p.error;
  if (!(await inLocation(supabase, "kitchen_ticket_items", orgId, locationId, p.data.ticketItemId))) return NOT_FOUND;
  const { error } = await supabase.rpc("set_kot_item_status", { ticket_item_id: p.data.ticketItemId, to_status: p.data.status });
  if (error) return mapOrderError(error);
  updateTag(ordersTag(locationId));
  return { ok: true };
};

export const markTableClean: OrderAction = async (orgSlug, locationId, _prev, formData) => {
  const { supabase, orgId } = await authorize(orgSlug, locationId, ["orders.create"]);
  const p = parse(tableIdSchema, formData);
  if (p.error) return p.error;
  if (!(await inLocation(supabase, "tables", orgId, locationId, p.data.tableId))) return NOT_FOUND;
  const { error } = await supabase.rpc("mark_table_clean", { table_id: p.data.tableId });
  if (error) return mapOrderError(error);
  updateTag(ordersTag(locationId));
  return { ok: true };
};
