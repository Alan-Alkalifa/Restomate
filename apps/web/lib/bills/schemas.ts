import { z } from "zod";

export { fieldErrors, parseForm } from "@/lib/staff/schemas";

const id = z.string().uuid("Invalid selection.");
const reason = z.string().trim().min(3, "Enter a reason (at least 3 characters).").max(200, "Use at most 200 characters.");
const blank = (v: unknown) => (v === "" ? undefined : v);

/** Whole minor units as an integer string (IDR has no decimals). Amounts are positive. */
const amount = z.string().regex(/^[1-9][0-9]{0,11}$/, "Enter a whole amount greater than zero.").transform(Number);
/** Zero allowed (an opening float or a counted drawer can be 0). */
const amountOrZero = z.string().regex(/^(0|[1-9][0-9]{0,11})$/, "Enter a whole amount.").transform(Number);

const groups = z.string().max(64 * 1024, "Too much data.").transform((raw, ctx): string[][] => {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { ctx.addIssue({ code: "custom", message: "Invalid split." }); return z.NEVER; }
  const r = z.array(z.array(id).min(1).max(200)).min(2).max(20).safeParse(value);
  if (!r.success) { ctx.addIssue({ code: "custom", message: "Invalid split." }); return z.NEVER; }
  return r.data;
});

export const createBillsSchema = z.object({
  orderId: id,
  splitKind: z.preprocess(blank, z.enum(["none", "equal", "by_item"], { error: "Choose how to split." }).default("none")),
  splitCount: z.preprocess(blank, z.coerce.number().int("Enter a whole number.").min(2).max(20).optional()),
  assignments: z.preprocess(blank, groups.optional()),
  clientRef: id,
}).refine((v) => (v.splitKind === "equal") === (v.splitCount !== undefined), { message: "Equal split needs a share count.", path: ["splitCount"] })
  .refine((v) => (v.splitKind === "by_item") === (v.assignments !== undefined), { message: "Split by item needs an assignment.", path: ["assignments"] });

export const voidBillSetSchema = z.object({ billSetId: id, reason });

/** `doku` is deliberately not selectable: it is created only by the verified DOKU notification path (M5). */
export const recordPaymentSchema = z.object({
  billId: id,
  method: z.enum(["cash", "edc_card", "other"], { error: "Choose a payment method." }),
  amount,
  tendered: z.preprocess(blank, amount.optional()),
  methodLabel: z.preprocess(blank, z.string().trim().min(2, "Use at least 2 characters.").max(40, "Use at most 40 characters.").optional()),
  approvalCode: z.preprocess(blank, z.string().trim().regex(/^[A-Za-z0-9]{4,12}$/, "Use 4 to 12 letters or digits.").optional()),
  clientRef: id,
}).superRefine((v, ctx) => {
  if (v.method === "cash" && (v.tendered === undefined || v.tendered < v.amount)) {
    ctx.addIssue({ code: "custom", path: ["tendered"], message: "Enter the cash received (at least the amount paid)." });
  }
  if (v.method !== "cash" && v.tendered !== undefined) ctx.addIssue({ code: "custom", path: ["tendered"], message: "Only cash has an amount received." });
  if (v.method === "other" && v.methodLabel === undefined) ctx.addIssue({ code: "custom", path: ["methodLabel"], message: "Say what was used (for example Voucher)." });
  if (v.method !== "other" && v.methodLabel !== undefined) ctx.addIssue({ code: "custom", path: ["methodLabel"], message: "Only \"other\" has a label." });
  if (v.method !== "edc_card" && v.approvalCode !== undefined) ctx.addIssue({ code: "custom", path: ["approvalCode"], message: "Only card payments have an approval code." });
});

export const recordRefundSchema = z.object({ paymentId: id, amount, reason, clientRef: id });
export const openCashSessionSchema = z.object({ openingFloat: amountOrZero });
export const closeCashSessionSchema = z.object({
  sessionId: id,
  countedCash: amountOrZero,
  note: z.preprocess(blank, z.string().trim().max(200, "Use at most 200 characters.").optional()),
});
export const recordBillPrintSchema = z.object({ billId: id });
