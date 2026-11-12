import type { ActionResult } from "@/lib/auth/schemas";

type Failure = Extract<ActionResult, { ok: false }>;
const GENERIC = "Something went wrong. Please try again.";

const MESSAGES: Record<string, { code: NonNullable<Failure["code"]>; text: string }> = {
  ITEM_UNAVAILABLE: { code: "ITEM_UNAVAILABLE", text: "Some items are no longer available. Remove them and send again." },
  MODIFIER_INVALID: { code: "MODIFIER_INVALID", text: "Check the choices on highlighted items." },
  VARIANT_REQUIRED: { code: "VARIANT_REQUIRED", text: "Choose a size or variant for every item that needs one." },
  TABLE_NOT_FOUND: { code: "TABLE_NOT_FOUND", text: "That table could not be found." },
  ORDER_CLOSED: { code: "ORDER_CLOSED", text: "This order is already closed. Start a new order." },
  ALREADY_VOID: { code: "ALREADY_VOID", text: "That item is already voided." },
  ALREADY_REMOVED: { code: "ALREADY_REMOVED", text: "That discount was already removed." },
  INVALID_TRANSITION: { code: "INVALID_TRANSITION", text: "That change isn't allowed right now. Refresh and try again." },
  DISCOUNT_EXCEEDS_SUBTOTAL: { code: "DISCOUNT_EXCEEDS_SUBTOTAL", text: "The discount can't be more than the order total. Adjust or remove a discount first." },
  ORDER_NOT_MOVABLE: { code: "ORDER_NOT_MOVABLE", text: "This order can't be moved or merged right now." },
  ORDER_HAS_GROUP: { code: "ORDER_HAS_GROUP", text: "This party uses several tables. Release the extra tables first." },
  TABLE_NOT_AVAILABLE: { code: "TABLE_NOT_AVAILABLE", text: "That table isn't free. Choose an available table." },
  TABLE_IN_GROUP: { code: "TABLE_IN_GROUP", text: "That table is part of another party's tables." },
  TABLE_NOT_IN_GROUP: { code: "TABLE_NOT_IN_GROUP", text: "That table isn't one of this party's extra tables." },
  ORDER_CHANGED: { code: "ORDER_CHANGED", text: "This order just changed. Refresh and try again." },
  INVALID_ASSIGNEE: { code: "INVALID_ASSIGNEE", text: "That person can't be assigned to this location's tables." },
  CLIENT_REF_CONFLICT: { code: "CLIENT_REF_CONFLICT", text: "This order changed since it was first sent. Review the cart and send again." },
};

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/** Map a Postgres / PostgREST error from an order RPC to a friendly result. Never echoes raw text, SQL or ids. */
export function mapOrderError(error: { message?: string; code?: string; details?: string | null } | null | undefined): Failure {
  const m = error?.message ?? "";
  if (m.includes("PLAN_LIMIT")) {
    return { ok: false, code: "PLAN_LIMIT", formError: "Your plan's monthly order limit has been reached. Upgrade your plan to take more orders." };
  }
  if (error?.code === "42501" || m.includes("FORBIDDEN") || m.toLowerCase().includes("row-level security")) {
    return { ok: false, code: "FORBIDDEN", formError: "You don't have permission to do that." };
  }
  for (const [key, v] of Object.entries(MESSAGES)) {
    if (!m.includes(key)) continue;
    const out: Failure = { ok: false, code: v.code, formError: v.text };
    const ids = error?.details?.match(UUID) ?? [];
    if (key === "ITEM_UNAVAILABLE" && ids.length) out.details = { itemIds: [...new Set(ids)] };
    if (key === "MODIFIER_INVALID" && ids.length) out.details = { groupId: ids[0] };
    return out;
  }
  if (error?.code === "22023" || m.includes("INVALID_INPUT")) {
    return { ok: false, code: "INVALID_INPUT", formError: "Check the order and try again." };
  }
  return { ok: false, formError: GENERIC };
}
