import { z } from "zod";

export { fieldErrors, parseForm } from "@/lib/staff/schemas";

export const MAX_MONEY = 1_000_000_000_000;
export const MAX_VARIANTS = 20;
export const MAX_MODIFIERS = 30;
export const MAX_LIST_JSON = 32 * 1024;
export const DIETARY_TAGS = ["vegetarian", "vegan", "halal", "spicy", "contains_nuts", "gluten_free"] as const;

const id = z.string().uuid("Invalid selection.");
/** Explicit flag (active / published / soldOut): must be sent. A missing value is an error, never a silent false. */
const flag = z.enum(["true", "false"], { error: "Invalid selection." }).transform((v) => v === "true");
/** Checkbox: an unchecked box sends nothing, so an absent field is false. */
const checkbox = z.enum(["true", "false"], { error: "Invalid selection." }).optional().default("false").transform((v) => v === "true");

/** Integer minor units as a decimal string (no decimals, no exponent, no separators). */
function moneyString(min: number, label: string) {
  return z.string().trim().regex(/^-?\d{1,13}$/, `Enter ${label} as a whole number.`)
    .transform(Number)
    .refine((n) => Number.isSafeInteger(n) && n >= min && n <= MAX_MONEY,
      min < 0 ? "That amount is out of range." : `Enter ${label} between 0 and ${MAX_MONEY.toLocaleString("en-US")}.`);
}
const price = moneyString(0, "a price");
const optionalPrice = z.string().trim().optional().default("").transform((v) => (v === "" ? null : v)).pipe(z.union([z.null(), price]));

const name = (max: number) => z.string().trim().min(1, "Enter a name.").max(max, `Use at most ${max} characters.`);
const optionalText = (max: number) =>
  z.string().trim().max(max, `Use at most ${max} characters.`).optional().transform((v) => (v ? v : null));

export const createCategorySchema = z.object({ name: name(60), description: optionalText(500) });
export const updateCategorySchema = z.object({ categoryId: id, name: name(60), description: optionalText(500) });
export const setCategoryActiveSchema = z.object({ categoryId: id, active: flag });
export const reorderCategoriesSchema = z.object({ categoryIds: z.array(id).min(1).max(200) });

const itemFields = {
  categoryId: id,
  name: name(80),
  description: optionalText(500),
  basePrice: price,
  dietaryTags: z.array(z.enum(DIETARY_TAGS, { error: "Choose tags from the list." })).max(DIETARY_TAGS.length)
    .transform((t) => [...new Set(t)]).default([]),
  isPublished: checkbox,
};
export const createItemSchema = z.object(itemFields);
export const updateItemSchema = z.object({ itemId: id, ...itemFields });
export const setItemActiveSchema = z.object({ itemId: id, active: flag });
export const setItemPublishedSchema = z.object({ itemId: id, published: flag });
export const reorderItemsSchema = z.object({ categoryId: id, itemIds: z.array(id).min(1).max(500) });
export const setItemModifierGroupsSchema = z.object({ itemId: id, groupIds: z.array(id).max(50).default([]) });

const count = (min: number, max: number, minMsg: string) =>
  z.string().trim().regex(/^\d{1,3}$/, "Enter a whole number.").transform(Number)
    .refine((n) => n >= min, minMsg).refine((n) => n <= max, `Use at most ${max}.`);
const group = {
  name: name(60),
  minSelect: count(0, 100, "Use 0 or more."),
  maxSelect: count(1, 100, "Use at least 1."),
};
const minMax = (v: { minSelect: number; maxSelect: number }, ctx: z.RefinementCtx) => {
  if (v.maxSelect < v.minSelect) ctx.addIssue({ code: "custom", path: ["maxSelect"], message: "Maximum must be at least the minimum." });
};
export const createModifierGroupSchema = z.object(group).superRefine(minMax);
export const updateModifierGroupSchema = z.object({ groupId: id, ...group }).superRefine(minMax);
export const setModifierGroupActiveSchema = z.object({ groupId: id, active: flag });

// ---- JSON lists (variants / modifiers): size-capped BEFORE parsing; readable per-row errors -------------------------
const jsonMoney = (min: number) => z.union([z.number(), z.string()]).transform((v) => (typeof v === "number" ? String(v) : v)).pipe(moneyString(min, "a price"));
const variantRow = z.object({ id: id.optional(), name: name(40), priceDelta: jsonMoney(-MAX_MONEY) }).strict();
const modifierRow = z.object({ id: id.optional(), name: name(40), priceDelta: jsonMoney(0) }).strict();
export type ListRow = { id?: string; name: string; priceDelta: number };

function jsonList(rowSchema: z.ZodType<ListRow, unknown>, label: string, max: number) {
  return z.string().max(MAX_LIST_JSON, "Too much data.").transform((raw, ctx): ListRow[] => {
    let value: unknown;
    try { value = JSON.parse(raw); } catch { ctx.addIssue({ code: "custom", message: "Invalid list." }); return z.NEVER; }
    if (!Array.isArray(value)) { ctx.addIssue({ code: "custom", message: "Invalid list." }); return z.NEVER; }
    if (value.length > max) { ctx.addIssue({ code: "custom", message: `Use at most ${max} rows.` }); return z.NEVER; }
    const rows: ListRow[] = [];
    for (const [i, v] of value.entries()) {
      const r = rowSchema.safeParse(v);
      if (!r.success) {
        const msg = r.error.issues[0]?.message ?? "invalid";
        ctx.addIssue({ code: "custom", message: `${label} ${i + 1}: ${msg.charAt(0).toLowerCase()}${msg.slice(1)}` });
        return z.NEVER;
      }
      rows.push(r.data);
    }
    const ids = rows.flatMap((r) => (r.id ? [r.id] : []));
    if (new Set(ids).size !== ids.length) { ctx.addIssue({ code: "custom", message: "Invalid list." }); return z.NEVER; }
    const names = rows.map((r) => r.name.toLowerCase());
    const dup = names.findIndex((n, i) => names.indexOf(n) !== i);
    if (dup >= 0) { ctx.addIssue({ code: "custom", message: `${label} ${dup + 1}: that name is already used` }); return z.NEVER; }
    return rows;
  });
}
export const saveItemVariantsSchema = z.object({ itemId: id, variants: jsonList(variantRow, "Variant", MAX_VARIANTS) });
export const saveGroupModifiersSchema = z.object({ groupId: id, modifiers: jsonList(modifierRow, "Modifier", MAX_MODIFIERS) });

// ---- location level -------------------------------------------------------------------------------------------------
export const setLocationOverrideSchema = z.object({
  itemId: id,
  priceOverride: optionalPrice,
  isAvailable: checkbox,
  kitchenStationId: z.string().trim().optional().default("").transform((v) => (v === "" ? null : v)).pipe(z.union([z.null(), id])),
});
export const toggleSoldOutSchema = z.object({ itemId: id, soldOut: flag });
export const createStationSchema = z.object({ name: name(40) });
export const renameStationSchema = z.object({ stationId: id, name: name(40) });
export const setStationActiveSchema = z.object({ stationId: id, active: flag });
