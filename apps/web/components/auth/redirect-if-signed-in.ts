import "server-only";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/dal";
import { sanitizeNext } from "@/lib/auth/redirect";

/** Where a signed-in user who opened /login or /signup is sent. Same-site `next` only; never back to an auth page. */
export function signedInDestination(next: string | string[] | undefined): string {
  const target = typeof next === "string" ? sanitizeNext(next, "/") : "/";
  return /^(?:\/en)?\/(login|signup)(?:[/?#]|$)/.test(target) ? "/" : target;
}

/**
 * Send an already signed-in user away from an auth page. The DAL decides (proxy.ts never does).
 * Call inside the page's <Suspense> child, after awaiting searchParams.
 */
export async function redirectIfSignedIn(next: string | string[] | undefined): Promise<void> {
  if (await getCurrentUser()) redirect(signedInDestination(next));
}
