import { connection } from "next/server";
import { Suspense } from "react";
import { getPublicPlatformFlags } from "@/lib/public/platform-flags";

async function Gate({ children }: { children: React.ReactNode }) {
  // Request time, so a build-time flags failure is never baked into the static marketing shell.
  await connection();
  const { signupEnabled } = await getPublicPlatformFlags();
  return signupEnabled ? children : null;
}

/**
 * Renders its children (a signup link/button) only while sign-ups are open. Cosmetic: signUp and the database trigger
 * enforce it. The static shell shows the children first (the default is open) and the gate hides them once the flag
 * resolves, so the page stays static and never blocks.
 */
export function SignupGate({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={children}>
      <Gate>{children}</Gate>
    </Suspense>
  );
}
