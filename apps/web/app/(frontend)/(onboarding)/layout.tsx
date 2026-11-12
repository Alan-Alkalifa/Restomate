import type { ReactNode } from "react";
import Link from "next/link";

// Minimal on purpose: onboarding is for someone who is already signed in, so no Log in / Sign up / Pricing nav.
// Static shell: no session, cookies or headers are read here (the page checks the session inside Suspense).
export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <div lang="en" className="flex flex-1 flex-col">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto flex min-h-14 w-full max-w-5xl items-center px-4">
          <Link href="/" className="text-lg font-semibold">Restomate</Link>
        </div>
      </header>
      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">{children}</div>
    </div>
  );
}
