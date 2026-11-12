import { z } from "zod";

export { fieldErrors, parseForm } from "@/lib/staff/schemas";
export { locationIdSchema } from "@/lib/venue/schemas";
import { normalizeTaxId } from "./tax-id";

/** `taxId` is optional text: dots/dashes/spaces allowed, normalized to digits, empty -> null, otherwise a field error. */
export const updateLocationTaxIdSchema = z.object({
  taxId: z.string().max(40, "That is too long.").default("").transform((raw, ctx): string | null => {
    const r = normalizeTaxId(raw);
    if (!r.ok) { ctx.addIssue({ code: "custom", message: r.message }); return z.NEVER; }
    return r.value;
  }),
});
