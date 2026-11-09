import type { ActionResult } from "@/lib/auth/schemas";

type Failure = Extract<ActionResult, { ok: false }>;
const GENERIC = "Something went wrong. Please try again.";

/** Map a Postgres / PostgREST error from a staff mutation to a friendly result. Never echoes raw text. */
export function mapStaffError(error: { message?: string; code?: string } | null | undefined): Failure {
  const m = error?.message ?? "";
  if (m.includes("PLAN_LIMIT")) {
    return { ok: false, code: "PLAN_LIMIT", formError: "Your plan's staff limit has been reached. Upgrade your plan to add more people." };
  }
  if (m.includes("LAST_OWNER")) {
    return { ok: false, code: "LAST_OWNER", formError: "A restaurant needs at least one active owner. Make someone else an owner first." };
  }
  if (m.includes("SYSTEM_ROLE")) {
    return { ok: false, code: "SYSTEM_ROLE", formError: "This built-in role can't be changed." };
  }
  if (error?.code === "23505") {
    return { ok: false, code: "ALREADY_INVITED", formError: "Already invited. Use Resend instead." };
  }
  if (error?.code === "42501" || m.toLowerCase().includes("row-level security")) {
    return { ok: false, code: "FORBIDDEN", formError: "You don't have permission to do that." };
  }
  if (m.includes("INVALID_LOCATION")) return { ok: false, fieldErrors: { locationIds: ["Choose locations from the list."] } };
  if (m.includes("INVALID_INVITATION")) return invalidInvitation();
  return { ok: false, formError: GENERIC };
}

export function invalidInvitation(): Failure {
  return { ok: false, code: "INVALID_INVITATION", formError: "This invitation is invalid or has expired. Ask for a new one." };
}
