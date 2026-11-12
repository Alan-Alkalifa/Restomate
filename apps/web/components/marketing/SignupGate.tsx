import { connection } from "next/server";
import { Suspense } from "react";
import { getPublicPlatformFlags } from "@/lib/public/platform-flags";

/** Exported for tests. Server component: the flag is read on the server, so a closed signup never renders the link. */
export async function SignupGateContent({ children }: { children: React.ReactNode }) {
  // Request time, so a build-time flags failure is never baked into the static marketing shell.
  await connection();
  const { signupEnabled } = await getPublicPlatformFlags();
  return signupEnabled ? children : null;
}

/**
 * Renders its children (a signup link/button) only while sign-ups are open, decided on the server.
 * The Suspense fallback is empty ON PURPOSE: React streams the fallback inside the first HTML and swaps it later, so a
 * link in the fallback would be in the server HTML even when sign-ups are off (BUG-100-2). The link therefore appears
 * only once the server has read the flag and found sign-ups open. Cosmetic: signUp and the database trigger enforce it.
 */
export function SignupGate({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <SignupGateContent>{children}</SignupGateContent>
    </Suspense>
  );
}
