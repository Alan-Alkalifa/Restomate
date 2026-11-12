import { parseMoneyInput } from "@/lib/money";

/*
 * Pure bills model (docs/contracts/bills.md): types, validation and arithmetic for the POS bill/payment screens.
 * No React, no IO, no server code (unit tested). Money is integer minor units (whole Rupiah) end to end; the server
 * recomputes every figure, so nothing here is ever trusted by the server except payment amount / tendered / the typed
 * cash count, which the RPCs validate again.
 *
 * SEAM: the data types below mirror `lib/bills` (MSC-T07 / #134). When it merges, import them from there and delete
 * this section (keep the helpers).
 */
export type SplitKind = "none" | "equal" | "by_item";
export type PaymentMethod = "cash" | "edc_card" | "other";
export type PaymentStatus = "unpaid" | "partially_paid" | "paid" | "partially_refunded" | "refunded";
export type OrderStatus = "draft" | "placed" | "accepted" | "preparing" | "ready" | "served" | "completed" | "cancelled";

export type BillLine = {
  id: string; orderItemId: string; /** null for `equal`: every bill shows every line */ billId: string | null;
  name: string; variantName: string | null; modifiersText: string | null; quantity: number; unitPrice: number; lineTotal: number;
};
export type BillRow = {
  id: string; billNumber: number; shareNo: number; shareCount: number;
  subtotal: number; discount: number; serviceCharge: number; tax: number; total: number; printCount: number;
  /** All four are null/0 for a caller without payments.view (a waiter): no payment data, ever. */
  paidTotal: number; refundedTotal: number; outstanding: number; paymentStatus: PaymentStatus | null;
};
export type PaymentRow = {
  id: string; billId: string; method: PaymentMethod | "doku"; methodLabel: string | null; amount: number;
  tendered: number | null; changeGiven: number | null; approvalCode: string | null; refunded: number; createdAt: string;
};
export type BillSetDetail = {
  billSetId: string; orderId: string; orderNumber: number; tableLabel: string | null; splitKind: SplitKind; currency: string;
  totals: { subtotal: number; discount: number; serviceCharge: number; serviceChargeBps: number; tax: number; taxRateBps: number; total: number };
  lines: BillLine[]; bills: BillRow[]; payments: PaymentRow[];
};
/** What the screen needs before a set exists: the order's billable lines (no payment data). */
export type BillableOrder = {
  orderId: string; orderNumber: number; status: OrderStatus; tableLabel: string | null; currency: string;
  lines: { id: string; name: string; variantName: string | null; modifiersText: string | null; quantity: number; lineTotal: number }[];
};
export type CashSession = { id: string; openedAt: string; openingFloat: number };
/** Shape of every bill action result (the contract's `ActionResult` carrying `data` on success). */
export type BillActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; code?: string; formError?: string; fieldErrors?: Record<string, string[]> };
export type PaymentOutcome = { paymentId: string; paymentStatus: PaymentStatus; outstanding: number; changeGiven: number | null; orderCompleted: boolean };
/** A bound Server Action: orgSlug and locationId are applied on the server; FormData never carries an organization id. */
export type BillAction<T = null> = (prev: BillActionResult<T> | null, formData: FormData) => Promise<BillActionResult<T>>;
// ---- end of seam ----

export const SPLIT_MIN = 2;
export const SPLIT_MAX = 20;

/** Contract: a bill can be raised from `accepted` onward, never for draft/placed/completed/cancelled. */
export const canCreateBill = (status: OrderStatus): boolean => status === "accepted" || status === "preparing" || status === "ready" || status === "served";

export type SplitError = "count" | "assignments_incomplete" | "assignments_empty_bill" | "assignments_duplicate" | "assignments_count";

/** Client-side mirror of the server's INVALID_SPLIT rules, so the Create button never offers an invalid request. */
export function validateSplit(kind: SplitKind, count: number | null, assignments: readonly (readonly string[])[] | null, lineIds: readonly string[]): SplitError | null {
  if (kind === "none") return null;
  if (kind === "equal") return count !== null && Number.isInteger(count) && count >= SPLIT_MIN && count <= SPLIT_MAX ? null : "count";
  if (!assignments || assignments.length < SPLIT_MIN || assignments.length > SPLIT_MAX) return "assignments_count";
  const seen = new Set<string>();
  for (const group of assignments) {
    if (group.length === 0) return "assignments_empty_bill";
    for (const id of group) {
      if (seen.has(id)) return "assignments_duplicate";
      seen.add(id);
    }
  }
  return lineIds.every((id) => seen.has(id)) && seen.size === lineIds.length ? null : "assignments_incomplete";
}

/** Puts a line on bill `to` (0-based), removing it from wherever it was. Pure: returns new arrays. */
export function assignLine(assignments: readonly (readonly string[])[], lineId: string, to: number): string[][] {
  return assignments.map((g, i) => {
    const rest = g.filter((id) => id !== lineId);
    return i === to ? [...rest, lineId] : rest;
  });
}
export const emptyAssignments = (bills: number): string[][] => Array.from({ length: bills }, () => []);
export const unassignedLines = (lineIds: readonly string[], assignments: readonly (readonly string[])[]): string[] => {
  const used = new Set(assignments.flat());
  return lineIds.filter((id) => !used.has(id));
};

