/**
 * Runs once when a server instance starts, before it serves requests (Next.js instrumentation).
 * Validates the whole server environment so a misconfigured deployment fails fast and loudly, naming the bad
 * variables (never their values), instead of failing later inside a request or an after() callback.
 *
 * - production (Vercel, `next start`): a bad env throws, so the instance does not start.
 * - development / test: the same error is logged but does not stop the dev server.
 * - `next build` does not run this, so a build needs no runtime secrets.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { validateServerEnv } = await import("./lib/env.server");
  try {
    validateServerEnv();
  } catch (e) {
    const detail = e instanceof Error ? e.message : "unknown error";
    console.error(`[env] Server environment is invalid. ${detail}`);
    if (process.env.NODE_ENV === "production") throw e;
  }
}
