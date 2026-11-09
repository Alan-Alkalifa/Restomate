import type { ActionResult } from "./types";

/** `code` can be a member the generated union does not know yet (DUPLICATE_NAME, AREA_NOT_EMPTY): compare as a string. */
export const codeOf = (r: ActionResult | null): string | undefined => (r && !r.ok ? (r.code as string | undefined) : undefined);

/** Friendly copy for the venue error codes; the server's own message is the fallback. */
export function venueErrorMessage(r: ActionResult | null): string | undefined {
  if (!r || r.ok) return undefined;
  switch (codeOf(r)) {
    case "PLAN_LIMIT":
      return "Your plan's table limit has been reached. Upgrade your plan to add more tables.";
    case "AREA_NOT_EMPTY":
      return "This area still has active tables. Move or deactivate them first.";
    case "DUPLICATE_NAME":
      return r.formError ?? "That name is already in use here. Choose another.";
    case "FORBIDDEN":
      return "You don't have permission to do that.";
    case "RATE_LIMITED":
      return "Too many attempts. Please wait a moment and try again.";
    default:
      return r.formError;
  }
}

export const isPlanLimit = (r: ActionResult | null) => codeOf(r) === "PLAN_LIMIT";
