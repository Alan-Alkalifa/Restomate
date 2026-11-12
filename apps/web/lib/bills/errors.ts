import type { ActionResult } from "@/lib/auth/schemas";

type Failure = Extract<ActionResult, { ok: false }>;
const GENERIC = "Something went wrong. Please try again.";

const MESSAGES: Record<string, { code: NonNullable<Failure["code"]>; text: string }> = {
  BILL_EXISTS: { code: "BILL_EXISTS", text: "This order already has a bill. Void the unpaid bill first to change the order." },
  BILL_VOID: { code: "BILL_VOID", text: "This bill was voided. Refresh and try again." },
  BILL_HAS_PAYMENTS: { code: "BILL_HAS_PAYMENTS", text: "This bill holds payments. A manager must refund them first." },
  ORDER_NOT_BILLABLE: { code: "ORDER_NOT_BILLABLE", text: "This order can't be billed yet, or has no items to bill." },
  ORDER_CLOSED: { code: "ORDER_CLOSED", text: "This order is already closed." },
  TAX_RATE_MISMATCH: { code: "TAX_RATE_MISMATCH", text: "The items on this order have different tax rates. Ask a manager to cancel and re-enter the order." },
  INVALID_SPLIT: { code: "INVALID_SPLIT", text: "Check the split: every item must be on exactly one bill." },
  METHOD_NOT_ALLOWED: { code: "METHOD_NOT_ALLOWED", text: "That payment method isn't available." },
  PAYMENT_EXCEEDS_OUTSTANDING: { code: "PAYMENT_EXCEEDS_OUTSTANDING", text: "That's more than the amount still owed on this bill." },
  TENDERED_TOO_LOW: { code: "TENDERED_TOO_LOW", text: "The cash received is less than the amount being paid." },
  NO_OPEN_SESSION: { code: "NO_OPEN_SESSION", text: "Open a cash session before taking or refunding cash." },
  SESSION_ALREADY_OPEN: { code: "SESSION_ALREADY_OPEN", text: "A cash session is already open at this location." },
  SESSION_CLOSED: { code: "SESSION_CLOSED", text: "This cash session is already closed." },
  REFUND_EXCEEDS_PAID: { code: "REFUND_EXCEEDS_PAID", text: "That's more than is left to refund on this payment." },
  CLIENT_REF_CONFLICT: { code: "CLIENT_REF_CONFLICT", text: "This request changed since it was first sent. Review it and try again." },
  DISCOUNT_EXCEEDS_SUBTOTAL: { code: "DISCOUNT_EXCEEDS_SUBTOTAL", text: "The discount is more than the order total. Adjust the discount first." },
};

/** Map a Postgres / PostgREST error from a bill RPC to a friendly result. Never echoes raw text, SQL or ids. */
export function mapBillError(error: { message?: string; code?: string; details?: string | null } | null | undefined): Failure {
  const m = error?.message ?? "";
  if (error?.code === "42501" || m.includes("FORBIDDEN") || m.toLowerCase().includes("row-level security")) {
    return { ok: false, code: "FORBIDDEN", formError: "You don't have permission to do that." };
  }
  for (const [key, v] of Object.entries(MESSAGES)) {
    if (m.includes(key)) return { ok: false, code: v.code, formError: v.text };
  }
  if (error?.code === "22023" || m.includes("INVALID_INPUT")) {
    const note = (error?.details ?? "").includes("note");
    return {
      ok: false, code: "INVALID_INPUT",
      ...(note ? { fieldErrors: { note: ["Add a note explaining the difference (at least 3 characters)."] } } : {}),
      formError: note ? "Add a note explaining the cash difference." : "Check the details and try again.",
    };
  }
  return { ok: false, formError: GENERIC };
}
