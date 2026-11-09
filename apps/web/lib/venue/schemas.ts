import { z } from "zod";

export { fieldErrors, parseForm } from "@/lib/staff/schemas";

const id = z.string().uuid("Invalid selection.");
const active = z.enum(["true", "false"], { error: "Invalid selection." }).transform((v) => v === "true");
const areaName = z.string().trim().min(1, "Enter a name.").max(60, "Use at most 60 characters.");
const label = z.string().trim().min(1, "Enter a label.").max(20, "Use at most 20 characters.");
const capacity = z.coerce.number({ error: "Enter a whole number." }).int("Enter a whole number.").min(1, "Seats must be between 1 and 50.").max(50, "Seats must be between 1 and 50.");
const shape = z.enum(["square", "round", "rect"], { error: "Choose a shape from the list." });

export const MAX_POSITIONS = 500;
export const MAX_POSITIONS_JSON = 64 * 1024;

export const createAreaSchema = z.object({ name: areaName });
export const renameAreaSchema = z.object({ areaId: id, name: areaName });
export const setAreaActiveSchema = z.object({ areaId: id, active });
export const reorderAreasSchema = z.object({ areaIds: z.array(id).min(1).max(200) });
export const createTableSchema = z.object({ areaId: id, label, capacity, shape });
export const updateTableSchema = z.object({ tableId: id, areaId: id, label, capacity, shape });
export const setTableActiveSchema = z.object({ tableId: id, active });
export const tableIdSchema = z.object({ tableId: id });
export const tableIdsSchema = z.array(id).max(MAX_POSITIONS);
export const locationIdSchema = id;

const position = z.object({
  tableId: id,
  posX: z.number().int().min(0).max(999),
  posY: z.number().int().min(0).max(999),
}).strict();
export type TablePosition = z.infer<typeof position>;

/** Hidden `positions` field: a JSON string. Size-capped before parsing; ids must be unique. */
export const positionsSchema = z.object({
  positions: z.string().max(MAX_POSITIONS_JSON, "Too much data.").transform((raw, ctx): TablePosition[] => {
    let value: unknown;
    try { value = JSON.parse(raw); } catch { ctx.addIssue({ code: "custom", message: "Invalid positions." }); return z.NEVER; }
    const r = z.array(position).min(1).max(MAX_POSITIONS).safeParse(value);
    if (!r.success) { ctx.addIssue({ code: "custom", message: "Invalid positions." }); return z.NEVER; }
    if (new Set(r.data.map((p) => p.tableId)).size !== r.data.length) {
      ctx.addIssue({ code: "custom", message: "Invalid positions." });
      return z.NEVER;
    }
    return r.data;
  }),
});
