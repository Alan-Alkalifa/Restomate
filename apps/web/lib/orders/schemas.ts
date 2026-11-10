import { z } from "zod";

export { fieldErrors, parseForm } from "@/lib/staff/schemas";

const id = z.string().uuid("Invalid selection.");
const reason = z.string().trim().min(3, "Enter a reason (at least 3 characters).").max(200, "Use at most 200 characters.");

export const MAX_LINES = 60;
export const MAX_LINES_JSON = 64 * 1024;

/** One cart line. Strict: a price, name, total or organization id from the client is rejected, never ignored. */
const line = z.object({
  itemId: id,
  variantId: id.nullish(),
  modifierIds: z.array(id).max(50).default([]),
  quantity: z.number().int("Quantity must be a whole number.").min(1).max(99),
  note: z.string().trim().max(200, "Use at most 200 characters.").nullish(),
}).strict();
export type RoundLine = z.infer<typeof line>;

const linesField = z.string().max(MAX_LINES_JSON, "Too much data.").transform((raw, ctx): RoundLine[] => {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { ctx.addIssue({ code: "custom", message: "Invalid order lines." }); return z.NEVER; }
  const r = z.array(line).min(1, "Add at least one item.").max(MAX_LINES).safeParse(value);
  if (!r.success) { ctx.addIssue({ code: "custom", message: "Invalid order lines." }); return z.NEVER; }
  return r.data;
});

const blank = (v: unknown) => (v === "" ? undefined : v);

export const sendRoundSchema = z.object({
  tableId: z.preprocess(blank, id.optional()),
  channel: z.enum(["dine_in", "takeaway"], { error: "Choose dine in or takeaway." }),
  lines: linesField,
  clientRef: id,
  customerName: z.preprocess(blank, z.string().trim().max(60, "Use at most 60 characters.").optional()),
  guestCount: z.preprocess(blank, z.coerce.number().int("Enter a whole number.").min(1).max(50).optional()),
}).refine((v) => (v.channel === "dine_in") === (v.tableId !== undefined), {
  message: "Dine in needs a table; takeaway has none.", path: ["tableId"],
});

export const voidItemSchema = z.object({ orderItemId: id, reason });
export const cancelOrderSchema = z.object({ orderId: id, reason });
export const applyDiscountSchema = z.object({
  orderId: id,
  amount: z.string().regex(/^[1-9][0-9]{0,11}$/, "Enter a whole amount greater than zero.").transform(Number),
  reason,
});
export const removeDiscountSchema = z.object({ discountId: id, reason });
export const orderIdSchema = z.object({ orderId: id });
export const updateKotSchema = z.object({ ticketId: id, status: z.enum(["in_progress", "ready"], { error: "Invalid status." }) });
export const bumpKotSchema = z.object({ ticketId: id });
export const kotItemSchema = z.object({ ticketItemId: id, status: z.enum(["pending", "ready"], { error: "Invalid status." }) });
export const tableIdSchema = z.object({ tableId: id });
