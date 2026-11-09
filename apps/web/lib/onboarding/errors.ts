import type { ActionResult } from "@/lib/auth/schemas";

const GENERIC = "We could not create your restaurant. Please try again.";

/** Map a create_organization RPC error message (e.g. "SLUG_TAKEN") to a friendly ActionResult. Never echoes raw text. */
export function mapCreateOrganizationError(message: string | undefined): Extract<ActionResult, { ok: false }> {
  const m = message ?? "";
  if (m.includes("SLUG_TAKEN")) return { ok: false, fieldErrors: { slug: ["That web address is already taken. Try another."] } };
  if (m.includes("SLUG_RESERVED")) return { ok: false, fieldErrors: { slug: ["That web address is reserved. Try another."] } };
  if (m.includes("INVALID_SLUG")) return { ok: false, fieldErrors: { slug: ["Use 3–40 lowercase letters, numbers or hyphens."] } };
  if (m.includes("INVALID_NAME")) return { ok: false, fieldErrors: { name: ["Enter a valid restaurant name."] } };
  if (m.includes("INVALID_LOCATION")) return { ok: false, fieldErrors: { location: ["Check the location details and try again."] } };
  if (m.includes("INVALID_BRANDING")) return { ok: false, fieldErrors: { branding: ["Check the logo and colour and try again."] } };
  if (m.includes("SIGNUP_DISABLED")) return { ok: false, code: "SIGNUP_DISABLED", formError: "Sign-ups are closed right now." };
  if (m.includes("ORG_LIMIT_REACHED") || m.includes("PLAN_LIMIT")) {
    return { ok: false, code: "PLAN_LIMIT", formError: "You have reached the maximum number of restaurants for your account." };
  }
  if (m.includes("EMAIL_NOT_CONFIRMED")) return { ok: false, formError: "Please confirm your email address before creating a restaurant." };
  if (m.includes("NOT_AUTHENTICATED")) return { ok: false, code: "FORBIDDEN", formError: "Your session has expired. Please sign in again." };
  if (m.includes("INVALID_PACKAGE")) return { ok: false, formError: GENERIC };
  return { ok: false, formError: GENERIC };
}
