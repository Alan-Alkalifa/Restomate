import { z } from "zod";

export { fieldErrors, parseForm } from "@/lib/staff/schemas";
export { locationIdSchema } from "@/lib/venue/schemas";

const blank = (v: unknown) => (v === "" ? undefined : v);
/** A checkbox: a missing field is "off" (an unchecked HTML checkbox posts nothing); "true"/"false" are accepted. */
const flag = z.preprocess((v) => (v === undefined || v === null ? "false" : v), z.enum(["true", "false"], { error: "Invalid choice." }).transform((x) => x === "true"));
const whole = (min: number, max: number, what: string) =>
  z.coerce.number({ error: "Enter a whole number." }).int("Enter a whole number.").min(min, `${what} must be between ${min} and ${max}.`).max(max, `${what} must be between ${min} and ${max}.`);

export const LEAD_RANGE = [5, 240] as const;
export const SLOT_RANGE = [5, 60] as const;
export const TTL_RANGE = [5, 60] as const;
export const MAX_HOURS_INTERVALS = 28;

/** The ordering switches and pickup settings of one location. Money is whole minor units (IDR has no decimals). */
export const updateOrderingSettingsSchema = z.object({
  qrEnabled: flag,
  onlineEnabled: flag,
  acceptingOrders: flag,
  autoAcceptQr: flag,
  autoAcceptOnline: flag,
  pickupLeadMinutes: whole(...LEAD_RANGE, "Lead time"),
  pickupSlotMinutes: whole(...SLOT_RANGE, "Slot length"),
  pickupMaxOrdersPerSlot: z.preprocess(blank, whole(1, 200, "Orders per slot").optional()),
  minOrderAmount: z.string().regex(/^(0|[1-9][0-9]{0,11})$/, "Enter a whole amount, 0 or more.").transform(Number),
  pendingTtlMinutes: whole(...TTL_RANGE, "Waiting time"),
});
export type OrderingSettingsInput = z.infer<typeof updateOrderingSettingsSchema>;

const interval = z.object({
  day: z.number().int().min(0).max(6),
  opensMin: z.number().int().min(0).max(1439),
  closesMin: z.number().int().min(1).max(1440),
}).strict().refine((v) => v.opensMin < v.closesMin, { message: "Opening time must be before closing time." });
export type HoursInterval = z.infer<typeof interval>;

/** Hidden `intervals` field: a JSON array. Size-capped before parsing; no overlaps on one weekday (touching is fine). */
export const saveLocationHoursSchema = z.object({
  intervals: z.string().max(8 * 1024, "Too much data.").transform((raw, ctx): HoursInterval[] => {
    let value: unknown;
    try { value = JSON.parse(raw); } catch { ctx.addIssue({ code: "custom", message: "Invalid opening hours." }); return z.NEVER; }
    const r = z.array(interval).max(MAX_HOURS_INTERVALS, `At most ${MAX_HOURS_INTERVALS} time ranges.`).safeParse(value);
    if (!r.success) { ctx.addIssue({ code: "custom", message: r.error.issues[0]?.message ?? "Invalid opening hours." }); return z.NEVER; }
    const sorted = [...r.data].sort((a, b) => a.day - b.day || a.opensMin - b.opensMin);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const cur = sorted[i]!;
      if (prev.day === cur.day && cur.opensMin < prev.closesMin) {
        ctx.addIssue({ code: "custom", message: "Opening hours overlap on the same day." });
        return z.NEVER;
      }
    }
    return sorted;
  }),
});
