"use client";

import { useTransition } from "react";

/**
 * Dashboard header sign-out. Own classes, not the primary Button: that one is `text-white`, and a transparent
 * background with white text is invisible in the light theme (BUG-63-2). Explicit text colour per theme
 * (neutral-900 on white, neutral-50 on dark: well above 4.5:1).
 */
export function DashboardSignOut({ action }: { action: () => Promise<void> }) {
  const [pending, startTransition] = useTransition();
  return (
    <form action={() => { startTransition(async () => { await action(); }); }}>
      <button type="submit" disabled={pending} aria-busy={pending || undefined}
        className="min-h-12 whitespace-nowrap rounded-lg bg-transparent px-4 text-base font-semibold text-neutral-900 ring-1 ring-neutral-500 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:cursor-not-allowed disabled:opacity-60 dark:text-neutral-50 dark:hover:bg-neutral-800">
        {pending ? "Signing out…" : "Sign out"}
      </button>
    </form>
  );
}
