"use server";

import { updateTag } from "next/cache";
import type { z } from "zod";
import { requireOrgContext, requirePermission, requireUser } from "@/lib/auth/dal";
import type { PermissionKey } from "@/lib/auth/permissions";
import type { ActionResult } from "@/lib/auth/schemas";
import { EVENTS, type EventName } from "@/lib/posthog/events";
import { captureServer } from "@/lib/posthog/server";
import { createClient } from "@/lib/supabase/server";
import { mapBillError } from "./errors";
import {
  closeCashSessionSchema, createBillsSchema, fieldErrors, openCashSessionSchema, parseForm, recordBillPrintSchema,
  recordPaymentSchema, recordRefundSchema, voidBillSetSchema,
} from "./schemas";
import { assertLocation, billsTag } from "./shared";

/*
 * Bill Server Actions (docs/contracts/bills.md). Every mutation: requireOrgContext(slug) -> permission -> the
 * location must be one the caller can access -> Zod -> the id must belong to THIS location (IDOR) -> the RPC (which
 * authorizes again and does the work in one transaction) -> updateTag -> PostHog (event + organization only: no
 * amounts, names or PII). orgSlug and locationId are bound server-side; an organization id never comes from FormData.
 * Totals are never read from the client: the RPCs compute them. `clientRef` is created once per attempt and REUSED on
 * retry, which is what makes a flaky-Wi-Fi retry safe.
 */