// ---- payments ----
export const outstandingOf = (bill: Pick<BillRow, "total" | "paidTotal">): number => Math.max(bill.total - bill.paidTotal, 0);
/** A bill can take a payment only while something is owed. Gross payments: a refund never re-opens a bill. */
export const canPay = (bill: Pick<BillRow, "total" | "paidTotal" | "paymentStatus">): boolean => bill.paymentStatus !== null && outstandingOf(bill) > 0;

/** Change due for cash: tendered - amount, or null when tendered does not cover the amount. */
export function changeFor(amount: number, tendered: number): number | null {
  return Number.isSafeInteger(amount) && Number.isSafeInteger(tendered) && amount > 0 && tendered >= amount ? tendered - amount : null;
}

/** Typed text -> whole minor units >= 0, or null when it is not a clean amount (used for the opening float / counted cash). */
export function parseMoneyInputOrNull(text: string, currency: string): number | null {
  const p = parseMoneyInput(text, currency);
  return p.ok ? p.value : null;
}

export type AmountParse = { ok: true; value: number } | { ok: false; message: string };
/** Typed text -> whole minor units, through lib/money (rejects decimals/junk, never guesses). Must be > 0. */
export function parsePositiveAmount(text: string, currency: string): AmountParse {
  const p = parseMoneyInput(text, currency);
  if (!p.ok) return p;
  return p.value > 0 ? p : { ok: false, message: "Enter an amount above 0." };
}

export type PaymentDraft = { method: PaymentMethod; amount: string; tendered: string; methodLabel: string; approvalCode: string };
export type PaymentCheck =
  | { ok: true; amount: number; tendered: number | null; change: number | null }
  | { ok: false; field: "amount" | "tendered" | "methodLabel" | "approvalCode"; reason: "invalid" | "exceeds" | "tendered_low" | "required" | "format"; message?: string };

/** Mirrors record_payment's checks so an invalid payment is never posted (the server checks again). */
export function checkPayment(draft: PaymentDraft, currency: string, outstanding: number): PaymentCheck {
  const amount = parsePositiveAmount(draft.amount, currency);
  if (!amount.ok) return { ok: false, field: "amount", reason: "invalid", message: amount.message };
  if (amount.value > outstanding) return { ok: false, field: "amount", reason: "exceeds" };
  if (draft.method === "cash") {
    const t = parsePositiveAmount(draft.tendered, currency);
    if (!t.ok) return { ok: false, field: "tendered", reason: "invalid", message: t.message };
    const change = changeFor(amount.value, t.value);
    if (change === null) return { ok: false, field: "tendered", reason: "tendered_low" };
    return { ok: true, amount: amount.value, tendered: t.value, change };
  }
  if (draft.method === "other") {
    const label = draft.methodLabel.trim();
    if (label.length < 2 || label.length > 40) return { ok: false, field: "methodLabel", reason: "required" };
  }
  // EDC: the terminal's approval code only (4-12 letters/digits). No card data field exists anywhere.
  if (draft.method === "edc_card" && draft.approvalCode.trim() !== "" && !/^[A-Za-z0-9]{4,12}$/.test(draft.approvalCode.trim())) {
    return { ok: false, field: "approvalCode", reason: "format" };
  }
  return { ok: true, amount: amount.value, tendered: null, change: null };
}

/** Largest amount still refundable on a payment. */
export const refundableLeft = (p: Pick<PaymentRow, "amount" | "refunded">): number => Math.max(p.amount - p.refunded, 0);

// ---- cash session ----
export const NOTE_MIN = 3;
/** variance = counted - expected, signed (negative = short). */
export const cashVariance = (counted: number, expected: number): number => counted - expected;
/** Closing with a variance needs a note of at least 3 characters (close_cash_session rule). */
export const closeNeedsNote = (variance: number): boolean => variance !== 0;
export const closeNoteOk = (variance: number, note: string): boolean => !closeNeedsNote(variance) || note.trim().length >= NOTE_MIN;

// ---- idempotency ----
/**
 * One clientRef per ATTEMPT, reused on retry (contract): the same request body keeps the same ref so a retried payment
 * replays safely; a changed body mints a new one (a reused ref with a different body is CLIENT_REF_CONFLICT); after a
 * success `reset()` so the next payment gets a fresh ref. `mint` is injected for tests.
 */
export function createAttemptTracker(mint: () => string = () => crypto.randomUUID()) {
  let body: string | null = null;
  let ref: string | null = null;
  return {
    refFor(canonicalBody: string): string {
      if (ref === null || body !== canonicalBody) {
        body = canonicalBody;
        ref = mint();
      }
      return ref;
    },
    reset() {
      body = null;
      ref = null;
    },
  };
}
