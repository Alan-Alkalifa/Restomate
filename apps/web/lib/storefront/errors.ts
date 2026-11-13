import type { ActionResult } from "@/lib/auth/schemas";

type Failure = Extract<ActionResult, { ok: false }>;
const GENERIC = "Something went wrong. Please try again.";

/** Map a Postgres / PostgREST error from a storefront settings write to a friendly result. Never echoes raw text. */
export function mapStorefrontError(error: { message?: string; code?: string; details?: string | null } | null | undefined): Failure {
  const m = error?.message ?? "";
  if (error?.code === "42501" || m.includes("FORBIDDEN") || m.toLowerCase().includes("row-level security")) {
    return { ok: false, code: "FORBIDDEN", formError: "You don't have permission to do that." };
  }
  if (m.includes("HOURS_REQUIRED")) {
    return {
      ok: false, code: "HOURS_REQUIRED",
      fieldErrors: { onlineEnabled: ["Add opening hours before turning on online pickup."] },
      formError: "Online pickup needs opening hours.",
    };
  }
  if (error?.code === "22023" || m.includes("INVALID_INPUT")) {
    const overlap = (error?.details ?? "").includes("overlap");
    return {
      ok: false,
      ...(overlap ? { fieldErrors: { intervals: ["Opening hours overlap on the same day."] } } : {}),
      formError: overlap ? "Opening hours overlap on the same day." : "Check the opening hours and try again.",
    };
  }
  if (error?.code === "23514") return { ok: false, formError: "One of the values is out of range." };
  return { ok: false, formError: GENERIC };
}