type BillAction = (orgSlug: string, locationId: string, prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;

const NOT_FOUND: ActionResult = { ok: false, code: "FORBIDDEN", formError: "That could not be found in this location." };

/** `anyOf`: the caller needs at least one (the RPC makes the finer decision). */
async function authorize(orgSlug: string, locationId: string, anyOf: PermissionKey[]) {
  const ctx = await requireOrgContext(orgSlug);
  assertLocation(ctx, locationId);
  if (!anyOf.some((p) => ctx.permissions.includes(p))) await requirePermission(ctx.org.id, anyOf[0]!);
  const user = await requireUser();
  const supabase = await createClient();
  return { user, supabase, orgId: ctx.org.id };
}

type Supabase = Awaited<ReturnType<typeof createClient>>;
type InLocationTable = "orders" | "bill_sets" | "bills" | "payments" | "cash_sessions";

const inLocation = async (s: Supabase, table: InLocationTable, orgId: string, loc: string, id: string) =>
  (await s.from(table).select("id").eq("id", id).eq("organization_id", orgId).eq("location_id", loc).maybeSingle()).data;

function done(user: { id: string }, orgId: string, locationId: string, event: EventName | null, data?: Record<string, string | number | boolean>): ActionResult {
  if (event) captureServer(event, { distinctId: user.id, organizationId: orgId });
  updateTag(billsTag(locationId));
  updateTag(`orders:${locationId}`); // bills move the order (locked, completed) and the table
  return data ? { ok: true, data } : { ok: true };
}

function parse<S extends z.ZodType>(schema: S, formData: FormData) {
  const p = parseForm(schema, formData);
  return p.success ? { data: p.data as z.infer<S> } : { error: { ok: false, fieldErrors: fieldErrors(p.error) } as ActionResult };
}

type RpcRow = Record<string, unknown>;

export const createBills: BillAction = async (orgSlug, locationId, _prev, formData) => {
  const { user, supabase, orgId } = await authorize(orgSlug, locationId, ["payments.take", "bills.print"]);
  const p = parse(createBillsSchema, formData);
  if (p.error) return p.error;
  const v = p.data;
  if (!(await inLocation(supabase, "orders", orgId, locationId, v.orderId))) return NOT_FOUND;
  const { data, error } = await supabase.rpc("create_bills", {
    order_id: v.orderId, client_ref: v.clientRef, split_kind: v.splitKind,
    // optional RPC parameters: omitted when unused (generated types model them as non-null)
    ...(v.splitCount !== undefined ? { split_count: v.splitCount } : {}),
    ...(v.assignments !== undefined ? { assignments: v.assignments } : {}),
  });
  if (error) return mapBillError(error);
  const r = data as RpcRow & { replayed?: boolean };
  return done(user, orgId, locationId, r.replayed ? null : EVENTS.billCreated, { billSetId: String(r.billSetId) });
};

export const voidBillSet: BillAction = async (orgSlug, locationId, _prev, formData) => {
  const { user, supabase, orgId } = await authorize(orgSlug, locationId, ["payments.take", "payments.refund"]);
  const p = parse(voidBillSetSchema, formData);
  if (p.error) return p.error;
  if (!(await inLocation(supabase, "bill_sets", orgId, locationId, p.data.billSetId))) return NOT_FOUND;
  const { error } = await supabase.rpc("void_bill_set", { bill_set_id: p.data.billSetId, reason: p.data.reason });
  return error ? mapBillError(error) : done(user, orgId, locationId, null);
};

export const recordPayment: BillAction = async (orgSlug, locationId, _prev, formData) => {
  const { user, supabase, orgId } = await authorize(orgSlug, locationId, ["payments.take"]);
  const p = parse(recordPaymentSchema, formData);
  if (p.error) return p.error;
  const v = p.data;
  if (!(await inLocation(supabase, "bills", orgId, locationId, v.billId))) return NOT_FOUND;
  const { data, error } = await supabase.rpc("record_payment", {
    bill_id: v.billId, method: v.method, amount: v.amount, client_ref: v.clientRef,
    ...(v.tendered !== undefined ? { tendered: v.tendered } : {}),
    ...(v.methodLabel !== undefined ? { method_label: v.methodLabel } : {}),
    ...(v.approvalCode !== undefined ? { approval_code: v.approvalCode } : {}),
  });
  if (error) return mapBillError(error);
  const r = data as { paymentId: string; paymentStatus: string; outstanding: number; changeGiven: number | null; orderCompleted: boolean; replayed: boolean };
  if (!r.replayed) captureServer(EVENTS.paymentRecorded, { distinctId: user.id, organizationId: orgId, properties: { method: v.method } });
  return done(user, orgId, locationId, null, {
    paymentId: r.paymentId, paymentStatus: r.paymentStatus, outstanding: r.outstanding,
    ...(r.changeGiven !== null ? { changeGiven: r.changeGiven } : {}), orderCompleted: r.orderCompleted,
  });
};

export const recordRefund: BillAction = async (orgSlug, locationId, _prev, formData) => {
  const { user, supabase, orgId } = await authorize(orgSlug, locationId, ["payments.refund"]);
  const p = parse(recordRefundSchema, formData);
  if (p.error) return p.error;
  if (!(await inLocation(supabase, "payments", orgId, locationId, p.data.paymentId))) return NOT_FOUND;
  const { data, error } = await supabase.rpc("record_refund", {
    payment_id: p.data.paymentId, amount: p.data.amount, reason: p.data.reason, client_ref: p.data.clientRef,
  });
  if (error) return mapBillError(error);
  const r = data as { paymentStatus: string; replayed: boolean };
  return done(user, orgId, locationId, r.replayed ? null : EVENTS.refundRecorded, { paymentStatus: r.paymentStatus });
};

export const openCashSession: BillAction = async (orgSlug, locationId, _prev, formData) => {
  const { user, supabase, orgId } = await authorize(orgSlug, locationId, ["payments.take"]);
  const p = parse(openCashSessionSchema, formData);
  if (p.error) return p.error;
  const { data, error } = await supabase.rpc("open_cash_session", { location_id: locationId, opening_float: p.data.openingFloat });
  if (error) return mapBillError(error);
  return done(user, orgId, locationId, EVENTS.cashSessionOpened, { sessionId: String((data as RpcRow).sessionId) });
};

export const closeCashSession: BillAction = async (orgSlug, locationId, _prev, formData) => {
  const { user, supabase, orgId } = await authorize(orgSlug, locationId, ["payments.take"]);
  const p = parse(closeCashSessionSchema, formData);
  if (p.error) return p.error;
  if (!(await inLocation(supabase, "cash_sessions", orgId, locationId, p.data.sessionId))) return NOT_FOUND;
  const { data, error } = await supabase.rpc("close_cash_session", {
    session_id: p.data.sessionId, counted_cash: p.data.countedCash,
    ...(p.data.note !== undefined ? { note: p.data.note } : {}),
  });
  if (error) return mapBillError(error);
  const r = data as { expectedCash: number; variance: number; replayed: boolean };
  return done(user, orgId, locationId, r.replayed ? null : EVENTS.cashSessionClosed, { expectedCash: r.expectedCash, variance: r.variance });
};

export const recordBillPrint: BillAction = async (orgSlug, locationId, _prev, formData) => {
  const { supabase, orgId } = await authorize(orgSlug, locationId, ["bills.print"]);
  const p = parse(recordBillPrintSchema, formData);
  if (p.error) return p.error;
  if (!(await inLocation(supabase, "bills", orgId, locationId, p.data.billId))) return NOT_FOUND;
  const { data, error } = await supabase.rpc("record_bill_print", { bill_id: p.data.billId });
  if (error) return mapBillError(error);
  const r = data as { printCount: number; duplicate: boolean };
  updateTag(billsTag(locationId));
  return { ok: true, data: { printCount: r.printCount, duplicate: r.duplicate } };
};
