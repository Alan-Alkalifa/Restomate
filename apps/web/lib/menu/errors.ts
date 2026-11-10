import type { ActionResult } from "@/lib/auth/schemas";

type Failure = Extract<ActionResult, { ok: false }>;
const GENERIC = "Something went wrong. Please try again.";

/** Map a Postgres / PostgREST error from a menu mutation to a friendly result. Never echoes raw text. */
export function mapMenuError(error: { message?: string; code?: string } | null | undefined): Failure {
  const m = error?.message ?? "";
  if (error?.code === "23505") {
    return { ok: false, code: "DUPLICATE_NAME", fieldErrors: { name: ["That name is already used. Choose another."] }, formError: "That name is already used." };
  }
  if (error?.code === "42501" || m.toLowerCase().includes("row-level security") || m.includes("FORBIDDEN")) {
    return { ok: false, code: "FORBIDDEN", formError: "You don't have permission to do that." };
  }
  if (error?.code === "23503") return { ok: false, formError: "One of the selected items no longer exists. Refresh and try again." };
  if (error?.code === "23514") return { ok: false, formError: "Some values are out of range. Check the form and try again." };
  return { ok: false, formError: GENERIC };
}
