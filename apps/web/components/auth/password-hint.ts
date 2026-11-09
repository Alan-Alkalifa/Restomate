import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/auth/schemas";

/** Hint text derived from the server's password rule, so the two cannot drift. Call from Server Components. */
export function passwordHint(): string {
  return `At least ${PASSWORD_MIN} characters (at most ${PASSWORD_MAX} bytes).`;
}
