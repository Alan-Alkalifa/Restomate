import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/auth/schemas";
import { fmt } from "@/i18n/config";

/** Hint text derived from the server's password rule, so the two cannot drift. `template` is the localized string. */
export function passwordHint(template: string): string {
  return fmt(template, { min: PASSWORD_MIN, max: PASSWORD_MAX });
}
