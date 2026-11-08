import type { StaffActionResult } from "./types";

/** Friendly copy for known DB error contracts; falls back to the server's message. */
export function staffErrorMessage(r: StaffActionResult | null): string | undefined {
  if (!r || r.ok) return undefined;
  switch (r.code) {
    case "PLAN_LIMIT":
      return "Your plan's staff limit has been reached. Upgrade your plan to add more people.";
    case "LAST_OWNER":
      return "A restaurant must keep at least one active owner.";
    case "SYSTEM_ROLE":
      return "System roles can't be changed this way.";
    case "ALREADY_INVITED":
      return "This email has already been invited. Use Resend on the pending invitation.";
    case "FORBIDDEN":
      return "You don't have permission to do that.";
    case "RATE_LIMITED":
      return "Too many attempts. Please wait a moment and try again.";
    default:
      return r.formError;
  }
}

export const isPlanLimit = (r: StaffActionResult | null) => !!r && !r.ok && r.code === "PLAN_LIMIT";
