import type { ActionResult } from "@/lib/auth/schemas";

type Failure = Extract<ActionResult, { ok: false }>;
const GENERIC = "Something went wrong. Please try again.";

/** Map a Postgres / PostgREST error from a venue mutation to a friendly result. Never echoes raw text. */
export function mapVenueError(error: { message?: string; code?: string } | null | undefined): Failure {
  const m = error?.message ?? "";
  if (m.includes("PLAN_LIMIT")) {
    return { ok: false, code: "PLAN_LIMIT", formError: "Your plan's table limit has been reached. Upgrade your plan to add more tables." };
  }
  if (m.includes("AREA_NOT_EMPTY")) {
    return { ok: false, code: "AREA_NOT_EMPTY", formError: "Move or deactivate this area's tables first." };
  }
  if (m.includes("TABLE_NOT_AVAILABLE")) {
    return { ok: false, code: "TABLE_NOT_AVAILABLE", formError: "This table is in use. Finish or move its order first." };
  }
  if (m.includes("AREA_INACTIVE")) return { ok: false, formError: "That area is inactive. Reactivate it first." };
  if (m.includes("TABLE_INACTIVE")) return { ok: false, formError: "Reactivate the table before replacing its QR code." };
  if (error?.code === "23505") {
    return { ok: false, code: "DUPLICATE_NAME", formError: "That name is already used in this location. Choose another." };
  }
  if (error?.code === "42501" || m.toLowerCase().includes("row-level security") || m.includes("FORBIDDEN")) {
    return { ok: false, code: "FORBIDDEN", formError: "You don't have permission to do that." };
  }
  if (error?.code === "23514" && m.includes("tables_pos_")) {
    return { ok: false, formError: "Table positions must stay inside the floor plan (0 to 999)." };
  }
  if (error?.code === "23503") return { ok: false, fieldErrors: { areaId: ["Choose an area from the list."] } };
  return { ok: false, formError: GENERIC };
}
